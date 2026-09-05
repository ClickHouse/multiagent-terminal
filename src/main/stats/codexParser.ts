import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ParsedApiCall, ParsedTurn, TokenUsage } from './types.js'
import { calculateCost } from './pricing.js'

// Codex writes one "rollout" JSONL per thread under ~/.codex/sessions/YYYY/MM/DD/
export const CODEX_SESSIONS_DIR = path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  'sessions'
)

/** Raw codex counters. Note: `input_tokens` already includes `cached_input_tokens`. */
export interface CodexUsage {
  input_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

export interface CodexSessionMeta {
  sessionId: string    // shared by a thread and the subagent threads it spawns
  threadId: string
  cwd: string
  isSubagent: boolean
}

export interface CodexSession extends CodexSessionMeta {
  filePath: string
  turns: ParsedTurn[]
}

// Only these entry types carry data we need. Tool *output* lines are the bulk of
// a rollout file (build logs, file dumps) and are skipped without a JSON.parse.
const RELEVANT = /"(session_meta|turn_context|token_usage_record|token_count|user_message|function_call|custom_tool_call|web_search_call|message)"/
const HEAD_SCAN = 400

// Instruction/context blobs codex injects as the first "user" message — not a prompt.
const SYNTHETIC_USER = /^\s*(# AGENTS\.md instructions|<environment_context>|<user_instructions>|<INSTRUCTIONS>)/

/** Split codex counters into the cache-aware shape the pricing table expects. */
export function toTokenUsage(u: CodexUsage | null | undefined): TokenUsage {
  const input = u?.input_tokens ?? 0
  const cached = u?.cached_input_tokens ?? 0
  return {
    inputTokens: Math.max(input - cached, 0),
    outputTokens: u?.output_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_write_input_tokens ?? 0,
    cacheReadInputTokens: cached,
  }
}

function isEmptyUsage(t: TokenUsage): boolean {
  return t.inputTokens === 0 && t.outputTokens === 0 &&
    t.cacheCreationInputTokens === 0 && t.cacheReadInputTokens === 0
}

export function findCodexSessionFiles(startDate?: Date, endDate?: Date): string[] {
  const out: string[] = []
  walkSessions(CODEX_SESSIONS_DIR, 0, out, startDate, endDate)
  return out
}

function walkSessions(dir: string, depth: number, out: string[], start?: Date, end?: Date): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (depth < 3) walkSessions(p, depth + 1, out, start, end)  // YYYY/MM/DD
      continue
    }
    if (!e.name.endsWith('.jsonl')) continue
    if (start && end) {
      try {
        const st = fs.statSync(p)
        if (st.mtime < start || st.mtime > end) continue
      } catch { continue }
    }
    out.push(p)
  }
}

/** Read just the session_meta header (first line) of a rollout file. */
export function readCodexSessionMeta(filePath: string): CodexSessionMeta | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(256 * 1024)
    const read = fs.readSync(fd, buf, 0, buf.length, 0)
    const text = buf.subarray(0, read).toString('utf8')
    const nl = text.indexOf('\n')
    if (nl < 0) return null
    const entry = JSON.parse(text.slice(0, nl))
    if (entry?.type !== 'session_meta') return null
    return metaFromPayload(entry.payload)
  } catch {
    return null
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch { /* ignore */ }
  }
}

function metaFromPayload(p: any): CodexSessionMeta {
  return {
    sessionId: p?.session_id ?? p?.id ?? '',
    threadId: p?.id ?? p?.session_id ?? '',
    cwd: p?.cwd ?? '',
    isSubagent: p?.thread_source === 'subagent',
  }
}

function userText(payload: any): string {
  const content = payload?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c: any) => typeof c?.text === 'string')
    .map((c: any) => c.text as string)
    .join(' ')
}

/**
 * Parse one rollout file into turns.
 *
 * Token accounting: newer codex writes a `token_usage_record` per model response.
 * Older versions only emit `event_msg/token_count`, whose `total_token_usage` is
 * cumulative — consecutive deltas reconstruct the same per-response numbers
 * (verified to match the record sum exactly on files that carry both).
 */
