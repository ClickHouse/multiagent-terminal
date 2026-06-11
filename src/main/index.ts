// Force X11 on Linux to avoid Wayland/Vulkan incompatibility with Electron.
// Must be set before any Electron import.
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
import * as terminalLog from './terminalLog.js'
import { aggregate, clearStatsCache } from './stats/aggregate.js'
import { Period } from './stats/types.js'
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

function clearAgentMetrics(agent: Agent): void {
  agent.changedFiles = 0
  agent.linesAdded = 0
  agent.linesRemoved = 0
  agent.currentBranch = ''
  agent.prNumber = null
  agent.prRepo = ''
  agent.prTitle = ''
}

function onAgentExit(id: string): void {
  const agent = agents.find((a) => a.id === id)
  if (agent) { agent.status = 'stopped'; agent.activity = ''; broadcastAgentsNow() }
}

function onAgentStatus(id: string, status: import('../shared/types.js').AgentStatus, activity: string, sleepDetected = false, userTriggered = false): void {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  if (agent.status === status && agent.activity === activity) return

  const wasActive    = agent.status === 'working' || agent.status === 'thinking'
  const becomesActive = status === 'working' || status === 'thinking'

  // Track when the active period started and how long it lasted.
  if (becomesActive && !wasActive) agent.workingStartedAt = Date.now()

  const activeDuration = agent.workingStartedAt
    ? Math.round((Date.now() - agent.workingStartedAt) / 1000)
    : 0

  if (wasActive && !becomesActive && agent.workingStartedAt && !sleepDetected) {
    if (activeDuration > 0 && activeDuration < 7200) {
      agent.lastTaskDuration = activeDuration
    }
    agent.lastFinishedAt = Date.now()
  }
  if (!becomesActive) agent.workingStartedAt = null

  agent.status = status
  agent.activity = activity

  // "Done" requires ALL of:
  // 1. Transitioned from active (thinking/working) to idle
  // 2. Not caused by sleep/wake
  // 3. userTriggered = true (the PTY entry confirms markThinking was called for THIS cycle)
  // TODO: re-enable minimum duration check (activeDuration >= 7) once threshold is tuned
  if (wasActive && status === 'idle' && !sleepDetected && userTriggered) {
    const spawnedAt = agentSpawnedAt.get(id) ?? 0
    const isCurrent = id === selectedAgentId
    const tooNew = Date.now() - spawnedAt < 5000

    // Don't mark as unseen if the user is already watching this agent —
    // they saw it finish in real time, so no badge needed.
    if (!isCurrent) {
      agent.unseenResponse = true
    }
    agent.userInteracted = true

    if (!tooNew && !isCurrent) {
      if (Notification.isSupported() && getSettings().notifications) {
        new Notification({
          title: 'Agent finished',
          body: `${agent.name} is waiting for input`,
          silent: false,
        }).show()
      }
      send('agent:finished', id, agent.name)
    }
  }

  broadcastAgentsNow()
}

function startAgent(agent: Agent, resume: boolean): void {
  agentSpawnedAt.set(agent.id, Date.now())
  agentLastInputAt.delete(agent.id)
  agent.status = 'starting'
  agentManager.spawnAgent(agent, resume, onAgentExit, onAgentStatus, getSettings().skipPermissions)
  // When resuming, Claude starts working immediately — reflect that in status.
  // The pipe/output tracking will transition thinking → working → idle.
  if (resume) {
    agent.status = 'thinking'
    agent.workingStartedAt = Date.now()
  } else {
    agent.status = 'idle'
  }

  // ensurePipe + pipe reading are async — don't block the event loop.
  ensurePipe(agent.statusPipePath)
    .then(() => startAgent_readPipe(agent))
    .catch(e => console.error('[startAgent] pipe setup error:', e))
  broadcastAgentsNow()
}

function startAgent_readPipe(agent: Agent): void {
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
    const changed = a.contextPercent !== newPct || a.costUSD !== newCost ||
        a.tokensUsed !== newTok || a.model !== newModel
    a.contextPercent = newPct
    a.tokensUsed     = newTok
    a.contextWindowSize = update.context_window.context_window_size
    a.costUSD        = newCost
    a.model          = newModel

    // Statusline fires after each assistant turn — use it as a signal.
    agentManager.notifyPipeUpdate(agentId, onAgentStatus)

    if (changed) broadcastAgents()
  })
}

