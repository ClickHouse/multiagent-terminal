// Force X11 on Linux to avoid Wayland/Vulkan incompatibility with Electron.
if (process.platform === 'linux') {
  process.env['ELECTRON_OZONE_PLATFORM_HINT'] = 'x11'
}

import { app, BrowserWindow, ipcMain, dialog, shell, Notification } from 'electron'
import * as path from 'path'
import { v4 as uuid } from 'uuid'
import { Agent, PersistedAgent } from '../shared/types.js'
import { loadState, saveAgents, saveBaseRepo, saveSelectedAgent } from './state.js'
import { sanitizeName, worktreePath, validateBaseRepo, createWorktree, removeWorktree } from './worktree.js'
import { configDir, pipesDir, agentPipePath, ensureStatuslineScript, patchClaudeSettings } from './setup.js'
import { ensurePipe, startReading, stopReading } from './statusPipe.js'
import * as agentManager from './agentManager.js'
import * as shellManager from './shellManager.js'
import { getSettings, saveSettings } from './settings.js'
import * as fs from 'fs'
import * as os from 'os'

// Read diff2html assets once at startup.
// __dirname in the built main is out/main — node_modules is two levels up.
function readDiff2html(): { css: string; js: string } {
  const candidates = [
    path.join(__dirname, '../../node_modules/diff2html/bundles'),
    path.join(process.cwd(), 'node_modules/diff2html/bundles'),
    path.join(app.getAppPath(), 'node_modules/diff2html/bundles'),
  ]
  for (const base of candidates) {
    try {
      const css = fs.readFileSync(path.join(base, 'css/diff2html.min.css'), 'utf8')
      const js  = fs.readFileSync(path.join(base, 'js/diff2html.min.js'),  'utf8')
      console.log('[diff2html] loaded from:', base)
      return { css, js }
    } catch { /* try next */ }
  }
  console.error('[diff2html] could not find bundles, tried:', candidates)
  return { css: '', js: '' }
}

const diff2html = readDiff2html()
import { simpleGit } from 'simple-git'

// Runtime agent list (includes status + context fields not in store)
let agents: Agent[] = []
let selectedAgentId = ''
let baseRepoPath = ''
let mainWindow: BrowserWindow | null = null

// Per-agent session tracking (not persisted).
// spawnedAt: when this PTY was started.
// lastUserInputAt: last time the user sent keystrokes to this agent.
// Only fire notifications/badge when lastUserInputAt > spawnedAt.
const agentSpawnedAt    = new Map<string, number>()
const agentLastInputAt  = new Map<string, number>()

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

// Debounce broadcasts — flush at most every 150ms.
let broadcastTimer: ReturnType<typeof setTimeout> | null = null
function broadcastAgents(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    send('agent:list', agents)
  }, 1000)
}
function broadcastAgentsNow(): void {
  if (broadcastTimer) { clearTimeout(broadcastTimer); broadcastTimer = null }
  send('agent:list', agents)
}

function onAgentExit(id: string): void {
  const agent = agents.find((a) => a.id === id)
  if (agent) { agent.status = 'stopped'; agent.activity = ''; broadcastAgentsNow() }
}

function onAgentStatus(id: string, status: import('../shared/types.js').AgentStatus, activity: string): void {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  if (agent.status === status && agent.activity === activity) return

  const wasActive = agent.status === 'working' || agent.status === 'thinking'
  const becomesIdle = status === 'idle'

  agent.status = status
  agent.activity = activity
  broadcastAgents()

  // Notify only when user has actually interacted with this agent since last spawn.
  const spawnedAt      = agentSpawnedAt.get(id) ?? 0
  const lastInputAt    = agentLastInputAt.get(id) ?? 0
  const userInteracted = lastInputAt > spawnedAt
  if (agent.userInteracted !== userInteracted) {
    agent.userInteracted = userInteracted
  }

  if (wasActive && becomesIdle && userInteracted) {
    agent.unseenResponse = true

    const spawnedAt  = agentSpawnedAt.get(id) ?? 0
    const tooNew     = Date.now() - spawnedAt < 5000   // opened < 5s ago
    const isCurrent  = id === selectedAgentId           // user is looking at it

    if (!tooNew && !isCurrent) {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Agent finished',
          body: `${agent.name} is waiting for input`,
          silent: false,
        }).show()
      }
      send('agent:finished', id, agent.name)
    }
  }
}

