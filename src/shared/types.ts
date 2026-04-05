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
  linesAdded: number     // total lines added across changed files
  linesRemoved: number   // total lines removed across changed files
  currentBranch: string    // live git branch (may differ from branchName after checkout)
  prNumber: number | null  // open PR number, null = no PR or unknown
  prRepo: string          // repo name shown in PR button, e.g. "myrepo"
  prTitle: string         // PR title, empty = no PR or unknown
  userInteracted: boolean  // user has sent input since last spawn (gate for notifications)
  workingStartedAt: number | null  // timestamp when agent entered working/thinking state
  lastTaskDuration: number | null  // seconds the last active period took (shown in "done" badge)
  lastFinishedAt: number | null    // timestamp when agent last transitioned active→idle (drives recent highlight)
  lastInputAt: number | null       // timestamp when user last sent a prompt (Enter in terminal)
  unseenResponse: boolean          // agent finished since last time user opened it (drives badge)
}

export type PersistedAgent = Omit<
  Agent,
  'status' | 'activity' | 'model' | 'contextPercent' | 'tokensUsed' | 'contextWindowSize' | 'costUSD' | 'changedFiles' | 'linesAdded' | 'linesRemoved' | 'currentBranch' | 'prNumber' | 'prRepo' | 'prTitle' | 'workingStartedAt' | 'lastTaskDuration' | 'lastFinishedAt' | 'lastInputAt' | 'userInteracted' | 'unseenResponse'
>

export interface AppSettings {
  fontSize: number
  scrollSpeed: number    // terminal scroll multiplier (1-10)
  scrollback: number     // max lines kept in terminal buffer
  skipPermissions: boolean  // pass --dangerously-skip-permissions
  devTools: boolean
  resumeOnOpen: boolean  // pass --continue when opening agents (slower but restores context)
  notifications: boolean
  brightAgents: number   // how many recent agents stay at full opacity in the list
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 13,
  scrollSpeed: 3,
  scrollback: 20000,
  skipPermissions: true,
  devTools: false,
  resumeOnOpen: true,
  notifications: false,
  brightAgents: 7,
}

export interface AppState {
  version: number
  agents: PersistedAgent[]
  selectedAgentId: string
  baseRepoPath: string
}

// Stats types (shared between main and renderer)
export interface StatsBreakdownItem {
  name: string
  value: number
  count: number
}

export interface DailyStats {
  date: string
  cost: number
  calls: number
}

export interface StatsResult {
  summary: {
    totalCost: number
    apiCalls: number
    sessions: number
    cacheHitRate: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalCacheWriteTokens: number
  }
  daily: DailyStats[]
  projects: StatsBreakdownItem[]
  models: StatsBreakdownItem[]
  activities: StatsBreakdownItem[]
  tools: StatsBreakdownItem[]
}

export type StatsPeriod = 'today' | 'week' | 'month' | 'all'

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
