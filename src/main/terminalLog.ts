import * as fs from 'fs'
import * as path from 'path'
import { configDir } from './setup.js'

const activeStreams = new Map<string, fs.WriteStream>()

function logsDir(): string {
  const dir = path.join(configDir(), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function agentLogDir(agentId: string): string {
  const dir = path.join(logsDir(), agentId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Strip ANSI escape sequences: CSI sequences, OSC sequences, simple escapes.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][A-B012]|\x1b[>=<]|\x1b\[[\?]?[0-9;]*[hlsr]|\r/g

function stripAnsi(data: string): string {
  return data.replace(ANSI_RE, '')
}

/**
 * Open a log file for an agent session. Call this when the PTY is spawned.
 * Returns the log file path.
 */
export function openLog(agentId: string): string {
  closeLog(agentId)
  const dir = agentLogDir(agentId)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = path.join(dir, `session-${timestamp}.log`)
  const stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' })
  activeStreams.set(agentId, stream)
  stream.write(`--- Session started: ${new Date().toISOString()} ---\n`)
  return logPath
}

/**
 * Append terminal output to the agent's active log file.
 * Strips ANSI escape codes before writing.
 */
export function writeLog(agentId: string, data: string): void {
  const stream = activeStreams.get(agentId)
  if (!stream) return
  const clean = stripAnsi(data)
  if (clean) stream.write(clean)
}

/**
 * Close the log file for an agent session. Call this when the PTY exits.
 */
export function closeLog(agentId: string): void {
  const stream = activeStreams.get(agentId)
  if (stream) {
    stream.write(`\n--- Session ended: ${new Date().toISOString()} ---\n`)
    stream.end()
    activeStreams.delete(agentId)
  }
}

/**
 * Remove all logs for an agent (when the agent is deleted).
 */
export function removeAgentLogs(agentId: string): void {
  closeLog(agentId)
  const dir = path.join(logsDir(), agentId)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch { /* ignore */ }
}

/**
 * List session log files for an agent, newest first.
 */
export function listLogs(agentId: string): Array<{ name: string; path: string; mtime: number }> {
  const dir = path.join(logsDir(), agentId)
  try {
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('session-') && f.endsWith('.log'))
      .map(f => {
        const fullPath = path.join(dir, f)
        const stat = fs.statSync(fullPath)
        return { name: f, path: fullPath, mtime: stat.mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

/**
 * Read a session log file contents.
 */
export function readLog(logPath: string): string {
  try {
    return fs.readFileSync(logPath, 'utf8')
  } catch {
    return ''
  }
}