function startAgent(agent: Agent, resume: boolean): void {
  agentSpawnedAt.set(agent.id, Date.now())
  agentLastInputAt.delete(agent.id)
  agent.status = 'starting'
  agentManager.spawnAgent(agent, resume, onAgentExit, onAgentStatus)
  agent.status = 'idle'

  ensurePipe(agent.statusPipePath)
  startReading(agent.id, agent.statusPipePath, (agentId, update) => {
    const a = agents.find(x => x.id === agentId)
    if (!a) return
    const newPct  = update.context_window.used_percentage
    const newCost = update.cost.total_cost_usd
    const newTok  = update.context_window.total_input_tokens
    let   newModel = a.model
    if (update.model) {
      const m = update.model as any
      newModel = typeof m === 'string' ? m : (m.id ?? m.name ?? m.model ?? JSON.stringify(m))
    }
    if (a.contextPercent === newPct && a.costUSD === newCost &&
        a.tokensUsed === newTok && a.model === newModel) return
    a.contextPercent = newPct
    a.tokensUsed     = newTok
    a.contextWindowSize = update.context_window.context_window_size
    a.costUSD        = newCost
    a.model          = newModel
    broadcastAgents()
  })
  broadcastAgentsNow()
}

function toPersistedAgents(): PersistedAgent[] {
  return agents.map(({ status: _s, activity: _a, model: _m, contextPercent: _c, tokensUsed: _t, contextWindowSize: _w, costUSD: _u, changedFiles: _f, currentBranch: _b, prNumber: _p, prRepo: _r, unseenResponse: _u2, userInteracted: _i, ...rest }) => rest)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#fffbec',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    titleBarStyle: 'hiddenInset',
    title: 'multiagent'
  })

  agentManager.setWindow(mainWindow)
  shellManager.setWindow(mainWindow)

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (getSettings().devTools) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.webContents.on('did-finish-load', () => {
    broadcastAgents()
  })
}

// --- IPC Handlers ---

ipcMain.handle('agent:getState', () => ({
  agents,
  selectedAgentId,
  baseRepoPath
}))

