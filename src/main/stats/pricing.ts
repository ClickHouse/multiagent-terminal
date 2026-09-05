import { TokenUsage } from './types.js'

export interface ModelCosts {
  inputCostPerToken: number
  outputCostPerToken: number
  cacheWriteCostPerToken: number
  cacheReadCostPerToken: number
}

// Hardcoded fallback pricing (per token)
const FALLBACK_PRICING: Record<string, ModelCosts> = {
  'claude-fable-5-1':   { inputCostPerToken: 10e-6,  outputCostPerToken: 50e-6,  cacheWriteCostPerToken: 12.5e-6,  cacheReadCostPerToken: 0.25e-6 },
  'claude-fable-5':     { inputCostPerToken: 10e-6,  outputCostPerToken: 50e-6,  cacheWriteCostPerToken: 12.5e-6,  cacheReadCostPerToken: 1e-6    },
  'claude-opus-5':      { inputCostPerToken: 5e-6,   outputCostPerToken: 25e-6,  cacheWriteCostPerToken: 6.25e-6,  cacheReadCostPerToken: 0.5e-6  },
  'claude-sonnet-5':    { inputCostPerToken: 2e-6,   outputCostPerToken: 10e-6,  cacheWriteCostPerToken: 2.5e-6,   cacheReadCostPerToken: 0.2e-6  },
  'claude-opus-4-8':    { inputCostPerToken: 5e-6,   outputCostPerToken: 25e-6,  cacheWriteCostPerToken: 6.25e-6,  cacheReadCostPerToken: 0.5e-6  },
  'claude-opus-4-7':    { inputCostPerToken: 5e-6,   outputCostPerToken: 25e-6,  cacheWriteCostPerToken: 6.25e-6,  cacheReadCostPerToken: 0.5e-6  },
  'claude-opus-4-6':    { inputCostPerToken: 5e-6,   outputCostPerToken: 25e-6,  cacheWriteCostPerToken: 6.25e-6,  cacheReadCostPerToken: 0.5e-6  },
  'claude-opus-4-5':    { inputCostPerToken: 5e-6,   outputCostPerToken: 25e-6,  cacheWriteCostPerToken: 6.25e-6,  cacheReadCostPerToken: 0.5e-6  },
  'claude-opus-4-1':    { inputCostPerToken: 15e-6,  outputCostPerToken: 75e-6,  cacheWriteCostPerToken: 18.75e-6, cacheReadCostPerToken: 1.5e-6  },
  'claude-opus-4':      { inputCostPerToken: 15e-6,  outputCostPerToken: 75e-6,  cacheWriteCostPerToken: 18.75e-6, cacheReadCostPerToken: 1.5e-6  },
  'claude-sonnet-4-6':  { inputCostPerToken: 3e-6,   outputCostPerToken: 15e-6,  cacheWriteCostPerToken: 3.75e-6,  cacheReadCostPerToken: 0.3e-6  },
  'claude-sonnet-4-5':  { inputCostPerToken: 3e-6,   outputCostPerToken: 15e-6,  cacheWriteCostPerToken: 3.75e-6,  cacheReadCostPerToken: 0.3e-6  },
  'claude-sonnet-4':    { inputCostPerToken: 3e-6,   outputCostPerToken: 15e-6,  cacheWriteCostPerToken: 3.75e-6,  cacheReadCostPerToken: 0.3e-6  },
  'claude-3-7-sonnet':  { inputCostPerToken: 3e-6,   outputCostPerToken: 15e-6,  cacheWriteCostPerToken: 3.75e-6,  cacheReadCostPerToken: 0.3e-6  },
  'claude-3-5-sonnet':  { inputCostPerToken: 3e-6,   outputCostPerToken: 15e-6,  cacheWriteCostPerToken: 3.75e-6,  cacheReadCostPerToken: 0.3e-6  },
  'claude-haiku-4-5':   { inputCostPerToken: 1e-6,   outputCostPerToken: 5e-6,   cacheWriteCostPerToken: 1.25e-6,  cacheReadCostPerToken: 0.1e-6  },
  'claude-3-5-haiku':   { inputCostPerToken: 0.8e-6, outputCostPerToken: 4e-6,   cacheWriteCostPerToken: 1e-6,     cacheReadCostPerToken: 0.08e-6 },

  // Codex / OpenAI. Cache writes are not billed separately, so cacheWrite == input.
  'gpt-6-astra':        { inputCostPerToken: 10e-6,   outputCostPerToken: 50e-6,  cacheWriteCostPerToken: 10e-6,   cacheReadCostPerToken: 1e-6     },
  'gpt-5.6-cyber':      { inputCostPerToken: 12.5e-6, outputCostPerToken: 75e-6,  cacheWriteCostPerToken: 12.5e-6, cacheReadCostPerToken: 1.25e-6  },
  'gpt-5.6-sol':        { inputCostPerToken: 4e-6,    outputCostPerToken: 20e-6,  cacheWriteCostPerToken: 4e-6,    cacheReadCostPerToken: 0.4e-6   },
  'gpt-5.6-terra':      { inputCostPerToken: 2e-6,    outputCostPerToken: 12e-6,  cacheWriteCostPerToken: 2e-6,    cacheReadCostPerToken: 0.2e-6   },
  'gpt-5.6-luna':       { inputCostPerToken: 0.2e-6,  outputCostPerToken: 1.2e-6, cacheWriteCostPerToken: 0.2e-6,  cacheReadCostPerToken: 0.02e-6  },
  'gpt-5.6':            { inputCostPerToken: 4e-6,    outputCostPerToken: 20e-6,  cacheWriteCostPerToken: 4e-6,    cacheReadCostPerToken: 0.4e-6   },
  'gpt-5.5-pro':        { inputCostPerToken: 30e-6,   outputCostPerToken: 180e-6, cacheWriteCostPerToken: 30e-6,   cacheReadCostPerToken: 3e-6     },
  'gpt-5.5':            { inputCostPerToken: 5e-6,    outputCostPerToken: 30e-6,  cacheWriteCostPerToken: 5e-6,    cacheReadCostPerToken: 0.5e-6   },
  'gpt-5.4-mini':       { inputCostPerToken: 0.75e-6, outputCostPerToken: 4.5e-6, cacheWriteCostPerToken: 0.75e-6, cacheReadCostPerToken: 0.075e-6 },
  'gpt-5.4-pro':        { inputCostPerToken: 30e-6,   outputCostPerToken: 180e-6, cacheWriteCostPerToken: 30e-6,   cacheReadCostPerToken: 3e-6     },
  'gpt-5.4':            { inputCostPerToken: 2.5e-6,  outputCostPerToken: 15e-6,  cacheWriteCostPerToken: 2.5e-6,  cacheReadCostPerToken: 0.25e-6  },
  'gpt-5-codex':        { inputCostPerToken: 1.25e-6, outputCostPerToken: 10e-6,  cacheWriteCostPerToken: 1.25e-6, cacheReadCostPerToken: 0.125e-6 },
  'codex-mini-latest':  { inputCostPerToken: 1.5e-6,  outputCostPerToken: 6e-6,   cacheWriteCostPerToken: 1.5e-6,  cacheReadCostPerToken: 0.375e-6 },
  // codex-auto-review has no published price — estimated at gpt-5.6-terra rates.
  'codex-auto-review':  { inputCostPerToken: 2e-6,    outputCostPerToken: 12e-6,  cacheWriteCostPerToken: 2e-6,    cacheReadCostPerToken: 0.2e-6   },
}

