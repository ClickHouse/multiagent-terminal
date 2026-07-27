export type AgentStatus =
  | 'starting'   // PTY spawning, claude loading
  | 'idle'       // at prompt, waiting for user input
  | 'thinking'   // LLM generating a response
  | 'working'    // executing tools (bash, file edits, etc.)
  | 'error'      // claude exited with error / crashed
  | 'stopped'    // PTY exited cleanly

export type AgentCli = 'claude' | 'codex' | 'opencode'

export const AGENT_CLIS: ReadonlyArray<{ id: AgentCli; label: string; command: string }> = [
  { id: 'claude',   label: 'Claude Code', command: 'claude' },
  { id: 'codex',    label: 'Codex',       command: 'codex' },
  { id: 'opencode', label: 'opencode',    command: 'opencode' },
]

export interface Agent {
  // Persisted
  id: string
  name: string
  worktreePath: string
  baseRepoPath: string
  branchName: string
  statusPipePath: string
  createdAt: string
  cli: AgentCli          // which coding CLI this agent runs
  launchModel: string    // claude: model id for --model; opencode: provider/model for --model; '' = CLI default; codex ignores
  opencodeConfig: string // opencode only: config file path passed via OPENCODE_CONFIG env, '' = opencode's own config resolution
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

// All currently-served Anthropic models, selectable per agent.
// id is passed to `claude --model` (and `/model` for running sessions).
export const CLAUDE_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '',                  label: 'Default' },
  { id: 'claude-fable-5',    label: 'Fable 5' },
  { id: 'claude-opus-5',     label: 'Opus 5' },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8' },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7' },
  { id: 'claude-opus-4-6',   label: 'Opus 4.6' },
  { id: 'claude-opus-4-5',   label: 'Opus 4.5' },
  { id: 'claude-opus-4-1',   label: 'Opus 4.1' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5' },
]

// Datalist suggestions for the opencode model field. Free text rules:
// any provider/model string opencode's auth knows about is valid.
export const OPENCODE_MODEL_SUGGESTIONS: ReadonlyArray<string> = [
  'anthropic/claude-fable-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-5.1-codex',
  'google/gemini-3-pro-preview',
  'openrouter/qwen/qwen3-coder',
]

export interface AppSettings {
  defaultCli: AgentCli   // CLI used for new agents (per-agent override on the card)
  fontSize: number
  scrollSpeed: number    // terminal scroll multiplier (1-10)
  scrollback: number     // max lines kept in terminal buffer
  skipPermissions: boolean  // pass --dangerously-skip-permissions
  devTools: boolean
  resumeOnOpen: boolean  // pass --continue when opening agents (slower but restores context)
  notifications: boolean
  brightAgents: number   // how many recent agents stay at full opacity in the list
  reduceRedraws: boolean // disable Claude's recap/spinner-tip chrome lines — each chrome height change triggers a full-viewport repaint that can duplicate lines in scrollback
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultCli: 'claude',
  fontSize: 13,
  scrollSpeed: 3,
  scrollback: 20000,
  skipPermissions: true,
  devTools: false,
  resumeOnOpen: true,
  notifications: false,
  brightAgents: 7,
  reduceRedraws: true,
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