ipcMain.handle('agent:create', async (_e, name: string, customBase: string | null, customDest: string | null, doWorktree = true) => {
  console.log('[create] name:', name, '| customBase:', customBase, '| customDest:', customDest, '| doWorktree:', doWorktree)

  const sanitized = sanitizeName(name)
  const id = uuid()
  const pipePath = agentPipePath(id)
  console.log('[create] sanitized:', sanitized, '| pipePath:', pipePath)

  const expandHome = (p: string) =>
    p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(p)

  // 1. Resolve base repo.
  let repoRoot = customBase ? expandHome(customBase) : baseRepoPath
  console.log('[create] repoRoot (initial):', repoRoot || '(empty)')
  if (!repoRoot && doWorktree) {
    try {
      const git = simpleGit(process.cwd())
      repoRoot = (await git.revparse(['--show-toplevel'])).trim()
      console.log('[create] repoRoot (auto-detected):', repoRoot)
    } catch (e: any) {
      console.log('[create] git auto-detect failed:', e?.message)
      throw new Error('No git repository found. Set a base repository or choose an existing git directory.')
    }
  }

  // 2. Resolve worktree destination.
  const defaultDest = repoRoot
    ? `${repoRoot}-${sanitized}`
    : path.join(os.homedir(), sanitized)
  const wtPath = customDest ? expandHome(customDest) : defaultDest
  console.log('[create] wtPath:', wtPath)

  let branchName = ''

  if (doWorktree) {
    console.log('[create] creating worktree at:', wtPath)
    if (fs.existsSync(wtPath)) {
      throw new Error(`Worktree destination already exists: ${wtPath}\nChoose a different destination.`)
    }
    await createWorktree(repoRoot, wtPath, sanitized)
    branchName = sanitized
    console.log('[create] worktree created, branch:', branchName)
  } else {
    console.log('[create] no worktree — using dir as-is:', wtPath)
    if (!fs.existsSync(wtPath)) {
      fs.mkdirSync(wtPath, { recursive: true })
      console.log('[create] directory created')
    } else {
      console.log('[create] directory already exists')
    }
    repoRoot = wtPath
  }

  console.log('[create] creating named pipe:', pipePath)
  ensurePipe(pipePath)
  console.log('[create] pipe ok')

  const agent: Agent = {
    id, name,
    worktreePath: wtPath,
    baseRepoPath: repoRoot,
    branchName,
    statusPipePath: pipePath,
    createdAt: new Date().toISOString(),
    status: 'starting',
    activity: '', model: '',
    contextPercent: 0, tokensUsed: 0, contextWindowSize: 0, costUSD: 0, changedFiles: 0, currentBranch: '', prNumber: null, prRepo: '', unseenResponse: false, userInteracted: false
  }

  agents.push(agent)
  console.log('[create] agent pushed, total agents:', agents.length)

  try {
    console.log('[create] spawning claude in:', wtPath)
    agentSpawnedAt.set(agent.id, Date.now()); agentLastInputAt.delete(agent.id); agentManager.spawnAgent(agent, false, onAgentExit, onAgentStatus)
    console.log('[create] claude spawned ok')
  } catch (e: any) {
    console.log('[create] spawnAgent FAILED:', e?.message)
    agents = agents.filter(a => a.id !== id)
    throw new Error(`Agent created but failed to start: ${e?.message ?? e}`)
  }

  agent.status = 'idle'

  startReading(id, pipePath, (agentId, update) => {
    const a = agents.find((x) => x.id === agentId)
    if (!a) return

    const newPct    = update.context_window.used_percentage
    const newTokens = update.context_window.total_input_tokens
    const newSize   = update.context_window.context_window_size
    const newCost   = update.cost.total_cost_usd
    let   newModel  = a.model
    if (update.model) {
      if (typeof update.model !== 'string') {
        console.log('[status] update.model is object:', JSON.stringify(update.model))
        const m = update.model as any
        newModel = m.id ?? m.name ?? m.model ?? m.slug ?? JSON.stringify(m)
      } else {
        newModel = update.model
      }
    }

    // Skip broadcast if nothing changed.
    if (a.contextPercent === newPct && a.tokensUsed === newTokens &&
        a.costUSD === newCost && a.model === newModel) return

    a.contextPercent   = newPct
    a.tokensUsed       = newTokens
    a.contextWindowSize = newSize
    a.costUSD          = newCost
    a.model            = newModel
    broadcastAgents()
  })

  saveAgents(toPersistedAgents())
  broadcastAgentsNow()
  console.log('[create] done, returning agent id:', id)
  return agent
})

ipcMain.handle('agent:remove', async (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  agentManager.killAgent(id)
  stopReading(id)
  await removeWorktree(agent.baseRepoPath, agent.worktreePath).catch(() => {})
  agents = agents.filter((a) => a.id !== id)
  saveAgents(toPersistedAgents())
  broadcastAgents()
})

ipcMain.handle('agent:rename', (_e, id: string, newName: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  agent.name = newName.trim()
  saveAgents(toPersistedAgents())
  broadcastAgents()
})

