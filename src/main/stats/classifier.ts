import { ParsedTurn, TaskCategory, ClassifiedTurn } from './types.js'

const TEST_PATTERNS = /\b(test|pytest|vitest|jest|mocha|spec|coverage|npm\s+test|npx\s+vitest|npx\s+jest)\b/i
const GIT_PATTERNS = /\bgit\s+(push|pull|commit|merge|rebase|checkout|branch|stash|log|diff|status|add|reset|cherry-pick|tag)\b/i
const BUILD_PATTERNS = /\b(npm\s+run\s+build|npm\s+publish|pip\s+install|docker|deploy|make\s+build|npm\s+run\s+dev|npm\s+start|cargo\s+build)\b/i

const DEBUG_KEYWORDS = /\b(fix|bug|error|broken|failing|crash|issue|debug|traceback|exception|not\s+working|wrong|unexpected)\b/i
const FEATURE_KEYWORDS = /\b(add|create|implement|new|build|feature|introduce|set\s*up|scaffold|generate)\b/i
const REFACTOR_KEYWORDS = /\b(refactor|clean\s*up|rename|reorganize|simplify|extract|restructure|move|migrate|split)\b/i

const EDIT_TOOLS = new Set(['Edit', 'Write', 'FileEditTool', 'FileWriteTool', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'FileReadTool', 'GrepTool', 'GlobTool'])
const BASH_TOOLS = new Set(['Bash', 'BashTool', 'PowerShellTool'])
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TodoWrite'])
const SEARCH_TOOLS = new Set(['WebSearch', 'WebFetch', 'ToolSearch'])

function getAllTools(turn: ParsedTurn): string[] {
  const tools: string[] = []
  for (const call of turn.assistantCalls) {
    tools.push(...call.tools)
  }
  return tools
}

function getBashContent(turn: ParsedTurn): string {
  // Collect bash tool input commands for pattern matching
  return turn.assistantCalls
    .flatMap(c => c.tools)
    .join(' ')
}

export function classifyTurn(turn: ParsedTurn): ClassifiedTurn {
  const tools = getAllTools(turn)
  const toolSet = new Set(tools)
  const msg = turn.userMessage

  let category: TaskCategory

  if (tools.length === 0) {
    category = classifyConversation(msg)
  } else {
    const hasEdits = tools.some(t => EDIT_TOOLS.has(t))
    const hasReads = tools.some(t => READ_TOOLS.has(t))
    const hasBash = tools.some(t => BASH_TOOLS.has(t))
    const hasTasks = tools.some(t => TASK_TOOLS.has(t))
    const hasSearch = tools.some(t => SEARCH_TOOLS.has(t))
    const hasAgent = toolSet.has('Agent')
    const hasPlan = toolSet.has('EnterPlanMode')

    if (hasPlan) {
      category = 'planning'
    } else if (hasAgent) {
      category = 'general'
    } else if (hasBash) {
      // Check bash content patterns
      const bashText = getBashContent(turn) + ' ' + msg
      if (TEST_PATTERNS.test(bashText)) category = 'testing'
      else if (GIT_PATTERNS.test(bashText)) category = 'git'
      else if (BUILD_PATTERNS.test(bashText)) category = 'build'
      else if (hasEdits) category = 'coding'
      else category = 'coding'
    } else if (hasEdits) {
      category = 'coding'
    } else if (hasTasks) {
      category = 'planning'
    } else if (hasReads || hasSearch) {
      category = 'exploration'
    } else {
      category = 'general'
    }

    // Refine coding/exploration by keywords
    if (category === 'coding') {
      if (DEBUG_KEYWORDS.test(msg)) category = 'debugging'
      else if (REFACTOR_KEYWORDS.test(msg)) category = 'refactoring'
      else if (FEATURE_KEYWORDS.test(msg)) category = 'feature'
    } else if (category === 'exploration') {
      if (DEBUG_KEYWORDS.test(msg)) category = 'debugging'
    }
  }

  return { ...turn, category }
}

function classifyConversation(msg: string): TaskCategory {
  if (DEBUG_KEYWORDS.test(msg)) return 'debugging'
  if (FEATURE_KEYWORDS.test(msg)) return 'feature'
  if (REFACTOR_KEYWORDS.test(msg)) return 'refactoring'
  return 'conversation'
}
