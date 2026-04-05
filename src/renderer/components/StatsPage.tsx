import { useState, useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import { StatsResult, StatsPeriod } from '../../shared/types'
import SummaryCards from './stats/SummaryCards'
import BreakdownPanel from './stats/BreakdownPanel'
import DailyChart from './stats/DailyChart'

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
]

export default function StatsPage(): JSX.Element {
  const [period, setPeriod] = useState<StatsPeriod>('week')
  const [data, setData] = useState<StatsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)

  const fetchStats = (p: StatsPeriod, bustCache = false) => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    setData(null)
    const doFetch = () => window.api.getStats(p).then(result => {
      if (id !== reqId.current) return
      setData(result)
      setLoading(false)
    }).catch(e => {
      if (id !== reqId.current) return
      setError(e?.message ?? 'Failed to load stats')
      setLoading(false)
    })
    if (bustCache) {
      window.api.clearStatsCache().then(doFetch)
    } else {
      doFetch()
    }
  }

  useEffect(() => {
    fetchStats(period)
  }, [period])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Token Analytics</span>

          {/* Period tabs */}
          <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: 2 }}>
            {PERIODS.map(p => {
              const active = period === p.key
              return (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  style={{
                    padding: '5px 14px', fontSize: 13, fontWeight: active ? 600 : 500,
                    cursor: 'pointer', border: 'none', borderRadius: 4,
                    background: active ? 'var(--bg)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-dim)',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <button
          onClick={() => fetchStats(period, true)}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', fontSize: 13, fontWeight: 500,
            cursor: loading ? 'default' : 'pointer',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            background: 'var(--bg)', color: 'var(--text-secondary)',
            opacity: loading ? 0.5 : 1,
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? 'statusSpin 0.7s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10,
            height: '100%', color: 'var(--s-error-fg)',
          }}>
            <span style={{ fontSize: 14 }}>Failed to load stats: {error}</span>
            <button
              onClick={() => fetchStats(period, true)}
              style={{
                padding: '7px 18px', fontSize: 13, cursor: 'pointer',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                background: 'var(--bg)', color: 'var(--text)',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {loading && !data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              {[1,2,3,4].map(i => (
                <div key={i} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)', padding: '18px 20px', height: 100,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              ))}
            </div>
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', height: 170,
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          </div>
        )}

        {data && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {data.summary.apiCalls === 0 ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10,
                padding: 80, color: 'var(--text-dim)',
              }}>
                <span style={{ fontSize: 36 }}>📊</span>
                <span style={{ fontSize: 15 }}>No Claude Code sessions found for this period.</span>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  Sessions are read from $CLAUDE_CONFIG_DIR/projects/ (default: ~/.claude/projects/)
                </span>
              </div>
            ) : (
              <>
                <SummaryCards summary={data.summary} />
                <DailyChart daily={data.daily} period={period} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                  <BreakdownPanel title="By Project" items={data.projects} />
                  <BreakdownPanel title="By Model" items={data.models} />
                  <BreakdownPanel
                    title="By Activity"
                    items={data.activities}
                    formatValue={item => `$${item.value.toFixed(2)}`}
                  />
                  <BreakdownPanel
                    title="By Tool"
                    items={data.tools}
                    formatValue={item => `${item.value.toLocaleString()} uses`}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