ipcMain.handle('agent:reset', async (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return

  // 1. Kill the running claude session.
  agentManager.killAgent(id)
  agent.status = 'starting'
  agent.activity = 'resetting…'
  broadcastAgentsNow()

  try {
    const git = simpleGit(agent.worktreePath)
    // 2. Checkout master (or main) and pull.
    const branches = await git.branch()
    const defaultBranch = ['master', 'main'].find(b => branches.all.includes(b)) ?? 'master'
    await git.checkout(defaultBranch)
    await git.pull('origin', defaultBranch, ['--ff-only'])
    console.log(`[reset] ${agent.name}: checked out ${defaultBranch} and pulled`)
  } catch (e: any) {
    console.error(`[reset] git error for ${agent.name}:`, e?.message)
  }

  // 3. Re-spawn claude with --continue so it resumes context.
  agentManager.spawnAgent(agent, true, onAgentExit, onAgentStatus)
  agent.status = 'idle'
  agent.activity = ''
  broadcastAgentsNow()
})

ipcMain.handle('agent:markSeen', (_e, id: string) => {
  const agent = agents.find(a => a.id === id)
  if (agent?.unseenResponse) { agent.unseenResponse = false; broadcastAgents() }
})

ipcMain.handle('agent:ensureRunning', (_e, id: string) => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return
  if (agentManager.isRunning(id)) return
  const resume = getSettings().resumeOnOpen
  try { startAgent(agent, resume) }
  catch (e: any) { console.error('[ensureRunning]', e?.message) }
})

ipcMain.handle('agent:restart', async (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  agentManager.killAgent(id)
  stopReading(id)
  try { startAgent(agent, true) }
  catch (e: any) { agent.status = 'stopped'; broadcastAgentsNow() }
})

ipcMain.on('terminal:input', (_e, id: string, data: string) => {
  agentManager.sendInput(id, data)

  // Ignore xterm focus/blur/resize control sequences — they fire automatically
  // when the terminal is focused and don't represent real user intent.
  const isControlOnly = /^[\x00-\x1f\x7f]*$/.test(data) &&
    !/[\r\t]/.test(data)  // allow Enter and Tab as real input
  if (isControlOnly) return

  agentLastInputAt.set(id, Date.now())
  const agent = agents.find(a => a.id === id)
  if (agent && !agent.userInteracted) {
    agent.userInteracted = true
    broadcastAgents()
  }
})

ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) => {
  agentManager.resizeTerminal(id, cols, rows)
})

ipcMain.handle('agent:setSelected', (_e, id: string) => {
  selectedAgentId = id
  saveSelectedAgent(id)
})

ipcMain.handle('agent:setBaseRepo', async (_e, repoPath: string) => {
  await validateBaseRepo(repoPath)
  baseRepoPath = repoPath
  saveBaseRepo(repoPath)
})

ipcMain.handle('agent:pickDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    title: 'Select working directory',
    defaultPath: os.homedir(),
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('agent:pickBaseRepo', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select base git repository',
    defaultPath: os.homedir(),
  })
  if (result.canceled || !result.filePaths.length) return null
  const chosen = result.filePaths[0]
  await validateBaseRepo(chosen)
  baseRepoPath = chosen
  saveBaseRepo(chosen)
  return chosen
})

ipcMain.handle('actions:openVSCode', (_e, id: string) => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return
  const { exec } = require('child_process')
  // Open the worktree folder as a project in VSCode.
  exec(`code "${agent.worktreePath}"`)
})

