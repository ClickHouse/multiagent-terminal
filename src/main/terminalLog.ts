import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Worker } from 'worker_threads'
import { configDir } from './setup.js'
import { SEARCH_WORKER_CODE } from './searchWorker.js'

const activeStreams = new Map<string, fs.WriteStream>()
const activeLogFiles = new Map<string, string>() // agentId → current log filename
// Chunks are accumulated in an array and joined on flush — string concat
// per chunk is O(n²) for bursty output with many small writes.
const pendingWrites = new Map<string, string[]>() // agentId → unflushed cleaned chunks
const LOG_FLUSH_MS = 250
let logFlushInterval: ReturnType<typeof setInterval> | null = null

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
  // Most plain-text chunks have no ANSI/CR — skip the regex scan entirely.
  if (data.indexOf('\x1b') < 0 && data.indexOf('\r') < 0) return data
  return data.replace(ANSI_RE, '')
}

function flushPendingWrite(agentId: string): void {
  const chunks = pendingWrites.get(agentId)
  if (!chunks || chunks.length === 0) return
  const data = chunks.length === 1 ? chunks[0] : chunks.join('')
  chunks.length = 0
  const stream = activeStreams.get(agentId)
  if (stream) stream.write(data)
}

function flushAllPendingWrites(): void {
  for (const agentId of pendingWrites.keys()) flushPendingWrite(agentId)
}

function ensureLogFlushInterval(): void {
  if (logFlushInterval) return
  logFlushInterval = setInterval(flushAllPendingWrites, LOG_FLUSH_MS)
  // Don't keep the event loop alive just for log flushing.
  if (typeof logFlushInterval.unref === 'function') logFlushInterval.unref()
}

function stopLogFlushIntervalIfIdle(): void {
  if (logFlushInterval && activeStreams.size === 0) {
    clearInterval(logFlushInterval)
    logFlushInterval = null
  }
}

// ── Search worker ──────────────────────────────────────────────────────

let worker: Worker | null = null
let requestId = 0
const pendingSearches = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()

export function initSearchWorker(): void {
  if (worker) return
  // Write worker code to a temp file — avoids needing a separate build entry
  const workerPath = path.join(os.tmpdir(), 'multiagent-search-worker.js')
  try {
    fs.writeFileSync(workerPath, SEARCH_WORKER_CODE, 'utf8')
    worker = new Worker(workerPath, { workerData: { logsDir: logsDir() } })
    worker.on('message', (msg: any) => {
      if (msg.type === 'searchResult') {
        const pending = pendingSearches.get(msg.id)
        if (pending) {
          pendingSearches.delete(msg.id)
          pending.resolve(msg.results)
        }
      } else if (msg.type === 'ready') {
        console.log(`[search] worker ready: ${msg.fileCount} files, ${msg.trigramCount} trigrams`)
      } else if (msg.type === 'log') {
        console.log(`[search] ${msg.message}`)
      }
    })
    worker.on('error', (err) => {
      console.error('[search] worker error:', err)
    })
    worker.on('exit', (code) => {
      console.log('[search] worker exited:', code)
      worker = null
      // Reject any pending searches
      for (const [, p] of pendingSearches) p.reject(new Error('Worker exited'))
      pendingSearches.clear()
    })
  } catch (e: any) {
    console.error('[search] failed to start worker:', e?.message)
  }
}

function sendToWorker(msg: any): void {
  if (!worker) initSearchWorker()
  worker?.postMessage(msg)
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Open a log file for an agent session. Call this when the PTY is spawned.
 * Returns the log file path.
 */
export function openLog(agentId: string): string {
  closeLog(agentId)
  const dir = agentLogDir(agentId)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `session-${timestamp}.log`
  const logPath = path.join(dir, fileName)
  const stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' })
  activeStreams.set(agentId, stream)
  activeLogFiles.set(agentId, fileName)
  pendingWrites.set(agentId, [])
  stream.write(`--- Session started: ${new Date().toISOString()} ---\n`)
  ensureLogFlushInterval()
  return logPath
}

/**
 * Append terminal output to the agent's active log file.
 * Strips ANSI escape codes and coalesces small writes into one `stream.write`
 * per LOG_FLUSH_MS window — turns ~150 syscw/s into single digits at the cost
 * of up to LOG_FLUSH_MS of log latency.
 *
 * Live search indexing was intentionally removed: the worker lazy-refreshes
 * from disk on each search request instead.
 */
export function writeLog(agentId: string, data: string): void {
  const chunks = pendingWrites.get(agentId)
  if (!chunks) return
  const clean = stripAnsi(data)
  if (!clean) return
  chunks.push(clean)
}

/**
 * Close the log file for an agent session. Call this when the PTY exits.
 */
export function closeLog(agentId: string): void {
  flushPendingWrite(agentId)
  pendingWrites.delete(agentId)
  const stream = activeStreams.get(agentId)
  if (stream) {
    stream.write(`\n--- Session ended: ${new Date().toISOString()} ---\n`)
    stream.end()
    activeStreams.delete(agentId)
    activeLogFiles.delete(agentId)
  }
  stopLogFlushIntervalIfIdle()
}

/**
 * Remove all logs for an agent (when the agent is deleted).
 */
export function removeAgentLogs(agentId: string): void {
  closeLog(agentId)
  sendToWorker({ type: 'remove', agentId })
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

export interface SearchMatch {
  agentId: string
  logFile: string
  line: string
  lineNumber: number
  contextBefore: string
  contextAfter: string
}

/**
 * Search terminal logs via the worker thread.
 * Uses trigram index for fast candidate filtering, then verifies matches.
 */
export function searchLogs(
  query: string,
  agentIds?: string[],
  maxResults = 200,
): Promise<SearchMatch[]> {
  if (!query) return Promise.resolve([])

  return new Promise((resolve, reject) => {
    const id = ++requestId
    pendingSearches.set(id, { resolve, reject })
    sendToWorker({ type: 'search', id, query, agentIds, maxResults })

    // Timeout after 30s
    setTimeout(() => {
      if (pendingSearches.has(id)) {
        pendingSearches.delete(id)
        reject(new Error('Search timeout'))
      }
    }, 30000)
  })
}

/**
 * Shut down the search worker cleanly.
 */
export function shutdownSearchWorker(): void {
  worker?.terminate()
  worker = null
}
