export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export interface ParsedApiCall {
  model: string
  usage: TokenUsage
  costUSD: number
  tools: string[]
  timestamp: string
  messageId: string
}

export interface ParsedTurn {
  userMessage: string
  assistantCalls: ParsedApiCall[]
  timestamp: string
  sessionId: string
}

export type TaskCategory =
  | 'coding'
  | 'debugging'
  | 'feature'
  | 'refactoring'
  | 'testing'
  | 'exploration'
  | 'planning'
  | 'git'
  | 'build'
  | 'conversation'
  | 'general'

export interface ClassifiedTurn extends ParsedTurn {
  category: TaskCategory
}

export interface StatsBreakdownItem {
  name: string
  value: number   // cost USD or count
  count: number   // number of calls/turns
}

export interface DailyStats {
  date: string    // YYYY-MM-DD
  cost: number
  calls: number
}

export interface StatsResult {
  summary: {
    totalCost: number
    apiCalls: number
    sessions: number
    cacheHitRate: number     // 0-100
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

export type Period = 'today' | 'week' | 'month' | 'all'

// Raw JSONL entry shape (subset of fields we care about)
export interface JournalEntry {
  type: string
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  sessionId?: string
  isSidechain?: boolean
  message?: {
    role?: string
    content?: string | ContentBlock[]
    model?: string
    id?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
  [key: string]: unknown
}

export interface ContentBlock {
  type: string
  name?: string
  text?: string
  input?: Record<string, unknown>
  [key: string]: unknown
}
