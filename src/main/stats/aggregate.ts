import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Period, StatsResult, StatsBreakdownItem, DailyStats, ParsedTurn } from './types.js'
import { discoverProjectDirs, findSessionFiles, parseSessionFile, findMatchingDirs } from './parser.js'
import { findCodexSessionFiles, parseCodexSessionFile, isUnder } from './codexParser.js'
import { classifyTurn } from './classifier.js'
import { loadPricing, shortModelName } from './pricing.js'

const CLI_LABELS = { claude: 'Claude Code', codex: 'Codex' } as const

function debugLog(msg: string): void {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'multiagent-stats.log'), `${new Date().toISOString()} ${msg}\n`)
  } catch {}
}

// --- Result cache (60s TTL) ---
interface CacheEntry {
  result: StatsResult
  ts: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL = 60_000

function cacheKey(period: Period, projectPath?: string): string {
  return `${period}:${projectPath ?? '*'}`
}

export function clearStatsCache(): void {
  cache.clear()
}

// ---------------------------------

function getDateRange(period: Period): { start: Date; end: Date } | null {
  if (period === 'all') return null

  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  let start: Date

  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      break
    case 'week':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0)
      break
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
      break
  }

  return { start, end }
}

// Day buckets are local-time: the chart's axis is built from local dates, so
// keying the data by the UTC date would shift every bar (and drop today's).
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shortProjectName(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/')
}

function toBreakdownList(map: Map<string, { value: number; count: number }>): StatsBreakdownItem[] {
  return Array.from(map.entries())
    .map(([name, { value, count }]) => ({ name, value, count }))
    .sort((a, b) => b.value - a.value)
}

