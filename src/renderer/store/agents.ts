import { create } from 'zustand'
import { Agent, AgentStatus } from '../../shared/types'


interface AgentsState {
  agents: Agent[]
  selectedId: string
  baseRepoPath: string
  setAgents: (agents: Agent[]) => void
  selectAgent: (id: string) => void
  updateAgentStatus: (id: string, patch: Partial<Agent>) => void
  setBaseRepoPath: (path: string) => void
  markExited: (id: string) => void
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  selectedId: '',
  baseRepoPath: '',

  setAgents: (incoming) => {
    const list = incoming ?? []
    set((s) => {
      const same = s.agents.length === list.length &&
        s.agents.every((a, i) => {
          const b = list[i]
          return a.id === b.id && a.status === b.status && a.activity === b.activity &&
            a.contextPercent === b.contextPercent && a.costUSD === b.costUSD &&
            a.changedFiles === b.changedFiles && a.linesAdded === b.linesAdded && a.linesRemoved === b.linesRemoved && a.currentBranch === b.currentBranch &&
            a.prNumber === b.prNumber && a.prRepo === b.prRepo && a.prTitle === b.prTitle &&
            a.model === b.model && a.name === b.name &&
            a.workingStartedAt === b.workingStartedAt && a.lastTaskDuration === b.lastTaskDuration && a.lastFinishedAt === b.lastFinishedAt && a.lastInputAt === b.lastInputAt &&
            a.userInteracted === b.userInteracted && a.unseenResponse === b.unseenResponse
        })
      if (same) return s
      return { agents: list, selectedId: s.selectedId || list[0]?.id || '' }
    })
  },

  selectAgent: (id) => {
    set({ selectedId: id })
    window.api.setSelected(id)
  },

  updateAgentStatus: (id, patch) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a))
    })),

  setBaseRepoPath: (path) => set({ baseRepoPath: path }),

  markExited: (id) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, status: 'stopped' } : a))
    }))
}))

/** Wire up IPC listeners. Call once on app init. */
export function initStoreListeners(): void {
  window.api.onAgentList((agents) => {
    console.log('[store] onAgentList:', agents?.length, 'agents')
    useAgentsStore.getState().setAgents(agents)
  })

  window.api.onAgentExited((id) => {
    useAgentsStore.getState().markExited(id)
  })

  window.api.onAgentStatusUpdate((id, update: any) => {
    useAgentsStore.getState().updateAgentStatus(id, {
      contextPercent: update.contextPercent,
      tokensUsed: update.tokensUsed,
      costUSD: update.costUSD
    })
  })
}