ipcMain.handle('actions:openDiff', async (_e, id: string): Promise<void> => {
  console.log('[diff] openDiff called for agent:', id)

  const agent = agents.find(a => a.id === id)
  if (!agent) { console.log('[diff] agent not found'); return }
  console.log('[diff] worktreePath:', agent.worktreePath)

  const git = simpleGit(agent.worktreePath)

  let diffText = ''
  try {
    console.log('[diff] running git diff HEAD ...')
    diffText = await git.diff(['HEAD', '--', ':!contrib/']).catch((e: any) => {
      console.log('[diff] git diff HEAD failed, falling back to git diff:', e?.message)
      return git.diff(['--', ':!contrib/'])
    })
    console.log(`[diff] tracked diff length: ${diffText.length} chars`)

    // Only include staged new files (git add'd), not untracked files.
    const status = await git.status()
    console.log(`[diff] staged new files: ${status.created.length}`)
  } catch (e: any) {
    console.log('[diff] git error:', e?.message)
  }

  console.log(`[diff] total diff size: ${diffText.length} chars`)
  console.log(`[diff] diff2htmlCSS length: ${diff2html.css.length}, diff2htmlJS length: ${diff2html.js.length}`)

  const noChanges = `<div style="display:flex;align-items:center;justify-content:center;
    height:calc(100vh - 49px);color:#5a6a7e;font-size:15px;">No changes in this worktree.</div>`

  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><title>Diff — ${agent.name}</title>
<style>${diff2html.css}</style>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;background:#f8fafc;color:#0d1117}
header{padding:12px 20px;background:#fff;border-bottom:1px solid #dde3ea;
  display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
header h1{font-size:14px;font-weight:600}
header span{font-size:12px;color:#5a6a7e;font-family:monospace}
#diff-container{padding:16px 20px}
.d2h-wrapper{border-radius:8px;overflow:hidden;border:1px solid #dde3ea}
.d2h-file-header{background:#f1f5f9!important}
.d2h-ins{background-color:#dcfce7!important}
.d2h-ins .d2h-code-linenumber{background-color:#bbf7d0!important;color:#166534!important}
.d2h-del{background-color:#fee2e2!important}
.d2h-del .d2h-code-linenumber{background-color:#fecaca!important;color:#991b1b!important}
.d2h-diff-table td{font-size:12px;font-family:"JetBrains Mono","Fira Code",monospace}
.d2h-code-side-linenumber{font-size:11px;min-width:36px}
</style>
</head><body>
<header>
  <h1>Changes — ${agent.name}</h1>
  <span>${agent.worktreePath}</span>
</header>
<div id="diff-container"></div>
<script>${diff2html.js}</script>
<script>
var raw=${
  JSON.stringify(diffText.slice(0, 4_000_000))
    .replace(/<\/script>/gi, '<\\/script>')
};
var el=document.getElementById('diff-container');
if(!raw.trim()){el.innerHTML=${JSON.stringify(noChanges)};}
else{
  var h=Diff2Html.html(Diff2Html.parse(raw),{drawFileList:true,matching:'lines',outputFormat:'side-by-side'});
  el.innerHTML='<div class="d2h-wrapper">'+h+'</div>';
}
</script>
</body></html>`

  const tmpFile = path.join(os.tmpdir(), `multiagent-diff-${id}.html`)
  console.log(`[diff] writing HTML (${html.length} chars) to: ${tmpFile}`)
  try {
    fs.writeFileSync(tmpFile, html, 'utf8')
    const stat = fs.statSync(tmpFile)
    console.log(`[diff] file written, size: ${stat.size} bytes`)
  } catch (e: any) {
    console.log('[diff] FAILED to write temp file:', e?.message)
    return
  }

  const fileUrl = `file://${tmpFile}`
  console.log('[diff] opening:', fileUrl)
  const result = await shell.openExternal(fileUrl)
  console.log('[diff] openExternal result:', result)
})

ipcMain.handle('actions:getPRNumber', async (_e, id: string): Promise<number | null> => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return null
  const { exec } = require('child_process') as typeof import('child_process')
  return new Promise(resolve => {
    exec('gh pr view --json number,headRepository --jq "[.number,.headRepository.name]|@tsv"',
      { cwd: agent.worktreePath },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          if (agent.prNumber !== null) { agent.prNumber = null; agent.prRepo = ''; broadcastAgents() }
          resolve(null); return
        }
        try {
          const [numStr, repoName] = stdout.trim().split('\t')
          const num  = parseInt(numStr ?? '', 10)
          const repo = repoName?.trim() || path.basename(agent.baseRepoPath)
          const finalNum = isNaN(num) ? null : num
          if (agent.prNumber !== finalNum || agent.prRepo !== repo) {
            agent.prNumber = finalNum
            agent.prRepo   = repo
            broadcastAgents()
          }
          resolve(agent.prNumber)
        } catch {
          resolve(null)
        }
      })
  })
})

ipcMain.handle('actions:getChangedFiles', async (_e, id: string): Promise<number> => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return 0
  try {
    const git = simpleGit(agent.worktreePath)
    const [status, branch] = await Promise.all([
      git.status(),
      git.revparse(['--abbrev-ref', 'HEAD']).catch(() => ''),
    ])
    const count = status.files.filter(f => !f.path.startsWith('contrib/')).length
    const liveBranch = branch.trim()
    if (agent.changedFiles !== count || agent.currentBranch !== liveBranch) {
      agent.changedFiles = count
      agent.currentBranch = liveBranch
      broadcastAgents()
    }
    return count
  } catch { return 0 }
})

ipcMain.handle('actions:openPR', async (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  const { exec } = require('child_process')
  exec(`gh pr view --web`, { cwd: agent.worktreePath })
})

// Handle agent exit event from agentManager.
ipcMain.on('agent:exited', (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (agent) {
    agent.status = 'stopped'
    broadcastAgents()
  }
})

// --- App lifecycle ---

app.whenReady().then(async () => {
  // Setup statusline script.
  try {
    const scriptPath = ensureStatuslineScript()
    patchClaudeSettings(scriptPath)
  } catch (e) {
    console.warn('Could not set up statusline:', e)
  }

  // Ensure dirs.
  fs.mkdirSync(configDir(), { recursive: true })
  fs.mkdirSync(pipesDir(), { recursive: true })

  // Load state.
  const st = loadState()
  baseRepoPath = st.baseRepoPath
  selectedAgentId = st.selectedAgentId

  // If no baseRepo set, try to detect from cwd.
  if (!baseRepoPath) {
    try {
      const git = simpleGit(process.cwd())
      if (await git.checkIsRepo()) {
        const root = await git.revparse(['--show-toplevel'])
        baseRepoPath = root.trim()
        saveBaseRepo(baseRepoPath)
      }
    } catch { /* no git repo in cwd */ }
  }

  // Reconstitute agents, then auto-resume all of them.
  agents = (st.agents ?? []).map((a) => ({
    ...a,
    status: 'stopped' as const,  // lazy: spawn only when agent is opened
    activity: '',
    model: '',
    contextPercent: 0,
    tokensUsed: 0,
    contextWindowSize: 0,
    costUSD: 0,
    changedFiles: 0, currentBranch: '', prNumber: null, prRepo: '', unseenResponse: false, userInteracted: false
  }))

  createWindow()
})

ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))

ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('settings:save', (_e, patch: any) => {
  const updated = saveSettings(patch)
  send('settings:changed', updated)
  return updated
})

ipcMain.handle('shell:spawn', (_e, agentId: string) => {
  const agent = agents.find(a => a.id === agentId)
  if (!agent) return
  shellManager.spawnShell(agentId, agent.worktreePath)
})

ipcMain.on('shell:input', (_e, agentId: string, data: string) => {
  shellManager.sendInput(agentId, data)
})

ipcMain.on('shell:resize', (_e, agentId: string, cols: number, rows: number) => {
  shellManager.resize(agentId, cols, rows)
})

ipcMain.handle('shell:kill', (_e, agentId: string) => {
  shellManager.killShell(agentId)
})

// Kill all PTYs before quitting to prevent Napi::Error on exit.
app.on('before-quit', () => {
  shellManager.killAll()
  for (const agent of agents) {
    try { agentManager.killAgent(agent.id) } catch { /* ignore */ }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
