import Store from 'electron-store'
import { AppState, PersistedAgent } from '../shared/types.js'

const defaults: AppState = {
  version: 1,
  agents: [],
  selectedAgentId: '',
  baseRepoPath: ''
}

// @ts-ignore — electron-store types are slightly off with ESM
const store = new Store<AppState>({ name: 'state', defaults })

export function loadState(): AppState {
  return {
    version: store.get('version', defaults.version),
    agents: store.get('agents', defaults.agents),
    selectedAgentId: store.get('selectedAgentId', defaults.selectedAgentId),
    baseRepoPath: store.get('baseRepoPath', defaults.baseRepoPath)
  }
}

export function saveAgents(agents: PersistedAgent[]): void {
  store.set('agents', agents)
}

export function saveSelectedAgent(id: string): void {
  store.set('selectedAgentId', id)
}

export function saveBaseRepo(path: string): void {
  store.set('baseRepoPath', path)
}