function isAnthropicModel(name: string): boolean {
  return name.startsWith('claude') || name.includes('anthropic')
}

// LiteLLM pricing cache
let litellmPricing: Record<string, ModelCosts> | null = null
let litellmFetchedAt = 0
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24h

function getCanonicalName(model: string): string {
  // Strip date suffix: claude-sonnet-4-5-20240101 → claude-sonnet-4-5
  let name = model.replace(/-\d{8}$/, '')
  // Strip API endpoint: model@api.anthropic.com → model
  name = name.replace(/@.*$/, '')
  return name
}

function getModelCosts(model: string): ModelCosts | null {
  const canonical = getCanonicalName(model)
  // Guard against '' / '<synthetic>' style names: every key startsWith('') would
  // match below and silently price them as whatever sits first in the table.
  if (canonical.length < 4) return null

  // Try exact match in LiteLLM cache first
  if (litellmPricing?.[canonical]) return litellmPricing[canonical]

  // Try prefix match in LiteLLM
  if (litellmPricing) {
    for (const [key, costs] of Object.entries(litellmPricing)) {
      if (canonical.startsWith(key) || key.startsWith(canonical)) return costs
    }
  }

  // Fallback: exact match
  if (FALLBACK_PRICING[canonical]) return FALLBACK_PRICING[canonical]

  // Fallback: prefix match
  for (const [key, costs] of Object.entries(FALLBACK_PRICING)) {
    if (canonical.startsWith(key) || key.startsWith(canonical)) return costs
  }

  return null
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const costs = getModelCosts(model)
  if (!costs) return 0
  return (
    usage.inputTokens * costs.inputCostPerToken +
    usage.outputTokens * costs.outputCostPerToken +
    usage.cacheCreationInputTokens * costs.cacheWriteCostPerToken +
    usage.cacheReadInputTokens * costs.cacheReadCostPerToken
  )
}

