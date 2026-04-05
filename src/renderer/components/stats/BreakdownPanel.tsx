import { StatsBreakdownItem } from '../../../shared/types'

interface Props {
  title: string
  items: StatsBreakdownItem[]
  formatValue?: (item: StatsBreakdownItem) => string
  maxItems?: number
  compact?: boolean
}

const ACTIVITY_LABELS: Record<string, string> = {
  coding: 'Coding',
  debugging: 'Debugging',
  feature: 'Feature',
  refactoring: 'Refactoring',
  testing: 'Testing',
  exploration: 'Exploration',
  planning: 'Planning',
  git: 'Git',
  build: 'Build / Deploy',
  conversation: 'Conversation',
  general: 'General',
}

export default function BreakdownPanel({ title, items, formatValue, maxItems = 8, compact = false }: Props): JSX.Element {
  const shown = items.slice(0, maxItems)
  const maxVal = shown.length > 0 ? Math.max(...shown.map(i => i.value)) : 1

  if (shown.length === 0) {
    return (
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: compact ? '14px 16px' : '20px 24px',
      }}>
        <div style={{ fontSize: compact ? 11 : 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No data</div>
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: compact ? '14px 16px' : '20px 24px',
    }}>
      <div style={{ fontSize: compact ? 11 : 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: compact ? 10 : 14 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10 }}>
        {shown.map((item, i) => {
          const pct = maxVal > 0 ? (item.value / maxVal) * 100 : 0
          const label = ACTIVITY_LABELS[item.name] ?? item.name
          const valueStr = formatValue ? formatValue(item) : `$${item.value.toFixed(2)}`
          return (
            <div key={item.name + i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: compact ? 12 : 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                  {label}
                </span>
                <span style={{ fontSize: compact ? 11 : 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {valueStr}
                  <span style={{ color: 'var(--text-dim)', marginLeft: 5 }}>
                    ({item.count.toLocaleString()})
                  </span>
                </span>
              </div>
              <div style={{
                height: compact ? 3 : 5,
                background: 'var(--border)',
                borderRadius: 3,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(pct, 1)}%`,
                  background: 'var(--accent)',
                  borderRadius: 3,
                  opacity: 0.65 + 0.35 * (1 - i / shown.length),
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
