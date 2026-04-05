export type AgentStatus =
  | 'starting'   // PTY spawning, claude loading
  | 'idle'       // at prompt, waiting for user input
  | 'thinking'   // LLM generating a response
  | 'working'    // executing tools (bash, file edits, etc.)
  | 'error'      // claude exited with error / crashed
  | 'stopped'    // PTY exited cleanly

export interface Agent {
  // Persisted
  id: string
  name: string
  worktreePath: string
  baseRepoPath: string
  branchName: string
  statusPipePath: string
  createdAt: string
  // Runtime only
  status: AgentStatus
  activity: string       // current activity text (e.g. "Reading 3 files…")
  model: string          // e.g. "claude-opus-4-5"
  contextPercent: number
  tokensUsed: number
  contextWindowSize: number
  costUSD: number
  changedFiles: number   // number of uncommitted changed files in worktree
  currentBranch: string    // live git branch (may differ from branchName after checkout)
  prNumber: number | null  // open PR number, null = no PR or unknown
  prRepo: string          // repo name shown in PR button, e.g. "myrepo"
  userInteracted: boolean  // user has sent input since last spawn (gate for notifications)
  unseenResponse: boolean  // agent finished since last time user opened it (drives badge)
}

export type PersistedAgent = Omit<
  Agent,
  'status' | 'activity' | 'model' | 'contextPercent' | 'tokensUsed' | 'contextWindowSize' | 'costUSD' | 'changedFiles' | 'currentBranch' | 'prNumber' | 'prRepo' | 'userInteracted' | 'unseenResponse'
>

export interface AppSettings {
  fontSize: number
  devTools: boolean
  resumeOnOpen: boolean  // pass --continue when opening agents (slower but restores context)
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 13,
  devTools: false,
  resumeOnOpen: true,
}

export interface AppState {
  version: number
  agents: PersistedAgent[]
  selectedAgentId: string
  baseRepoPath: string
}

export interface StatusUpdate {
  model?: string | { id?: string; name?: string; [key: string]: unknown }
  session_id?: string
  context_window: {
    used_percentage: number
    total_input_tokens: number
    context_window_size: number
  }
  cost: {
    total_cost_usd: number
  }
}
