import { contextBridge, ipcRenderer } from 'electron'
import { Agent, StatusUpdate } from '../shared/types.js'

const api = {
  // State
  getState: () => ipcRenderer.invoke('agent:getState'),

  // Agent CRUD
  createAgent: (name: string, baseRepo: string | null, dest: string | null, worktree: boolean): Promise<Agent> => ipcRenderer.invoke('agent:create', name, baseRepo, dest, worktree),
  removeAgent: (id: string): Promise<void> => ipcRenderer.invoke('agent:remove', id),
  renameAgent: (id: string, name: string): Promise<void> => ipcRenderer.invoke('agent:rename', id, name),
  moveAgent: (id: string, direction: 'up' | 'down'): Promise<void> => ipcRenderer.invoke('agent:move', id, direction),
  reorderAgents: (orderedIds: string[]): Promise<void> => ipcRenderer.invoke('agent:reorder', orderedIds),
  markSeen:      (id: string): Promise<void> => ipcRenderer.invoke('agent:markSeen', id),
  ensureRunning: (id: string): Promise<void> => ipcRenderer.invoke('agent:ensureRunning', id),
  restartAgent: (id: string): Promise<void> => ipcRenderer.invoke('agent:restart', id),
  resetAgent:   (id: string): Promise<void> => ipcRenderer.invoke('agent:reset', id),
  setSelected: (id: string): Promise<void> => ipcRenderer.invoke('agent:setSelected', id),
  setBaseRepo: (path: string): Promise<void> => ipcRenderer.invoke('agent:setBaseRepo', path),
  pickBaseRepo: (): Promise<string | null> => ipcRenderer.invoke('agent:pickBaseRepo'),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('agent:pickDirectory'),

  // Terminal I/O
  sendInput: (id: string, data: string): void => ipcRenderer.send('terminal:input', id, data),
  resizeTerminal: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('terminal:resize', id, cols, rows),

  // Actions
  openVSCode: (id: string): Promise<void> => ipcRenderer.invoke('actions:openVSCode', id),
  openDiff: (id: string): Promise<void> => ipcRenderer.invoke('actions:openDiff', id),
  getChangedFiles: (id: string): Promise<number> => ipcRenderer.invoke('actions:getChangedFiles', id),
  getLineStats: (id: string): Promise<void> => ipcRenderer.invoke('actions:getLineStats', id),
  getGitLog: (id: string): Promise<Array<{ hash: string; message: string; date: string; author: string; filesChanged: number; linesAdded: number; linesRemoved: number }>> =>
    ipcRenderer.invoke('actions:getGitLog', id),
  openCommitDiff: (id: string, commitHash: string): Promise<void> => ipcRenderer.invoke('actions:openCommitDiff', id, commitHash),
  getPRNumber: (id: string): Promise<number | null> => ipcRenderer.invoke('actions:getPRNumber', id),
  openPR: (id: string): Promise<void> => ipcRenderer.invoke('actions:openPR', id),
  openRepo: (id: string): Promise<void> => ipcRenderer.invoke('actions:openRepo', id),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  clipboardWrite: (text: string): void => ipcRenderer.send('clipboard:write', text),
  clipboardRead: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: any) => ipcRenderer.invoke('settings:save', patch),
  onSettingsChanged: (cb: (s: any) => void) => {
    const h = (_: unknown, s: any) => cb(s)
    ipcRenderer.on('settings:changed', h)
    return () => ipcRenderer.off('settings:changed', h)
  },

  // Session logs
  listLogs: (agentId: string): Promise<Array<{ name: string; path: string; mtime: number }>> => ipcRenderer.invoke('logs:list', agentId),
  readLog: (logPath: string): Promise<string> => ipcRenderer.invoke('logs:read', logPath),

  // Shell (mini terminal)
  spawnShell: (agentId: string): Promise<void> => ipcRenderer.invoke('shell:spawn', agentId),
  killShell:  (agentId: string): Promise<void> => ipcRenderer.invoke('shell:kill', agentId),
  shellInput: (agentId: string, data: string): void => ipcRenderer.send('shell:input', agentId, data),
  shellResize:(agentId: string, cols: number, rows: number): void => ipcRenderer.send('shell:resize', agentId, cols, rows),
  onShellOutput: (cb: (agentId: string, data: string) => void) => {
    const h = (_: unknown, id: string, data: string) => cb(id, data)
    ipcRenderer.on('shell:output', h)
    return () => ipcRenderer.off('shell:output', h)
  },
  onShellExited: (cb: (agentId: string) => void) => {
    const h = (_: unknown, id: string) => cb(id)
    ipcRenderer.on('shell:exited', h)
    return () => ipcRenderer.off('shell:exited', h)
  },

  // Events from main → renderer
  onAgentList: (cb: (agents: Agent[]) => void) => {
    const handler = (_: unknown, agents: Agent[]) => cb(agents)
    ipcRenderer.on('agent:list', handler)
    return () => ipcRenderer.off('agent:list', handler)
  },
  onTerminalOutput: (cb: (id: string, data: string) => void) => {
    const handler = (_: unknown, id: string, data: string) => cb(id, data)
    ipcRenderer.on('terminal:output', handler)
    return () => ipcRenderer.off('terminal:output', handler)
  },
  onTerminalClear: (cb: (id: string) => void) => {
    const h = (_: unknown, id: string) => cb(id)
    ipcRenderer.on('terminal:clear', h)
    return () => ipcRenderer.off('terminal:clear', h)
  },
  onAgentFinished: (cb: (id: string, name: string) => void) => {
    const h = (_: unknown, id: string, name: string) => cb(id, name)
    ipcRenderer.on('agent:finished', h)
    return () => ipcRenderer.off('agent:finished', h)
  },
  onAgentExited: (cb: (id: string) => void) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on('agent:exited', handler)
    return () => ipcRenderer.off('agent:exited', handler)
  },
  onAgentStatusUpdate: (cb: (id: string, u: Partial<StatusUpdate>) => void) => {
    const handler = (_: unknown, id: string, u: Partial<StatusUpdate>) => cb(id, u)
    ipcRenderer.on('agent:statusUpdate', handler)
    return () => ipcRenderer.off('agent:statusUpdate', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
