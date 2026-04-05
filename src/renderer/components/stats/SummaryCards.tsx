import { StatsResult } from '../../../shared/types'

interface Props {
  summary: StatsResult['summary']
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

export default function SummaryCards({ summary }: Props): JSX.Element {
  const cards = [
    { label: 'Total Cost', value: '$' + summary.totalCost.toFixed(2), sub: `${formatNumber(summary.totalInputTokens + summary.totalOutputTokens)} tokens` },
    { label: 'API Calls', value: formatNumber(summary.apiCalls), sub: `${formatNumber(summary.totalOutputTokens)} output tokens` },
    { label: 'Sessions', value: summary.sessions.toLocaleString(), sub: `${formatNumber(summary.totalInputTokens)} input tokens` },
    { label: 'Cache Hit Rate', value: summary.cacheHitRate.toFixed(0) + '%', sub: `${formatNumber(summary.totalCacheReadTokens)} cache reads` },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      {cards.map(card => (
        <div key={card.label} style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {card.label}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginTop: 6, lineHeight: 1.1 }}>
            {card.value}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
            {card.sub}
          </div>
        </div>
      ))}
    </div>
  )
}