function toPersistedAgents(): PersistedAgent[] {
  return agents.map(({ status: _s, activity: _a, model: _m, contextPercent: _c, tokensUsed: _t, contextWindowSize: _w, costUSD: _u, changedFiles: _f, linesAdded: _la, linesRemoved: _lr, currentBranch: _b, prNumber: _p, prRepo: _r, prTitle: _pt, workingStartedAt: _ws, lastTaskDuration: _ltd, lastFinishedAt: _lfa, lastInputAt: _lia, unseenResponse: _u2, userInteracted: _i, ...rest }) => rest)
}

function createWindow(): void {
  // Enable SharedArrayBuffer by setting COOP/COEP headers.
  const { session } = require('electron') as typeof import('electron')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      }
    })
  })

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '../../resources/icon.png'),
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

ipcMain.handle('agent:create', async (_e, name: string, customBase: string | null, customDest: string | null, doWorktree = true, model = '') => {
  console.log('[create] name:', name, '| customBase:', customBase, '| customDest:', customDest, '| doWorktree:', doWorktree, '| model:', model || '(default)')

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
    // Ensure parent directory exists (e.g. user typed ~/projects/new-dir/agent).
    const parentDir = path.dirname(wtPath)
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true })
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
  await ensurePipe(pipePath)
  console.log('[create] pipe ok')

  const agent: Agent = {
    id, name,
    worktreePath: wtPath,
    baseRepoPath: repoRoot,
    branchName,
    statusPipePath: pipePath,
    createdAt: new Date().toISOString(),
    launchModel: model,
    status: 'starting',
    activity: '', model: '',
    contextPercent: 0, tokensUsed: 0, contextWindowSize: 0, costUSD: 0, changedFiles: 0, linesAdded: 0, linesRemoved: 0, currentBranch: '', prNumber: null, prRepo: '', prTitle: '', workingStartedAt: null, lastTaskDuration: null, lastFinishedAt: null, lastInputAt: null, unseenResponse: false, userInteracted: false
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

    const changed = a.contextPercent !== newPct || a.tokensUsed !== newTokens ||
        a.costUSD !== newCost || a.model !== newModel

    a.contextPercent   = newPct
    a.tokensUsed       = newTokens
    a.contextWindowSize = newSize
    a.costUSD          = newCost
    a.model            = newModel

    // Statusline fires after each assistant turn — use it as a signal
    // to transition thinking→working→idle (same as startAgent_readPipe).
    agentManager.notifyPipeUpdate(agentId, onAgentStatus)

    if (changed) broadcastAgents()
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
  terminalLog.removeAgentLogs(id)
  await removeWorktree(agent.baseRepoPath, agent.worktreePath).catch(() => {})
  agents = agents.filter((a) => a.id !== id)
  saveAgents(toPersistedAgents())
  broadcastAgents()
})

ipcMain.handle('agent:setModel', (_e, id: string, model: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent || agent.launchModel === model) return
  agent.launchModel = model
  // Switch a running session in place via the /model slash command;
  // stopped agents pick the model up from --model on next spawn.
  if (agentManager.isRunning(id)) {
    agentManager.sendInput(id, `/model ${model || 'default'}\r`)
  }
  saveAgents(toPersistedAgents())
  broadcastAgentsNow()
})

ipcMain.handle('agent:rename', (_e, id: string, newName: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  agent.name = newName.trim()
  saveAgents(toPersistedAgents())
  broadcastAgents()
})

ipcMain.handle('agent:move', (_e, id: string, direction: 'up' | 'down') => {
  const idx = agents.findIndex(a => a.id === id)
  if (idx < 0) return
  const target = direction === 'up' ? idx - 1 : idx + 1
  if (target < 0 || target >= agents.length) return
  ;[agents[idx], agents[target]] = [agents[target], agents[idx]]
  saveAgents(toPersistedAgents())
  broadcastAgentsNow()
})

ipcMain.handle('agent:reorder', (_e, orderedIds: string[]) => {
  const byId = new Map(agents.map(a => [a.id, a]))
  const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean) as typeof agents
  // Append any agents not in the list (shouldn't happen, but safety)
  for (const a of agents) {
    if (!orderedIds.includes(a.id)) reordered.push(a)
  }
  agents.length = 0
  agents.push(...reordered)
  saveAgents(toPersistedAgents())
  broadcastAgentsNow()
})

