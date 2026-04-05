import { DailyStats, StatsPeriod } from '../../../shared/types'

interface Props {
  daily: DailyStats[]
  period: StatsPeriod
}

interface Bin {
  label: string
  key: string
  cost: number
  calls: number
  isCurrent: boolean
}

function binDaily(daily: DailyStats[], period: StatsPeriod): { bins: Bin[]; unitLabel: string } {
  if (daily.length === 0) return { bins: [], unitLabel: 'day' }

  const todayStr = new Date().toISOString().slice(0, 10)

  if (period === 'today') {
    const cost = daily.reduce((s, d) => s + d.cost, 0)
    const calls = daily.reduce((s, d) => s + d.calls, 0)
    return {
      bins: [{ label: 'Today', key: 'today', cost, calls, isCurrent: true }],
      unitLabel: 'day',
    }
  }

  if (period === 'week' || period === 'month') {
    return {
      bins: daily.map(d => ({
        label: d.date.slice(5),
        key: d.date,
        cost: d.cost,
        calls: d.calls,
        isCurrent: d.date === todayStr,
      })),
      unitLabel: 'day',
    }
  }

  // 'all' — pick granularity based on date span
  const firstDate = new Date(daily[0].date)
  const lastDate = new Date(daily[daily.length - 1].date)
  const spanDays = Math.ceil((lastDate.getTime() - firstDate.getTime()) / 86400000) + 1

  if (spanDays <= 31) {
    return {
      bins: daily.map(d => ({
        label: d.date.slice(5),
        key: d.date,
        cost: d.cost,
        calls: d.calls,
        isCurrent: d.date === todayStr,
      })),
      unitLabel: 'day',
    }
  }

  if (spanDays <= 180) return binByWeek(daily, todayStr)
  return binByMonth(daily, todayStr)
}

function binByWeek(daily: DailyStats[], todayStr: string): { bins: Bin[]; unitLabel: string } {
  const weekMap = new Map<string, { cost: number; calls: number; dates: string[] }>()
  const currentWeek = getWeekKey(todayStr)

  for (const d of daily) {
    const wk = getWeekKey(d.date)
    const existing = weekMap.get(wk) ?? { cost: 0, calls: 0, dates: [] }
    existing.cost += d.cost
    existing.calls += d.calls
    existing.dates.push(d.date)
    weekMap.set(wk, existing)
  }

  return {
    bins: Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, v]) => ({
        label: v.dates[0].slice(5),
        key: wk,
        cost: v.cost,
        calls: v.calls,
        isCurrent: wk === currentWeek,
      })),
    unitLabel: 'week',
  }
}

function binByMonth(daily: DailyStats[], todayStr: string): { bins: Bin[]; unitLabel: string } {
  const monthMap = new Map<string, { cost: number; calls: number }>()
  const currentMonth = todayStr.slice(0, 7)

  for (const d of daily) {
    const mo = d.date.slice(0, 7)
    const existing = monthMap.get(mo) ?? { cost: 0, calls: 0 }
    existing.cost += d.cost
    existing.calls += d.calls
    monthMap.set(mo, existing)
  }

  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return {
    bins: Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mo, v]) => ({
        label: `${MO[parseInt(mo.slice(5), 10) - 1]} '${mo.slice(2, 4)}`,
        key: mo,
        cost: v.cost,
        calls: v.calls,
        isCurrent: mo === currentMonth,
      })),
    unitLabel: 'month',
  }
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

export default function DailyChart({ daily, period }: Props): JSX.Element {
  const { bins, unitLabel } = binDaily(daily, period)

  if (bins.length === 0) {
    return (
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Spend
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 12 }}>No data</div>
      </div>
    )
  }

  const maxCost = Math.max(...bins.map(b => b.cost), 0.01)

  // Constrain bar width: min 6px, max 40px, with 2px gap
  const BAR_GAP = 2
  const BAR_MIN = 6
  const BAR_MAX = 40

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Spend per {unitLabel}
        </div>
        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
          peak ${maxCost.toFixed(2)}/{unitLabel}
        </div>
      </div>

      {/* Chart area — bars are fixed-width, centered */}
      <div style={{
        display: 'flex', justifyContent: 'center',
        height: 120, padding: '0 4px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: BAR_GAP,
          maxWidth: '100%',
        }}>
          {bins.map(b => {
            const height = maxCost > 0 ? Math.max(2, (b.cost / maxCost) * 108) : 2
            return (
              <div
                key={b.key}
                title={`${b.label}: $${b.cost.toFixed(2)} (${b.calls} calls)`}
                style={{
                  width: Math.max(BAR_MIN, Math.min(BAR_MAX, Math.floor(480 / bins.length))),
                  flexShrink: 0,
                }}
              >
                <div style={{
                  width: '100%',
                  height,
                  background: 'var(--accent)',
                  borderRadius: 3,
                  opacity: b.isCurrent ? 1 : b.cost > 0 ? 0.45 + 0.55 * (b.cost / maxCost) : 0.12,
                }} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Labels */}
      {bins.length > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
        }}>
          <span>{bins[0].label}</span>
          {bins.length > 4 && <span>{bins[Math.floor(bins.length / 2)].label}</span>}
          <span>{bins[bins.length - 1].label}</span>
        </div>
      )}
    </div>
  )
}
