import * as fs from 'fs'
import * as path from 'path'
import {
  CODEX_SESSIONS_DIR, CodexSessionMeta, CodexUsage,
  readCodexSessionMeta, toTokenUsage, isUnder,
} from './stats/codexParser.js'
import { calculateCost } from './stats/pricing.js'

/**
 * Live spend/context for a running codex agent.
 *
 * Codex has no statusline hook like Claude's, so the numbers come from the
 * rollout JSONL it appends to while it works: the tail carries a cumulative
 * `token_count` event after every model response.
 */
export interface CodexLiveUsage {
  model: string
  contextPercent: number
  tokensUsed: number          // tokens in the live context (last response)
  contextWindowSize: number
  costUSD: number             // whole session, subagent threads included
}

const TAIL_BYTES = 512 * 1024
const HEAD_BYTES = 1024 * 1024
const DAYS_BACK = 3                       // rollout dirs are ~/.codex/sessions/YYYY/MM/DD
const MAX_AGE_MS = 24 * 60 * 60 * 1000    // ignore rollouts nothing has touched lately

// Rollout files are append-only, so the header never changes.
const metaCache = new Map<string, CodexSessionMeta | null>()
// Last model seen per file — a long turn can push turn_context out of the tail window.
const modelCache = new Map<string, string>()

interface TailUsage {
  cumulative: CodexUsage | null
  last: CodexUsage | null
  contextWindow: number
  model: string
}

function dayDirs(): string[] {
  const dirs: string[] = []
  const now = new Date()
  for (let i = 0; i < DAYS_BACK; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    dirs.push(path.join(
      CODEX_SESSIONS_DIR,
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ))
  }
  return dirs
}

function recentRollouts(): Array<{ file: string; mtimeMs: number }> {
  const out: Array<{ file: string; mtimeMs: number }> = []
  const cutoff = Date.now() - MAX_AGE_MS
  for (const dir of dayDirs()) {
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const file = path.join(dir, name)
      try {
        const st = fs.statSync(file)
        if (st.mtimeMs < cutoff) continue
        out.push({ file, mtimeMs: st.mtimeMs })
      } catch { /* ignore */ }
    }
  }
  return out
}

function sessionMeta(file: string): CodexSessionMeta | null {
  const cached = metaCache.get(file)
  if (cached) return cached
  const meta = readCodexSessionMeta(file)
  if (meta) metaCache.set(file, meta)
  return meta
}

function readChunk(file: string, fromEnd: boolean, bytes: number): string {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(bytes, size)
    if (len === 0) return ''
    const start = fromEnd ? size - len : 0
    const buf = Buffer.alloc(len)
    const read = fs.readSync(fd, buf, 0, len, start)
    return buf.subarray(0, read).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch { /* ignore */ }
  }
}

/** First model the session ran with — used when the tail holds no turn_context. */
function headModel(file: string): string {
  const cached = modelCache.get(file)
  if (cached) return cached
  const text = readChunk(file, false, HEAD_BYTES)
  for (const line of text.split('\n')) {
    if (!line.includes('"turn_context"')) continue
    try {
      const entry = JSON.parse(line)
      const model = entry?.payload?.model
      if (typeof model === 'string' && model) {
        modelCache.set(file, model)
        return model
      }
    } catch { /* partial or unrelated line */ }
  }
  return ''
}

function tailUsage(file: string): TailUsage {
  const result: TailUsage = { cumulative: null, last: null, contextWindow: 0, model: '' }
  const text = readChunk(file, true, TAIL_BYTES)
  const lines = text.split('\n')
  // The first line is likely truncated mid-JSON.
  for (let i = lines.length - 1; i >= 1; i--) {
    const line = lines[i]
    if (!line) continue
    const isCount = !result.cumulative && line.includes('"token_count"')
    const isCtx = !result.model && line.includes('"turn_context"')
    if (!isCount && !isCtx) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch { continue }
    if (isCount && entry?.payload?.type === 'token_count') {
      const info = entry.payload.info
      result.cumulative = info?.total_token_usage ?? null
      result.last = info?.last_token_usage ?? null
      result.contextWindow = info?.model_context_window ?? 0
    } else if (isCtx && entry?.type === 'turn_context' && typeof entry.payload?.model === 'string') {
      result.model = entry.payload.model
    }
    if (result.cumulative && result.model) break
  }
  if (result.model) modelCache.set(file, result.model)
  else result.model = headModel(file)
  return result
}

/**
 * Read live usage for the newest codex session running in (or under) each cwd.
 * Batched so one poll tick scans the rollout dirs and tails each file once,
 * however many codex agents are running.
 */
export function readCodexUsage(cwds: string[]): Map<string, CodexLiveUsage> {
  const out = new Map<string, CodexLiveUsage>()
  if (cwds.length === 0) return out

  const candidates = recentRollouts()
  const tails = new Map<string, TailUsage>()
  const tailFor = (file: string): TailUsage => {
    let tail = tails.get(file)
    if (!tail) {
      tail = tailUsage(file)
      tails.set(file, tail)
    }
    return tail
  }

  for (const cwd of cwds) {
    let primary: { file: string; mtimeMs: number; meta: CodexSessionMeta } | null = null
    for (const c of candidates) {
      const meta = sessionMeta(c.file)
      if (!meta || meta.isSubagent || !isUnder(meta.cwd, cwd)) continue
      if (!primary || c.mtimeMs > primary.mtimeMs) primary = { ...c, meta }
    }
    if (!primary) continue

    const primaryTail = tailFor(primary.file)
    if (!primaryTail.cumulative) continue

    // Subagent threads bill separately and live in their own rollout files.
    let costUSD = 0
    for (const c of candidates) {
      const meta = sessionMeta(c.file)
      if (!meta || meta.sessionId !== primary.meta.sessionId) continue
      const tail = tailFor(c.file)
      if (!tail.cumulative) continue
      costUSD += calculateCost(tail.model, toTokenUsage(tail.cumulative))
    }

    const window = primaryTail.contextWindow
    const inContext = primaryTail.last?.total_tokens ?? 0
    out.set(cwd, {
      model: primaryTail.model,
      contextPercent: window > 0 ? Math.min((inContext / window) * 100, 100) : 0,
      tokensUsed: inContext,
      contextWindowSize: window,
      costUSD,
    })
  }

  return out
}