ipcMain.handle('agent:reset', async (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return

  // 1. Kill claude.
  agentManager.killAgent(id)
  stopReading(id)
  agent.status = 'stopped'
  agent.activity = 'resetting…'
  clearAgentMetrics(agent)
  broadcastAgentsNow()

  // 2. Git: checkout default branch + pull.
  try {
    const git = simpleGit(agent.worktreePath)
    const branches = await git.branch()
    const defaultBranch = ['master', 'main'].find(b => branches.all.includes(b)) ?? 'master'
    agent.activity = `git fetch…`
    broadcastAgentsNow()
    try {
      await git.raw(['fetch', '--no-tags', '--quiet', 'origin', defaultBranch])
      lastFetchAt.set(agent.worktreePath, Date.now())
    } catch { /* offline — fall through to checkout + pull */ }
    agent.activity = `git checkout ${defaultBranch}…`
    broadcastAgentsNow()
    await git.checkout(defaultBranch)
    agent.activity = `git pull…`
    broadcastAgentsNow()
    await git.pull('origin', defaultBranch, ['--ff-only'])
    agent.branchName = defaultBranch
    agent.currentBranch = defaultBranch
  } catch (e: any) {
    console.error(`[reset] git error for ${agent.name}:`, e?.message)
  }

  // 3. Clear terminal in renderer.
  send('terminal:clear', id)

  // 4. Start claude fresh (no --continue — clean session on a clean branch).
  agent.activity = 'starting…'
  broadcastAgentsNow()
  agentSpawnedAt.set(id, Date.now())
  agentLastInputAt.delete(id)
  agent.unseenResponse = false
  agent.userInteracted = false
  try {
    agentManager.spawnAgent(agent, false, onAgentExit, onAgentStatus)
    startAgent_readPipe(agent)
  } catch (e: any) {
    console.error(`[reset] spawn error:`, e?.message)
    agent.status = 'error'
  }
  agent.activity = ''
  broadcastAgentsNow()
})

ipcMain.handle('agent:markSeen', (_e, id: string) => {
  const agent = agents.find(a => a.id === id)
  if (agent?.unseenResponse) { agent.unseenResponse = false; broadcastAgentsNow() }
})

ipcMain.handle('agent:ensureRunning', (_e, id: string) => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return
  // Don't try to start agents with validation errors (e.g. missing worktree).
  if (agent.status === 'error' && agent.activity.startsWith('Worktree missing')) return
  if (agentManager.isRunning(id)) return
  const resume = getSettings().resumeOnOpen
  try { startAgent(agent, resume) }
  catch (e: any) { console.error('[ensureRunning]', e?.message) }
})

ipcMain.handle('agent:restart', async (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  // Re-validate worktree before restart.
  if (!fs.existsSync(agent.worktreePath)) {
    agent.status = 'error'
    agent.activity = `Worktree missing: ${agent.worktreePath}`
    broadcastAgentsNow()
    return
  }
  agentManager.killAgent(id)
  stopReading(id)
  send('terminal:clear', id)
  agent.status = 'starting'
  agent.activity = ''
  agent.contextPercent = 0
  agent.tokensUsed = 0
  agent.costUSD = 0
  agent.lastTaskDuration = null
  agent.unseenResponse = false
  agent.userInteracted = false
  clearAgentMetrics(agent)
  broadcastAgentsNow()
  // Let the renderer process the clear before spawning new output.
  await new Promise(r => setTimeout(r, 100))
  try { startAgent(agent, false) }
  catch (e: any) { agent.status = 'stopped'; broadcastAgentsNow() }
})

ipcMain.on('terminal:input', (_e, id: string, data: string) => {
  agentManager.sendInput(id, data)

  // Ignore escape sequences (focus, resize, cursor reports).
  if (/^\x1b/.test(data)) return
  // Ignore pure control chars (not Enter/newline).
  if (/^[\x00-\x1f\x7f]*$/.test(data) && !/[\r\n]/.test(data)) return

  // Only Enter counts as meaningful interaction (submitting a prompt to Claude).
  // Single keypresses while typing are not "interaction" for status purposes.
  const isEnter = data.includes('\r') || data.includes('\n')
  if (isEnter) {
    const agent = agents.find(a => a.id === id)
    if (agent) agent.lastInputAt = Date.now()
    agentManager.markThinking(id, onAgentStatus)
  }
})

ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) => {
  agentManager.resizeTerminal(id, cols, rows)
})