export function parseCodexSessionFile(filePath: string): CodexSession | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }

  const usePerResponseRecords = raw.includes('"token_usage_record"')
  // Old rollouts store the prompt as an event; newer ones as a response_item.
  // Trust one source per file so a turn is never counted twice.
  const useUserMessageEvents = raw.includes('"user_message"')

  let meta: CodexSessionMeta | null = null
  // Older rollouts write turn_context (the only place the model appears) well
  // after the first responses, so the model is back-filled once it is known.
  let model = ''
  let firstModel = ''
  const turns: ParsedTurn[] = []

  let curUserMsg = ''
  let curUserTs = ''
  let curCalls: ParsedApiCall[] = []
  let pendingTools: string[] = []
  let prevCumulative: CodexUsage | null = null

  const flushTurn = (): void => {
    if (pendingTools.length > 0 && curCalls.length > 0) {
      curCalls[curCalls.length - 1].tools.push(...pendingTools)
    }
    pendingTools = []
    if (curCalls.length > 0) {
      turns.push({
        userMessage: curUserMsg,
        assistantCalls: curCalls,
        timestamp: curUserTs,
        sessionId: meta?.sessionId ?? path.basename(filePath, '.jsonl'),
      })
    }
    curCalls = []
  }

  const addCall = (usage: TokenUsage, timestamp: string): void => {
    if (isEmptyUsage(usage)) return
    curCalls.push({
      model,
      usage,
      costUSD: calculateCost(model, usage),
      tools: pendingTools,
      timestamp,
      messageId: '',
    })
    pendingTools = []
  }

  for (const line of raw.split('\n')) {
    if (!line) continue
    if (!RELEVANT.test(line.slice(0, HEAD_SCAN))) continue

    let entry: any
    try {
      entry = JSON.parse(line)
    } catch { continue }
    const payload = entry?.payload
    if (!payload) continue

    switch (entry.type) {
      case 'session_meta':
        if (!meta) meta = metaFromPayload(payload)
        break

      case 'turn_context':
        if (typeof payload.model === 'string' && payload.model) {
          model = payload.model
          if (!firstModel) firstModel = model
        }
        break

      case 'token_usage_record':
        if (usePerResponseRecords) addCall(toTokenUsage(payload.usage), entry.timestamp ?? '')
        break

      case 'event_msg':
        if (payload.type === 'token_count') {
          const cum: CodexUsage | undefined = payload.info?.total_token_usage
          if (!cum) break
          if (!usePerResponseRecords) {
            const delta = prevCumulative ? diffUsage(cum, prevCumulative) : cum
            addCall(toTokenUsage(delta), entry.timestamp ?? '')
          }
          prevCumulative = cum
        } else if (payload.type === 'user_message' && useUserMessageEvents) {
          const text = String(payload.message ?? '')
          if (SYNTHETIC_USER.test(text)) break
          flushTurn()
          curUserMsg = text
          curUserTs = entry.timestamp ?? ''
        }
        break

      case 'response_item':
        if (payload.type === 'message' && payload.role === 'user' && !useUserMessageEvents) {
          const text = userText(payload)
          if (SYNTHETIC_USER.test(text)) break
          flushTurn()
          curUserMsg = text
          curUserTs = entry.timestamp ?? ''
        } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
          if (typeof payload.name === 'string' && payload.name) pendingTools.push(payload.name)
        } else if (payload.type === 'web_search_call') {
          pendingTools.push('web_search')
        }
        break
    }
  }

  flushTurn()

  if (firstModel) {
    for (const turn of turns) {
      for (const call of turn.assistantCalls) {
        if (call.model) continue
        call.model = firstModel
        call.costUSD = calculateCost(firstModel, call.usage)
      }
    }
  }

  if (!meta) return null
  return { filePath, ...meta, turns }
}

/** Per-field delta between two cumulative snapshots (0 on a counter reset). */
function diffUsage(cur: CodexUsage, prev: CodexUsage): CodexUsage {
  const d = (a?: number, b?: number): number => Math.max((a ?? 0) - (b ?? 0), 0)
  return {
    input_tokens: d(cur.input_tokens, prev.input_tokens),
    cached_input_tokens: d(cur.cached_input_tokens, prev.cached_input_tokens),
    cache_write_input_tokens: d(cur.cache_write_input_tokens, prev.cache_write_input_tokens),
    output_tokens: d(cur.output_tokens, prev.output_tokens),
  }
}

/** True when `child` is `parent` or a directory inside it. */
export function isUnder(child: string, parent: string): boolean {
  if (!child || !parent) return false
  const c = path.resolve(child)
  const p = path.resolve(parent)
  return c === p || c.startsWith(p + path.sep)
}
