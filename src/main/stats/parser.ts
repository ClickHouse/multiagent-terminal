import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { JournalEntry, ParsedApiCall, ParsedTurn, TokenUsage, ContentBlock } from './types.js'
import { calculateCost } from './pricing.js'

const CLAUDE_PROJECTS_DIR = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  'projects'
)

// Claude Code encodes paths by replacing / with - and prepending -
// e.g. /home/nik/work/multiagent → -home-nik-work-multiagent
function encodePath(p: string): string {
  return '-' + p.replace(/^\//, '').replace(/\//g, '-')
}

function decodePath(dirName: string): string {
  // -home-nik-work-foo → /home/nik/work/foo
  return '/' + dirName.slice(1).replace(/-/g, '/')
}

export function discoverProjectDirs(): Array<{ dirName: string; dirPath: string; decodedPath: string }> {
  try {
    const entries = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    return entries
      .filter(e => e.isDirectory())
      .map(e => ({
        dirName: e.name,
        dirPath: path.join(CLAUDE_PROJECTS_DIR, e.name),
        decodedPath: decodePath(e.name),
      }))
  } catch {
    return []
  }
}

export function findSessionFiles(dirPath: string, startDate?: Date, endDate?: Date): string[] {
  try {
    const files = fs.readdirSync(dirPath)
    return files
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map(f => path.join(dirPath, f))
      .filter(fp => {
        if (!startDate || !endDate) return true
        try {
          const stat = fs.statSync(fp)
          return stat.mtime >= startDate && stat.mtime <= endDate
        } catch { return false }
      })
  } catch {
    return []
  }
}

function extractToolNames(content: ContentBlock[]): string[] {
  return content
    .filter(b => b.type === 'tool_use' && b.name)
    .map(b => b.name!)
}

function parseApiCall(entry: JournalEntry): ParsedApiCall | null {
  if (entry.type !== 'assistant') return null
  const msg = entry.message
  if (!msg?.usage || !msg?.model) return null

  const usage = msg.usage
  const tokens: TokenUsage = {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  }

  const tools = Array.isArray(msg.content) ? extractToolNames(msg.content as ContentBlock[]) : []
  const costUSD = calculateCost(msg.model, tokens)

  return {
    model: msg.model,
    usage: tokens,
    costUSD,
    tools,
    timestamp: entry.timestamp ?? '',
    messageId: msg.id ?? '',
  }
}

function getUserMessage(entry: JournalEntry): string {
  if (entry.type !== 'user' || !entry.message) return ''
  const content = entry.message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: ContentBlock) => b.type === 'text' && b.text)
      .map((b: ContentBlock) => b.text!)
      .join(' ')
  }
  return ''
}

export function parseSessionFile(filePath: string): ParsedTurn[] {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  const lines = raw.split('\n').filter(Boolean)
  const entries: JournalEntry[] = []
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line))
    } catch { /* skip malformed */ }
  }

  // Extract session ID from first entry
  const sessionId = entries.find(e => e.sessionId)?.sessionId ?? path.basename(filePath, '.jsonl')

  // Group into turns: user message → assistant responses
  const turns: ParsedTurn[] = []
  const seenMsgIds = new Set<string>()

  let currentUserMsg = ''
  let currentUserTs = ''
  let currentCalls: ParsedApiCall[] = []

  for (const entry of entries) {
    if (entry.isSidechain) continue

    if (entry.type === 'user' && entry.message) {
      // Flush previous turn
      if (currentCalls.length > 0) {
        turns.push({
          userMessage: currentUserMsg,
          assistantCalls: currentCalls,
          timestamp: currentUserTs,
          sessionId,
        })
      }
      currentUserMsg = getUserMessage(entry)
      currentUserTs = entry.timestamp ?? ''
      currentCalls = []
    } else if (entry.type === 'assistant') {
      const call = parseApiCall(entry)
      if (call && call.messageId) {
        // Deduplicate by message ID
        if (seenMsgIds.has(call.messageId)) continue
        seenMsgIds.add(call.messageId)
        currentCalls.push(call)
      } else if (call) {
        currentCalls.push(call)
      }
    }
  }

  // Flush last turn
  if (currentCalls.length > 0) {
    turns.push({
      userMessage: currentUserMsg,
      assistantCalls: currentCalls,
      timestamp: currentUserTs,
      sessionId,
    })
  }

  return turns
}

/** Find project dirs matching a worktree path or its base repo */
export function findMatchingDirs(worktreePath: string, baseRepoPath?: string): string[] {
  const encoded = encodePath(worktreePath)
  const dirs = discoverProjectDirs()
  const matches: string[] = []

  for (const d of dirs) {
    if (d.dirName === encoded) {
      matches.push(d.dirPath)
    }
  }

  // Also check base repo path as fallback
  if (baseRepoPath && baseRepoPath !== worktreePath) {
    const baseEncoded = encodePath(baseRepoPath)
    for (const d of dirs) {
      if (d.dirName === baseEncoded && !matches.includes(d.dirPath)) {
        matches.push(d.dirPath)
      }
    }
  }

  return matches
}