ipcMain.handle('agent:setSelected', (_e, id: string) => {
  selectedAgentId = id
  agentManager.setSelectedAgent(id)
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
    // Compare branch to base (main/master) — shows all changes since fork point.
    const mergeBase = await getMergeBase(git, agent.worktreePath)
    if (mergeBase) {
      diffText = await git.diff([mergeBase, '--', ':!contrib/'])
    } else {
      // Fallback: uncommitted changes against HEAD
      diffText = await git.diff(['HEAD', '--', ':!contrib/']).catch(() =>
        git.diff(['--', ':!contrib/'])
      )
    }
  } catch (e: any) {
    console.error('[diff] git error:', e?.message)
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
    exec('gh pr view --json number,headRepository,title --jq "[.number,.headRepository.name,.title]|@tsv"',
      { cwd: agent.worktreePath },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          const hadPR = agent.prNumber !== null
          agent.prNumber = null; agent.prTitle = ''
          // Fetch repo name from gh even without a PR
          exec('gh repo view --json nameWithOwner --jq .nameWithOwner',
            { cwd: agent.worktreePath },
            (e2, repoOut) => {
              const repoName = repoOut?.trim() || ''
              if (hadPR || agent.prRepo !== repoName) {
                agent.prRepo = repoName
                broadcastAgentsNow()
              }
            })
          resolve(null); return
        }
        try {
          const parts = stdout.trim().split('\t')
          const num  = parseInt(parts[0] ?? '', 10)
          const repo = parts[1]?.trim() || path.basename(agent.baseRepoPath)
          const title = parts[2]?.trim() || ''
          const finalNum = isNaN(num) ? null : num
          if (agent.prNumber !== finalNum || agent.prRepo !== repo || agent.prTitle !== title) {
            agent.prNumber = finalNum
            agent.prRepo   = repo
            agent.prTitle  = title
            broadcastAgents()
          }
          resolve(agent.prNumber)
        } catch {
          resolve(null)
        }
      })
  })
})

ipcMain.handle('actions:getGitLog', async (_e, id: string) => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return []
  try {
    const git = simpleGit(agent.worktreePath)
    // Use --stat and a custom format to get all info in one call.
    const raw = await git.raw([
      'log', '-10',
      '--format=%H%x00%s%x00%aI%x00%aN%x00',
      '--shortstat',
    ])
    const commits: Array<{
      hash: string; message: string; date: string; author: string;
      filesChanged: number; linesAdded: number; linesRemoved: number;
    }> = []

    // Parse: each commit is a format line followed by an optional shortstat line.
    // Format line: hash\0message\0date\0author\0
    // Shortstat line: " 3 files changed, 10 insertions(+), 2 deletions(-)"
    const lines = raw.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.includes('\0')) continue
      const [hash, message, date, author] = line.split('\0')
      if (!hash) continue

      let filesChanged = 0, linesAdded = 0, linesRemoved = 0
      // Next non-empty line might be the shortstat.
      const next = lines[i + 1]?.trim()
      if (next && /\d+ file/.test(next)) {
        const fm = next.match(/(\d+) file/)
        const im = next.match(/(\d+) insertion/)
        const dm = next.match(/(\d+) deletion/)
        filesChanged = fm ? parseInt(fm[1]) : 0
        linesAdded = im ? parseInt(im[1]) : 0
        linesRemoved = dm ? parseInt(dm[1]) : 0
        i++ // skip the stat line
      }

      commits.push({ hash, message, date, author, filesChanged, linesAdded, linesRemoved })
    }
    return commits
  } catch { return [] }
})

ipcMain.handle('actions:openCommitDiff', async (_e, id: string, commitHash: string): Promise<void> => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return
  try {
    const git = simpleGit(agent.worktreePath)
    const diffText = await git.diff([`${commitHash}~1`, commitHash, '--', ':!contrib/'])
      .catch(() => git.diff([commitHash, '--', ':!contrib/']))

    const noChanges = `<div style="display:flex;align-items:center;justify-content:center;
      height:calc(100vh - 49px);color:#5a6a7e;font-size:15px;">No changes in this commit.</div>`

    const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><title>Commit ${commitHash.slice(0, 7)} — ${agent.name}</title>
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
  <h1>Commit ${commitHash.slice(0, 7)} — ${agent.name}</h1>
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

    const tmpFile = path.join(os.tmpdir(), `multiagent-commit-${commitHash.slice(0, 7)}.html`)
    fs.writeFileSync(tmpFile, html, 'utf8')
    await shell.openExternal(`file://${tmpFile}`)
  } catch (e: any) {
    console.error('[openCommitDiff] error:', e?.message)
  }
})

