import * as nodePty from 'node-pty'
import * as os from 'os'
import { BrowserWindow } from 'electron'

interface ShellEntry {
  pty: nodePty.IPty
  agentId: string
  alive: boolean
}

const shells = new Map<string, ShellEntry>()
let mainWindow: BrowserWindow | null = null

export function setWindow(win: BrowserWindow): void {
  mainWindow = win
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

export function spawnShell(agentId: string, cwd: string): void {
  killShell(agentId)

  const shell = process.env.SHELL || (os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash')

  let pty: nodePty.IPty
  try {
    pty = nodePty.spawn(shell, [], {
      name: 'xterm-256color',
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
      cols: 220,
      rows: 10,
    })
  } catch (err: any) {
    throw new Error(`Failed to start shell: ${err?.message ?? err}`)
  }

  const entry: ShellEntry = { pty, agentId, alive: true }
  shells.set(agentId, entry)

  pty.onData((data) => {
    try { send('shell:output', agentId, data) }
    catch (e) { console.error('[shell] onData error:', e) }
  })

  pty.onExit(() => {
    try {
      entry.alive = false
      shells.delete(agentId)
      send('shell:exited', agentId)
    } catch (e) { console.error('[shell] onExit error:', e) }
  })
}

export function killShell(agentId: string): void {
  const entry = shells.get(agentId)
  if (entry) {
    entry.alive = false
    try { entry.pty.kill() } catch { /* already dead */ }
    shells.delete(agentId)
  }
}

export function sendInput(agentId: string, data: string): void {
  const entry = shells.get(agentId)
  if (entry?.alive) {
    try { entry.pty.write(data) } catch { /* closed */ }
  }
}

export function resize(agentId: string, cols: number, rows: number): void {
  const entry = shells.get(agentId)
  if (entry?.alive && cols > 0 && rows > 0) {
    try { entry.pty.resize(cols, rows) } catch { /* closed */ }
  }
}

export function killAll(): void {
  for (const [id] of shells) killShell(id)
}
