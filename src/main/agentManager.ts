import * as nodePty from 'node-pty'
import * as fs from 'fs'
import { BrowserWindow } from 'electron'
import { Agent, AgentStatus } from '../shared/types.js'
import { openLog, writeLog, closeLog } from './terminalLog.js'

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
  outputTimer: ReturnType<typeof setTimeout> | null
}

// Callback signature: sleepDetected=true means the transition was caused by
// sleep/wake, not by real agent activity. The caller should skip "done" logic.
type StatusCallback = (id: string, status: AgentStatus, activity: string, sleepDetected?: boolean, userTriggered?: boolean) => void

const ptys = new Map<string, PtyEntry>()
const lastSize = new Map<string, { cols: number; rows: number }>()
let mainWindow: BrowserWindow | null = null

export function setWindow(win: BrowserWindow): void {
  mainWindow = win
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

  const args: string[] = []
  if (skipPermissions) args.push('--dangerously-skip-permissions')
  if (resume) args.push('--continue')

  const size = lastSize.get(agent.id) ?? { cols: 120, rows: 40 }

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
      cols: size.cols,
      rows: size.rows,
    })
  } catch (err: any) {
    throw new Error(`Failed to start claude: ${err?.message ?? err}`)
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
    outputBuf: '', outputTimer: null,
  }
  ptys.set(agent.id, entry)

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

  const flushOutput = () => {
    if (entry.outputBuf) {
      send('terminal:output', agent.id, entry.outputBuf)
      entry.outputBuf = ''
    }
    entry.outputTimer = null
  }

  pty.onData((data) => {
    try {
      if (!entry.alive || ptys.get(agent.id) !== entry) return

      // Persist terminal output to disk.
      writeLog(agent.id, data)

      entry.outputBuf += data
      if (entry.outputTimer === null) {
        entry.outputTimer = setTimeout(flushOutput, 16)
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
      if (entry.outputTimer) { clearTimeout(entry.outputTimer); flushOutput() }
      closeLog(agent.id)
      entry.alive = false
      ptys.delete(agent.id)
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
    if (entry.outputTimer) { clearTimeout(entry.outputTimer); entry.outputTimer = null }
    closeLog(id)
    entry.alive = false
    try { entry.pty.kill() } catch { /* already dead */ }
    ptys.delete(id)
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