// Throttle background fetches per worktree — local origin/main goes stale
// fast, and a stale base makes merge-base point far behind real main, which
// inflates diff counts with every commit main has advanced since.
const FETCH_TTL_MS = 5 * 60 * 1000
const lastFetchAt = new Map<string, number>()
const inflightFetch = new Map<string, Promise<void>>()

async function maybeFetchBase(
  git: ReturnType<typeof simpleGit>,
  worktreePath: string,
): Promise<void> {
  const now = Date.now()
  const last = lastFetchAt.get(worktreePath) ?? 0
  if (now - last < FETCH_TTL_MS) return
  const existing = inflightFetch.get(worktreePath)
  if (existing) return existing
  const p = (async () => {
    try {
      await git.raw(['fetch', '--no-tags', '--quiet', 'origin', 'main', 'master'])
    } catch {
      // Either branch may not exist on the remote — fetch both and ignore.
      try { await git.raw(['fetch', '--no-tags', '--quiet', 'origin']) } catch { /* ignore */ }
    } finally {
      lastFetchAt.set(worktreePath, Date.now())
      inflightFetch.delete(worktreePath)
    }
  })()
  inflightFetch.set(worktreePath, p)
  return p
}

async function getMergeBase(
  git: ReturnType<typeof simpleGit>,
  worktreePath?: string,
): Promise<string | null> {
  try {
    if (worktreePath) await maybeFetchBase(git, worktreePath)
    const head = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    // Try origin/main, origin/master, then local main/master
    for (const base of ['origin/main', 'origin/master', 'main', 'master']) {
      try {
        const mb = (await git.raw(['merge-base', base, 'HEAD'])).trim()
        if (mb && head !== base.replace('origin/', '')) return mb
      } catch { /* try next */ }
    }
  } catch { /* ignore */ }
  return null
}

// Lightweight: file count + branch (fast, runs every 10s)
ipcMain.handle('actions:getChangedFiles', async (_e, id: string): Promise<number> => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return 0
  try {
    const git = simpleGit(agent.worktreePath)
    const branch = (await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => '')).trim()
    const mergeBase = await getMergeBase(git, agent.worktreePath)

    let count = 0
    if (mergeBase) {
      // Compare branch to base: all committed + uncommitted changes since fork point
      const out = await git.diff([mergeBase, '--name-only', '--', ':!contrib/'])
      count = out.trim().split('\n').filter(Boolean).length
    } else {
      // On base branch: show uncommitted changes
      const [unstaged, staged] = await Promise.all([
        git.diff(['--name-only', '--', ':!contrib/']),
        git.diff(['--cached', '--name-only', '--', ':!contrib/']),
      ])
      count = new Set([
        ...unstaged.trim().split('\n'),
        ...staged.trim().split('\n'),
      ].filter(Boolean)).size
    }

    if (agent.changedFiles !== count || agent.currentBranch !== branch) {
      agent.changedFiles = count
      agent.currentBranch = branch
      broadcastAgents()
    }
    return count
  } catch { return 0 }
})

// Line stats: use git log --shortstat (reads pack data, no working tree scan)
ipcMain.handle('actions:getLineStats', async (_e, id: string) => {
  const agent = agents.find(a => a.id === id)
  if (!agent) return
  try {
    const git = simpleGit(agent.worktreePath)
    const mergeBase = await getMergeBase(git, agent.worktreePath)
    if (!mergeBase) return

    // Sum up shortstat across all commits since merge-base — fast, uses pack data only
    const out = await git.raw([
      'log', `${mergeBase}..HEAD`, '--shortstat', '--format=', '--', ':!contrib/'
    ])
    let added = 0, removed = 0
    for (const line of out.split('\n')) {
      const am = line.match(/(\d+) insertion/)
      const rm = line.match(/(\d+) deletion/)
      if (am) added += parseInt(am[1], 10)
      if (rm) removed += parseInt(rm[1], 10)
    }
    if (agent.linesAdded !== added || agent.linesRemoved !== removed) {
      agent.linesAdded = added
      agent.linesRemoved = removed
      broadcastAgents()
    }
  } catch { /* ignore */ }
})

ipcMain.handle('actions:openPR', async (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  const { exec } = require('child_process')
  exec(`gh pr view --web`, { cwd: agent.worktreePath })
})

