import * as fs from 'fs'
import { constants } from 'fs'
import * as net from 'net'
import * as readline from 'readline'
import { StatusUpdate } from '../shared/types.js'

type StatusCallback = (agentId: string, update: StatusUpdate) => void

const activeReaders = new Map<string, AbortController>()
const activeServers = new Map<string, net.Server>()

const isWindows = process.platform === 'win32'

/**
 * Ensure a named pipe exists at the given path.
 * - Unix (Linux/macOS): creates a FIFO via mkfifo
 * - Windows: no-op (named pipe is created when the server starts listening)
 */
export async function ensurePipe(pipePath: string): Promise<void> {
  if (isWindows) return  // Windows named pipes are created by net.createServer
  if (fs.existsSync(pipePath)) return
  const { exec } = require('child_process') as typeof import('child_process')
  return new Promise((resolve, reject) => {
    exec(`mkfifo "${pipePath}"`, (err: Error | null) => err ? reject(err) : resolve())
  })
}

/**
 * Start reading from the named pipe for an agent.
 * Calls callback whenever a valid StatusUpdate JSON line is received.
 */
export function startReading(agentId: string, pipePath: string, cb: StatusCallback): void {
  stopReading(agentId)

  if (isWindows) {
    startReadingWindows(agentId, pipePath, cb)
  } else {
    startReadingUnix(agentId, pipePath, cb)
  }
}

// --- Unix (Linux / macOS): FIFO-based reading ---

function startReadingUnix(agentId: string, pipePath: string, cb: StatusCallback): void {
  const controller = new AbortController()
  activeReaders.set(agentId, controller)

  const loop = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        await readOnceUnix(agentId, pipePath, cb, controller.signal)
      } catch {
        // ignore
      }
      // Always sleep between iterations to avoid spinning when the pipe
      // has no writer (O_NONBLOCK open succeeds but read gets instant EOF).
      if (!controller.signal.aborted) await sleep(1000)
    }
  }
  loop()
}

/**
 * Open a FIFO non-blocking and return the raw fd.
 * Uses fs.open (callback API) so there's no FileHandle to leak.
 */
function openNonBlocking(pipePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    fs.open(pipePath, constants.O_RDONLY | constants.O_NONBLOCK, (err, fd) => {
      err ? reject(err) : resolve(fd)
    })
  })
}

async function readOnceUnix(
  agentId: string,
  pipePath: string,
  cb: StatusCallback,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return

  // Open with O_NONBLOCK so we don't block the event loop waiting for a writer.
  let fd: number
  try {
    fd = await openNonBlocking(pipePath)
  } catch (e: any) {
    if (e?.code === 'ENXIO') return   // no writer yet — caller retries
    throw e
  }

  return new Promise((resolve, reject) => {
    let done = false
    // Hold a named listener so we can detach it on natural completion.
    // `{ once: true }` only auto-removes when the event FIRES — for a
    // long-lived agent the abort never fires, so without explicit removal
    // each FIFO open/close cycle leaks a closure pinning rl/stream/fd.
    const onAbort = (): void => finish()
    const finish = (err?: Error) => {
      if (done) return
      done = true
      signal.removeEventListener('abort', onAbort)
      rl.close()
      stream.destroy()   // autoClose (default) closes the fd
      err ? reject(err) : resolve()
    }

    // autoClose: true (default) — stream owns the fd and closes it on end/destroy.
    const stream = fs.createReadStream('', { fd, encoding: 'utf8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      let update: StatusUpdate
      try {
        update = JSON.parse(line)
      } catch { return /* ignore non-JSON lines */ }
      try {
        cb(agentId, update)
      } catch (e) {
        console.error(`[statusPipe] callback error for ${agentId}:`, e, '| line:', line.slice(0, 300))
      }
    })
    rl.on('close', () => finish())
    rl.on('error', (e) => finish(e))
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// --- Windows: named pipe server ---

function startReadingWindows(agentId: string, pipePath: string, cb: StatusCallback): void {
  const controller = new AbortController()
  activeReaders.set(agentId, controller)

  // Windows named pipe path: \\.\pipe\multiagent-<agentId>
  const winPipePath = pipePath.startsWith('\\\\.\\pipe\\') ? pipePath : `\\\\.\\pipe\\multiagent-${agentId}`

  const server = net.createServer((socket) => {
    const rl = readline.createInterface({ input: socket, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      let update: StatusUpdate
      try {
        update = JSON.parse(line)
      } catch { return /* ignore non-JSON lines */ }
      try {
        cb(agentId, update)
      } catch (e) {
        console.error(`[statusPipe] callback error for ${agentId}:`, e, '| line:', line.slice(0, 300))
      }
    })
    socket.on('error', () => {})
  })

  server.on('error', () => {})
  server.listen(winPipePath)
  activeServers.set(agentId, server)

  controller.signal.addEventListener('abort', () => {
    server.close()
    activeServers.delete(agentId)
  }, { once: true })
}

export function stopReading(agentId: string): void {
  const ctrl = activeReaders.get(agentId)
  if (ctrl) { ctrl.abort(); activeReaders.delete(agentId) }
  const srv = activeServers.get(agentId)
  if (srv) { srv.close(); activeServers.delete(agentId) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