export async function aggregate(period: Period, projectPath?: string): Promise<StatsResult> {
  // Check cache
  const key = cacheKey(period, projectPath)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.result
  }

  // Non-blocking: don't let a slow network fetch delay results
  loadPricing().catch(() => {})

  const range = getDateRange(period)
  const start = range?.start
  const end = range?.end
  debugLog(`period=${period} start=${start ?? 'none'} end=${end ?? 'none'} path=${projectPath ?? '*'}`)

  // Discover which project dirs to scan
  let projectDirs: Array<{ dirPath: string; decodedPath: string }>
  if (projectPath) {
    const matchingPaths = findMatchingDirs(projectPath)
    projectDirs = matchingPaths.map(p => ({
      dirPath: p,
      decodedPath: projectPath,
    }))
  } else {
    projectDirs = discoverProjectDirs().map(d => ({
      dirPath: d.dirPath,
      decodedPath: d.decodedPath,
    }))
  }

  // Aggregate accumulators
  let totalCost = 0, apiCalls = 0, totalInput = 0, totalOutput = 0
  let totalCacheRead = 0, totalCacheWrite = 0
  const sessionIds = new Set<string>()
  const dailyMap = new Map<string, { cost: number; calls: number }>()
  const projectMap = new Map<string, { value: number; count: number }>()
  const modelMap = new Map<string, { value: number; count: number }>()
  const activityMap = new Map<string, { value: number; count: number }>()
  const toolMap = new Map<string, { value: number; count: number }>()
  const cliMap = new Map<string, { value: number; count: number }>()

  // Shared by the Claude and codex passes: folds one turn into every breakdown
  // except the per-project one (callers roll that up per session file).
  const addTurn = (turn: ParsedTurn, cliLabel: string): { cost: number; calls: number } => {
    // Filter turns by timestamp within range (skip for 'all')
    if (start && end) {
      const ts = turn.timestamp ? new Date(turn.timestamp) : null
      if (ts && (ts < start || ts > end)) return { cost: 0, calls: 0 }
    }

    const classified = classifyTurn(turn)
    const turnCost = turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0)
    const turnCalls = turn.assistantCalls.length

    sessionIds.add(turn.sessionId)
    totalCost += turnCost
    apiCalls += turnCalls

    const act = activityMap.get(classified.category) ?? { value: 0, count: 0 }
    activityMap.set(classified.category, { value: act.value + turnCost, count: act.count + 1 })

    const cli = cliMap.get(cliLabel) ?? { value: 0, count: 0 }
    cliMap.set(cliLabel, { value: cli.value + turnCost, count: cli.count + turnCalls })

    for (const call of turn.assistantCalls) {
      totalInput += call.usage.inputTokens
      totalOutput += call.usage.outputTokens
      totalCacheRead += call.usage.cacheReadInputTokens
      totalCacheWrite += call.usage.cacheCreationInputTokens

      // Model breakdown
      const modelName = shortModelName(call.model)
      const m = modelMap.get(modelName) ?? { value: 0, count: 0 }
      modelMap.set(modelName, { value: m.value + call.costUSD, count: m.count + 1 })

      // Tool breakdown
      for (const tool of call.tools) {
        if (tool.startsWith('mcp__')) continue
        const t = toolMap.get(tool) ?? { value: 0, count: 0 }
        toolMap.set(tool, { value: t.value, count: t.count + 1 })
      }

      // Daily breakdown
      const ts = call.timestamp || turn.timestamp
      const at = ts ? new Date(ts) : null
      if (at && !isNaN(at.getTime())) {
        const day = localDayKey(at)
        const d = dailyMap.get(day) ?? { cost: 0, calls: 0 }
        dailyMap.set(day, { cost: d.cost + call.costUSD, calls: d.calls + 1 })
      }
    }

    return { cost: turnCost, calls: turnCalls }
  }

  debugLog(`scanning ${projectDirs.length} project dirs`)
  let _dbgFiles = 0
  for (const { dirPath, decodedPath } of projectDirs) {
    const files = findSessionFiles(dirPath, start, end)
    _dbgFiles += files.length
    if (files.length === 0) continue

    let projectCost = 0
    let projectCalls = 0

    for (const file of files) {
      const turns = parseSessionFile(file)
      if (turns.length === 0) continue

      for (const turn of turns) {
        const { cost, calls } = addTurn(turn, CLI_LABELS.claude)
        projectCost += cost
        projectCalls += calls
      }
    }

    if (projectCost > 0 || projectCalls > 0) {
      const shortName = shortProjectName(decodedPath)
      const p = projectMap.get(shortName) ?? { value: 0, count: 0 }
      projectMap.set(shortName, { value: p.value + projectCost, count: p.count + projectCalls })
    }
  }

  // --- Codex: one rollout JSONL per thread, project comes from the session cwd ---
  const codexFiles = findCodexSessionFiles(start, end)
  debugLog(`scanning ${codexFiles.length} codex rollout files`)
  for (const file of codexFiles) {
    const session = parseCodexSessionFile(file)
    if (!session || session.turns.length === 0) continue
    if (projectPath && !isUnder(session.cwd, projectPath)) continue

    let projectCost = 0
    let projectCalls = 0
    for (const turn of session.turns) {
      const { cost, calls } = addTurn(turn, CLI_LABELS.codex)
      projectCost += cost
      projectCalls += calls
    }

    if (projectCost > 0 || projectCalls > 0) {
      const shortName = shortProjectName(session.cwd)
      const p = projectMap.get(shortName) ?? { value: 0, count: 0 }
      projectMap.set(shortName, { value: p.value + projectCost, count: p.count + projectCalls })
    }
  }

  debugLog(`done: ${_dbgFiles} files, ${apiCalls} calls, $${totalCost.toFixed(2)}`)

  // Cache hit rate
  const totalCacheable = totalInput + totalCacheWrite + totalCacheRead
  const cacheHitRate = totalCacheable > 0 ? (totalCacheRead / totalCacheable) * 100 : 0

  // Build daily array
  const daily = buildDailyArray(dailyMap, start, end)

  const result: StatsResult = {
    summary: {
      totalCost,
      apiCalls,
      sessions: sessionIds.size,
      cacheHitRate,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheReadTokens: totalCacheRead,
      totalCacheWriteTokens: totalCacheWrite,
    },
    daily,
    projects: toBreakdownList(projectMap),
    models: toBreakdownList(modelMap),
    activities: toBreakdownList(activityMap),
    clis: toBreakdownList(cliMap),
    tools: toBreakdownList(toolMap).map(t => ({ ...t, value: t.count })),
  }

  cache.set(key, { result, ts: Date.now() })
  return result
}

function buildDailyArray(map: Map<string, { cost: number; calls: number }>, start?: Date, end?: Date): DailyStats[] {
  if (!start || !end) {
    // 'all' — just return sorted keys from the map, no gap filling
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, cost: d.cost, calls: d.calls }))
  }

  const result: DailyStats[] = []
  const current = new Date(start)
  while (current <= end) {
    const key = localDayKey(current)
    const d = map.get(key)
    result.push({ date: key, cost: d?.cost ?? 0, calls: d?.calls ?? 0 })
    current.setDate(current.getDate() + 1)
  }
  return result
}