ipcMain.handle('actions:openRepo', async (_e, id: string) => {
  const agent = agents.find((a) => a.id === id)
  if (!agent) return
  const { exec } = require('child_process') as typeof import('child_process')
  exec(`gh browse --no-browser`, { cwd: agent.worktreePath }, (err, stdout) => {
    const url = stdout?.trim()
    if (url) shell.openExternal(url)
  })
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
  // Preflight: check required commands are available.
  const { execSync } = require('child_process') as typeof import('child_process')
  const missing: string[] = []
  const checks: Array<{ cmd: string; test: string; label: string }> = [
    { cmd: 'git --version', test: '', label: 'git' },
    { cmd: 'gh --version', test: '', label: 'gh (GitHub CLI)' },
    { cmd: 'claude --version', test: '', label: 'claude' },
    { cmd: 'claude auth status', test: '', label: 'claude auth (not logged in)' },
  ]
  for (const { cmd, label } of checks) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 10000 })
    } catch {
      missing.push(label)
    }
  }
  if (missing.length > 0) {
    const { dialog: d } = require('electron') as typeof import('electron')
    d.showErrorBox(
      'Missing requirements',
      `The following are required but not found:\n\n${missing.map(m => `  • ${m}`).join('\n')}\n\nPlease install them and restart the app.`
    )
    app.quit()
    return
  }

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

  // Reconstitute agents, then validate each one's worktree.
  agents = (st.agents ?? []).map((a) => {
    let status: 'stopped' | 'error' = 'stopped'
    let activity = ''

    // Validate worktree path exists on disk.
    if (!fs.existsSync(a.worktreePath)) {
      status = 'error'
      activity = `Worktree missing: ${a.worktreePath}`
      console.warn(`[startup] agent "${a.name}" worktree missing: ${a.worktreePath}`)
    }

    return {
      ...a,
      launchModel: a.launchModel ?? '',  // migrate agents persisted before model support
      status: status as const,
      activity,
      model: '',
      contextPercent: 0,
      tokensUsed: 0,
      contextWindowSize: 0,
      costUSD: 0,
      changedFiles: 0, linesAdded: 0, linesRemoved: 0, currentBranch: '', prNumber: null, prRepo: '', prTitle: '', workingStartedAt: null, lastTaskDuration: null, lastFinishedAt: null, lastInputAt: null, unseenResponse: false, userInteracted: false
    }
  })

  // Clean up orphaned pipe files (pipes with no matching agent).
  try {
    const pDir = pipesDir()
    const agentIds = new Set(agents.map(a => a.id))
    for (const file of fs.readdirSync(pDir)) {
      if (!agentIds.has(file)) {
        try {
          fs.unlinkSync(path.join(pDir, file))
          console.log('[startup] removed orphaned pipe:', file)
        } catch { /* ignore */ }
      }
    }
  } catch { /* pipes dir may not exist yet */ }

  // Start search worker (indexes logs in background thread).
  terminalLog.initSearchWorker()

  createWindow()
})

ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))

ipcMain.on('clipboard:write', (_e, text: string) => {
  const { clipboard } = require('electron')
  clipboard.writeText(text)
})

ipcMain.handle('clipboard:read', () => {
  const { clipboard } = require('electron')
  return clipboard.readText()
})

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

// Stats
ipcMain.handle('stats:get', async (_e, period: Period) => {
  return aggregate(period)
})

ipcMain.handle('stats:clearCache', () => {
  clearStatsCache()
})

ipcMain.handle('stats:agent', async (_e, agentId: string, period: Period) => {
  const agent = agents.find(a => a.id === agentId)
  if (!agent) return null
  return aggregate(period, agent.worktreePath)
})

// Session log access for renderer.
ipcMain.handle('logs:list', (_e, agentId: string) => terminalLog.listLogs(agentId))
ipcMain.handle('logs:read', (_e, logPath: string) => terminalLog.readLog(logPath))
ipcMain.handle('logs:search', async (_e, query: string, agentIds?: string[]) => {
  return terminalLog.searchLogs(query, agentIds)
})

// Kill all PTYs before quitting to prevent Napi::Error on exit.
app.on('before-quit', () => {
  terminalLog.shutdownSearchWorker()
  shellManager.killAll()
  for (const agent of agents) {
    try { agentManager.killAgent(agent.id) } catch { /* ignore */ }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
