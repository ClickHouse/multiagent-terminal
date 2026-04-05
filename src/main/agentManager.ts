import * as nodePty from 'node-pty'
import * as fs from 'fs'
import { BrowserWindow } from 'electron'
import { Agent, AgentStatus } from '../shared/types.js'

interface PtyEntry {
  pty: nodePty.IPty
  agentId: string
  alive: boolean
  buf: string               // rolling buffer for pattern detection
  idleTimer: ReturnType<typeof setTimeout> | null
}

const ptys = new Map<string, PtyEntry>()
let mainWindow: BrowserWindow | null = null

export function setWindow(win: BrowserWindow): void {
  mainWindow = win
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x1b[ABCDEFGHJKST]/g, '')
    .replace(/\r/g, '\n')
}

function detectActive(buf: string): { status: AgentStatus; activity: string } | null {
  const raw = buf
  const clean = stripAnsi(raw)

  // Braille spinner at start of line (after ANSI stripping) = thinking.
  // Test on `clean` so ANSI erase-line codes (\x1b[K) between \r and the spinner don't block the match.
  if (/(?:^|\n)\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(clean)) {
    const m = clean.match(/(?:^|\n)\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*(.{3,60}?)(?:\n|$)/)
    return { status: 'thinking', activity: m?.[1]?.trim() || 'Thinking…' }
  }

  // Tool execution patterns
  const toolRe = /(Running|Executing|Bash|Read(?:ing)?\s+file|Writ(?:ing)?|Edit(?:ing)?|Creat(?:ing)?|Delet(?:ing)?|Search(?:ing)?|List(?:ing)?|Glob|Grep|WebFetch|WebSearch|TodoWrite|MCP|Agent\s+tool)/i
  const toolMatch = clean.match(new RegExp(toolRe.source + '\\s*[:\\-–]?\\s*(.{0,60}?)(?:\\n|$)', 'i'))
  if (toolMatch) {
    return { status: 'working', activity: toolMatch[0].trim().slice(0, 60) }
  }

  return null
}


export function spawnAgent(
  agent: Agent,
  resume = false,
  onExit?: (id: string) => void,
  onStatus?: (id: string, status: AgentStatus, activity: string) => void
): void {
  killAgent(agent.id)

  if (!fs.existsSync(agent.worktreePath)) {
    throw new Error(`Working directory does not exist: ${agent.worktreePath}`)
  }

  const args = ['--dangerously-skip-permissions']
  if (resume) args.push('--continue')

  let pty: nodePty.IPty
  try {
    pty = nodePty.spawn('claude', args, {
      name: 'xterm-256color',
      cwd: agent.worktreePath,
      env: {
        ...process.env,
        MULTIAGENT_STATUS_PIPE: agent.statusPipePath,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      } as Record<string, string>,
      cols: 220,
      rows: 50
    })
  } catch (err: any) {
    throw new Error(`Failed to start claude: ${err?.message ?? err}`)
  }

  const entry: PtyEntry = { pty, agentId: agent.id, alive: true, buf: '', idleTimer: null }
  ptys.set(agent.id, entry)

  const scheduleIdleCheck = () => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => {
      if (!entry.alive) return
      // After 1.2s of silence, assume idle regardless of buffer content.
      // Claude Code's TUI has persistent spinner-like chars that would otherwise
      // keep detectActive firing even when waiting for input.
      onStatus?.(agent.id, 'idle', '')
    }, 1200)
  }

  pty.onData((data) => {
    try {
      send('terminal:output', agent.id, data)
      entry.buf = (entry.buf + data).slice(-1024)
      const active = detectActive(entry.buf)
      if (active) {
        if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null }
        onStatus?.(agent.id, active.status, active.activity)
      }
      scheduleIdleCheck()
    } catch (e) {
      console.error('[pty] onData error:', e)
    }
  })

  pty.onExit(({ exitCode }) => {
    try {
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      entry.alive = false
      ptys.delete(agent.id)
      send('agent:exited', agent.id)
      onExit?.(agent.id)
      if (exitCode && exitCode !== 0) {
        onStatus?.(agent.id, 'error', `Exited with code ${exitCode}`)
      }
    } catch (e) {
      console.error('[pty] onExit error:', e)
    }
  })
}

export function killAgent(id: string): void {
  const entry = ptys.get(id)
  if (entry) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.alive = false
    try { entry.pty.kill() } catch { /* already dead */ }
    ptys.delete(id)
  }
}

export function sendInput(id: string, data: string): void {
  const entry = ptys.get(id)
  if (entry?.alive) {
    // User sent input — claude will start thinking soon
    entry.buf = ''
    try { entry.pty.write(data) } catch { /* pty closed */ }
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const entry = ptys.get(id)
  if (entry?.alive && cols > 0 && rows > 0) {
    try { entry.pty.resize(cols, rows) } catch { /* pty closed */ }
  }
}

export function isRunning(id: string): boolean {
  return ptys.get(id)?.alive === true
}
