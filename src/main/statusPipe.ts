import * as fs from 'fs'
import * as readline from 'readline'
import { StatusUpdate } from '../shared/types.js'

type StatusCallback = (agentId: string, update: StatusUpdate) => void

const activeReaders = new Map<string, AbortController>()

/**
 * Ensure a named pipe (FIFO) exists at the given path.
 * Uses mkfifo via child_process since Node.js has no native mkfifo.
 */
export function ensurePipe(pipePath: string): void {
  if (fs.existsSync(pipePath)) return
  const { execSync } = require('child_process')
  execSync(`mkfifo "${pipePath}"`)
}

/**
 * Start reading from the named pipe for an agent.
 * Calls callback whenever a valid StatusUpdate JSON line is received.
 * Loops on EOF (pipe write-end was closed when claude exits and restarts).
 */
export function startReading(agentId: string, pipePath: string, cb: StatusCallback): void {
  stopReading(agentId)
  const controller = new AbortController()
  activeReaders.set(agentId, controller)

  const loop = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        await readOnce(agentId, pipePath, cb, controller.signal)
      } catch {
        // Wait a bit before retry on error.
        await sleep(500)
      }
    }
  }
  loop()
}

async function readOnce(
  agentId: string,
  pipePath: string,
  cb: StatusCallback,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { resolve(); return }
    // Open with O_NONBLOCK would block here if no writer; use a normal open.
    let stream: fs.ReadStream
    try {
      stream = fs.createReadStream(pipePath, { encoding: 'utf8' })
    } catch (e) {
      reject(e)
      return
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const update: StatusUpdate = JSON.parse(line)
        cb(agentId, update)
      } catch { /* ignore non-JSON lines */ }
    })
    rl.on('close', () => resolve())
    rl.on('error', reject)
    signal.addEventListener('abort', () => { rl.close(); stream.destroy(); resolve() })
  })
}

export function stopReading(agentId: string): void {
  const ctrl = activeReaders.get(agentId)
  if (ctrl) { ctrl.abort(); activeReaders.delete(agentId) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
