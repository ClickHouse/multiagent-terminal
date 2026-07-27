import * as nodePty from 'node-pty'
import * as fs from 'fs'
import { BrowserWindow } from 'electron'
import { Agent, AgentStatus } from '../shared/types.js'
import { openLog, writeLog, closeLog } from './terminalLog.js'
import { getSettings } from './settings.js'

/**
 * Agent status state machine:
 *
 *   idle ──(user sends Enter)──→ thinking
 *   thinking ──(substantial output)──→ working
 *   thinking ──(60s timeout)──→ idle
 *   working ──(3s silence)──→ idle
 *   any ──(pty exits)──→ stopped/error
 *
 * Sleep/wake handling:
 *   All timer callbacks check wall-clock drift. If the timer was
 *   scheduled for N ms but >4×N elapsed, the PC was asleep. In that
 *   case, transition to idle quietly (no "done" badge, no duration).
 */

interface PtyEntry {
  pty: nodePty.IPty
  agentId: string
  alive: boolean
  currentStatus: 'idle' | 'thinking' | 'working'
  userStartedThisCycle: boolean  // true only if markThinking was called for the current active cycle
  idleTimer: ReturnType<typeof setTimeout> | null
  thinkingTimer: ReturnType<typeof setTimeout> | null
  outputSinceThinking: number
  outputBuf: string
  outputBufTrimmed: boolean  // buffer head was cut mid-TUI-frame (see MAX_OUTPUT_BUF)
  lastFlushAt: number
}

// Callback signature: sleepDetected=true means the transition was caused by
// sleep/wake, not by real agent activity. The caller should skip "done" logic.
type StatusCallback = (id: string, status: AgentStatus, activity: string, sleepDetected?: boolean, userTriggered?: boolean) => void

const ptys = new Map<string, PtyEntry>()
const lastSize = new Map<string, { cols: number; rows: number }>()
let mainWindow: BrowserWindow | null = null
let selectedAgentId = ''

// Single shared flush interval for IPC output. Runs at 33ms (~30 Hz) — the
// renderer can't repaint xterm faster than its own ~30 Hz flush (Terminal.tsx),
// so a 60 Hz tick here just doubled main-process sends that the renderer
// coalesced away. Unselected agents are coalesced to 500ms by checking
// `lastFlushAt`. Started on first spawn, stopped when the last PTY exits, so an
// idle app doesn't tick for nothing.
const IPC_TICK_MS = 33
const BACKGROUND_FLUSH_MS = 500
let ipcFlushInterval: ReturnType<typeof setInterval> | null = null

// Only the SELECTED agent streams live. Background agents would otherwise
// flood the renderer with IPC it can't drain fast enough — the messages pile
// up in the main process's native IPC queue (JS heap stays flat, RSS climbs
// unbounded). Their output is still captured to the log file, and a capped
// tail is buffered in `outputBuf` (see onData) and flushed once on switch.
// Drain a PTY's IPC buffer. If the buffer head was trimmed (MAX_OUTPUT_BUF),
// the tail starts mid-frame of Claude's TUI stream — its relative cursor moves
// would compose with whatever is on screen and interleave two frames. Prefix a
// clear-screen+home so the replay paints from blank; the tail always ends with
// a complete frame, so the terminal lands in the correct current state.
function takeOutputBuf(entry: PtyEntry): string {
  const data = entry.outputBufTrimmed ? '\x1b[2J\x1b[H' + entry.outputBuf : entry.outputBuf
  entry.outputBuf = ''
  entry.outputBufTrimmed = false
  entry.lastFlushAt = Date.now()
  return data
}

function ipcTick(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  const entry = ptys.get(selectedAgentId)
  if (entry?.alive && entry.outputBuf) {
    mainWindow.webContents.send('terminal:output', selectedAgentId, takeOutputBuf(entry))
  }
}

function ensureFlushInterval(): void {
  if (ipcFlushInterval) return
  ipcFlushInterval = setInterval(ipcTick, IPC_TICK_MS)
  if (typeof ipcFlushInterval.unref === 'function') ipcFlushInterval.unref()
}

function stopFlushIntervalIfIdle(): void {
  if (ipcFlushInterval && ptys.size === 0) {
    clearInterval(ipcFlushInterval)
    ipcFlushInterval = null
  }
}