export async function loadPricing(): Promise<void> {
  if (litellmPricing && Date.now() - litellmFetchedAt < CACHE_TTL) return
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
      { signal: AbortSignal.timeout(10000) }
    )
    if (!resp.ok) return
    const data = await resp.json() as Record<string, Record<string, unknown>>
    const parsed: Record<string, ModelCosts> = {}
    for (const [key, info] of Object.entries(data)) {
      if (key === 'sample_spec' || typeof info !== 'object' || !info) continue
      const input = info.input_cost_per_token
      const output = info.output_cost_per_token
      if (typeof input !== 'number' || typeof output !== 'number') continue
      parsed[key] = {
        inputCostPerToken: input,
        outputCostPerToken: output,
        // Only Anthropic bills cache writes at a premium; elsewhere (OpenAI/codex)
        // a cache write costs the same as ordinary input.
        cacheWriteCostPerToken: (info.cache_creation_input_token_cost as number)
          ?? (isAnthropicModel(key) ? input * 1.25 : input),
        cacheReadCostPerToken: (info.cache_read_input_token_cost as number) ?? input * 0.1,
      }
    }
    litellmPricing = parsed
    litellmFetchedAt = Date.now()
    console.log(`[stats/pricing] loaded ${Object.keys(parsed).length} models from LiteLLM`)
  } catch (e: any) {
    console.warn('[stats/pricing] failed to fetch LiteLLM pricing, using fallback:', e?.message)
  }
}

const SHORT_NAMES: Record<string, string> = {
  'claude-fable-5':    'Fable 5',
  'claude-opus-4-8':   'Opus 4.8',
  'claude-opus-4-7':   'Opus 4.7',
  'claude-opus-4-6':   'Opus 4.6',
  'claude-opus-4-5':   'Opus 4.5',
  'claude-opus-4-1':   'Opus 4.1',
  'claude-opus-4':     'Opus 4',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4':   'Sonnet 4',
  'claude-3-7-sonnet': 'Sonnet 3.7',
  'claude-3-5-sonnet': 'Sonnet 3.5',
  'claude-haiku-4-5':  'Haiku 4.5',
  'claude-fable-5-1':  'Fable 5.1',
  'claude-opus-5':     'Opus 5',
  'claude-sonnet-5':   'Sonnet 5',
  'claude-3-5-haiku':  'Haiku 3.5',
  // Codex models — most specific slugs first, prefix match takes the first hit.
  'gpt-6-astra':       'GPT-6 Astra',
  'gpt-5.6-cyber':     'GPT-5.6 Cyber',
  'gpt-5.6-sol':       'GPT-5.6 Sol',
  'gpt-5.6-terra':     'GPT-5.6 Terra',
  'gpt-5.6-luna':      'GPT-5.6 Luna',
  'gpt-5.6':           'GPT-5.6',
  'gpt-5.5-pro':       'GPT-5.5 Pro',
  'gpt-5.5':           'GPT-5.5',
  'gpt-5.4-mini':      'GPT-5.4 Mini',
  'gpt-5.4-pro':       'GPT-5.4 Pro',
  'gpt-5.4':           'GPT-5.4',
  'gpt-5-codex':       'GPT-5 Codex',
  'codex-auto-review': 'Codex Auto-review',
}

export function shortModelName(model: string): string {
  const canonical = getCanonicalName(model)
  for (const [key, name] of Object.entries(SHORT_NAMES)) {
    if (canonical.startsWith(key)) return name
  }
  return canonical
}
