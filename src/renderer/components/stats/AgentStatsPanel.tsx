import { useState, useEffect } from 'react'
import { StatsResult, StatsPeriod } from '../../../shared/types'
import BreakdownPanel from './BreakdownPanel'

interface Props {
  agentId: string
  visible?: boolean
}

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7d' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
]

export default function AgentStatsPanel({ agentId, visible = true }: Props): JSX.Element {
  const [period, setPeriod] = useState<StatsPeriod>('month')
  const [data, setData] = useState<StatsResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!visible) return
    let mounted = true
    setLoading(true)
    window.api.getAgentStats(agentId, period).then(result => {
      if (mounted) { setData(result); setLoading(false) }
    }).catch(() => {
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [agentId, period, visible])

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', fontSize: 12 }}>
        Loading stats...
      </div>
    )
  }

  if (!data || data.summary.apiCalls === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', fontSize: 12 }}>
        No sessions found for this agent
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '10px 14px' }}>
      {/* Header row: cost + period selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
            ${data.summary.totalCost.toFixed(2)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {data.summary.apiCalls} calls &middot; {data.summary.sessions} sessions &middot; cache {data.summary.cacheHitRate.toFixed(0)}%
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }} title="Stats are scoped to this agent's worktree directory">
            for this worktree
          </span>
        </div>
        <div style={{ display: 'flex', gap: 1, background: 'var(--surface2)', borderRadius: 4, padding: 1 }}>
          {PERIODS.map(p => {
            const active = period === p.key
            return (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                style={{
                  padding: '2px 8px', fontSize: 10, fontWeight: active ? 600 : 500,
                  cursor: 'pointer', border: 'none', borderRadius: 3,
                  background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-dim)',
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Compact breakdowns side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <BreakdownPanel title="Activity" items={data.activities} compact maxItems={5} />
        <BreakdownPanel title="Model" items={data.models} compact maxItems={5} />
      </div>
    </div>
  )
}