export function setWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function setSelectedAgent(id: string): void {
  selectedAgentId = id
  // Immediately flush buffered output for the newly-selected agent
  const entry = ptys.get(id)
  if (entry?.outputBuf) {
    send('terminal:output', id, takeOutputBuf(entry))
  }
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/** Check if a timer fired way later than expected (PC was asleep). */
function isSleepWake(scheduledAt: number, expectedMs: number): boolean {
  return (Date.now() - scheduledAt) > expectedMs * 4
}

const OUTPUT_THRESHOLD = 200
// Max bytes retained in a PTY's IPC buffer. Background agents aren't drained
// by ipcTick, so without this their buffer would grow unbounded in the heap.
const MAX_OUTPUT_BUF = 256 * 1024

export function spawnAgent(
  agent: Agent,
  resume = false,
  onExit?: (id: string) => void,
  onStatus?: StatusCallback,
  skipPermissions = true
): void {
  killAgent(agent.id)

  if (!fs.existsSync(agent.worktreePath)) {
    throw new Error(`Working directory does not exist: ${agent.worktreePath}`)
  }

  const cli = agent.cli === 'codex' ? 'codex' : 'claude'
  const args: string[] = []
  if (cli === 'codex') {
    if (resume) args.push('resume', '--last')
    if (skipPermissions) args.push('--dangerously-bypass-approvals-and-sandbox')
    // launchModel holds Claude model ids — not passed to codex.
  } else {
    if (skipPermissions) args.push('--dangerously-skip-permissions')
    if (resume) args.push('--continue')
    if (agent.launchModel) args.push('--model', agent.launchModel)
    if (getSettings().reduceRedraws) {
      // Recap and spinner-tip lines change the height of Claude's bottom
      // chrome after a response; each height change triggers a full-viewport
      // repaint, and when the last message is taller than the viewport every
      // repaint leaks a duplicate of the viewport-top line into scrollback.
      args.push('--settings', JSON.stringify({ awaySummaryEnabled: false, spinnerTipsEnabled: false }))
    }
  }

  const size = lastSize.get(agent.id) ?? { cols: 120, rows: 40 }

  let pty: nodePty.IPty
  try {
    pty = nodePty.spawn(cli, args, {
      name: 'xterm-256color',
      cwd: agent.worktreePath,
      env: {
        ...process.env,
        MULTIAGENT_STATUS_PIPE: agent.statusPipePath,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      } as Record<string, string>,
      cols: size.cols,
      rows: size.rows,
    })
  } catch (err: any) {
    throw new Error(`Failed to start ${cli}: ${err?.message ?? err}`)
  }

  // Open a session log file for this agent.
  openLog(agent.id)

  // When resuming (--continue), Claude will start generating immediately.
  // Begin in 'thinking' so the output/pipe tracking picks up the activity.
  // Keep userStartedThisCycle=false — the auto-resume isn't user-triggered,
  // so no "done" badge should fire when it finishes.
  const entry: PtyEntry = {
    pty, agentId: agent.id, alive: true,
    currentStatus: resume ? 'thinking' : 'idle',
    userStartedThisCycle: false,
    idleTimer: null, thinkingTimer: null,
    outputSinceThinking: 0,
    outputBuf: '', outputBufTrimmed: false, lastFlushAt: 0,
  }
  ptys.set(agent.id, entry)
  ensureFlushInterval()

  const setStatus = (status: 'idle' | 'thinking' | 'working', sleep = false) => {
    if (entry.currentStatus === status) return
    const wasUserTriggered = entry.userStartedThisCycle
    if (status === 'idle') entry.userStartedThisCycle = false  // reset on every idle
    entry.currentStatus = status
    onStatus?.(agent.id, status, '', sleep, wasUserTriggered)
  }

  const clearTimers = () => {
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null }
    if (entry.thinkingTimer) { clearTimeout(entry.thinkingTimer); entry.thinkingTimer = null }
  }

  const IDLE_TIMEOUT = 3000

  const scheduleIdle = () => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    const scheduledAt = Date.now()
    entry.idleTimer = setTimeout(() => {
      if (!entry.alive) return
      setStatus('idle', isSleepWake(scheduledAt, IDLE_TIMEOUT))
    }, IDLE_TIMEOUT)
  }

  pty.onData((data) => {
    try {
      if (!entry.alive || ptys.get(agent.id) !== entry) return

      // Persist terminal output to disk (buffered inside terminalLog).
      writeLog(agent.id, data)

      // Buffer for IPC; shared setInterval drains it at the right cadence.
      // Only the selected agent is drained (see ipcTick), so a background
      // agent's buffer would grow unbounded — cap it to a recent tail,
      // trimmed at a newline so we don't slice an escape sequence. The
      // selected agent is drained every 16ms so it never reaches the cap.
      entry.outputBuf += data
      if (entry.outputBuf.length > MAX_OUTPUT_BUF) {
        const buf = entry.outputBuf
        const cut = buf.indexOf('\n', buf.length - MAX_OUTPUT_BUF)
        entry.outputBuf = buf.slice(cut >= 0 ? cut + 1 : buf.length - MAX_OUTPUT_BUF)
        entry.outputBufTrimmed = true  // takeOutputBuf clears the screen before replaying this tail
      }

      if (entry.currentStatus === 'thinking') {
        entry.outputSinceThinking += data.length
        if (entry.outputSinceThinking > OUTPUT_THRESHOLD) {
          clearTimers()
          setStatus('working')
          scheduleIdle()
        }
      } else if (entry.currentStatus === 'working') {
        scheduleIdle()
      }
      // idle: ignore output
    } catch (e) {
      console.error('[pty] onData error:', e)
    }
  })

  pty.onExit(({ exitCode }) => {
    try {
      if (ptys.get(agent.id) !== entry) return
      clearTimers()
      if (entry.outputBuf) {
        send('terminal:output', agent.id, takeOutputBuf(entry))
      }
      closeLog(agent.id)
      entry.alive = false
      ptys.delete(agent.id)
      stopFlushIntervalIfIdle()
      send('agent:exited', agent.id)
      onExit?.(agent.id)
      if (exitCode && exitCode !== 0) {
        onStatus?.(agent.id, 'error', '')
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
    if (entry.thinkingTimer) clearTimeout(entry.thinkingTimer)
    closeLog(id)
    entry.alive = false
    entry.outputBuf = ''
    try { entry.pty.kill() } catch { /* already dead */ }
    ptys.delete(id)
    stopFlushIntervalIfIdle()
  }
}

export function sendInput(id: string, data: string): void {
  const entry = ptys.get(id)
  if (entry?.alive) {
    try { entry.pty.write(data) } catch { /* pty closed */ }
  }
}

const THINKING_TIMEOUT = 60_000

export function markThinking(id: string, onStatus?: StatusCallback): void {
  const entry = ptys.get(id)
  if (!entry?.alive) return

  if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null }
  if (entry.thinkingTimer) { clearTimeout(entry.thinkingTimer); entry.thinkingTimer = null }

  entry.outputSinceThinking = 0
  entry.userStartedThisCycle = true
  entry.currentStatus = 'thinking'
  onStatus?.(id, 'thinking', '')

  const scheduledAt = Date.now()
  entry.thinkingTimer = setTimeout(() => {
    if (!entry.alive || entry.currentStatus !== 'thinking') return
    const wasUserTriggered = entry.userStartedThisCycle
    entry.userStartedThisCycle = false
    entry.currentStatus = 'idle'
    onStatus?.(id, 'idle', '', isSleepWake(scheduledAt, THINKING_TIMEOUT), wasUserTriggered)
  }, THINKING_TIMEOUT)
}

export function notifyPipeUpdate(id: string, onStatus?: StatusCallback): void {
  const entry = ptys.get(id)
  if (!entry?.alive) return

  if (entry.currentStatus === 'thinking') {
    if (entry.thinkingTimer) { clearTimeout(entry.thinkingTimer); entry.thinkingTimer = null }
    entry.currentStatus = 'working'
    onStatus?.(id, 'working', '')

    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    const scheduledAt = Date.now()
    entry.idleTimer = setTimeout(() => {
      if (!entry.alive || entry.currentStatus !== 'working') return
      const wasUserTriggered = entry.userStartedThisCycle
      entry.userStartedThisCycle = false
      entry.currentStatus = 'idle'
      onStatus?.(entry.agentId, 'idle', '', isSleepWake(scheduledAt, 3000), wasUserTriggered)
    }, 3000)
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  if (cols > 0 && rows > 0) lastSize.set(id, { cols, rows })
  const entry = ptys.get(id)
  if (entry?.alive && cols > 0 && rows > 0) {
    try { entry.pty.resize(cols, rows) } catch { /* pty closed */ }
  }
}

export function isRunning(id: string): boolean {
  return ptys.get(id)?.alive === true
}
