import { useEffect, useState } from 'react'
import { GitCommitHorizontal, FileText, Plus, Minus } from 'lucide-react'

interface Commit {
  hash: string
  message: string
  date: string
  author: string
  filesChanged: number
  linesAdded: number
  linesRemoved: number
}

interface Props {
  agentId: string
  visible?: boolean
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  if (isNaN(then)) return ''
  const sec = Math.floor((now - then) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

export default function GitLog({ agentId, visible = true }: Props): JSX.Element {
  const [commits, setCommits] = useState<Commit[]>([])
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!visible) return
    let mounted = true
    const fetch = () => {
      window.api.getGitLog(agentId).then(c => { if (mounted) setCommits(c) })
    }
    fetch()
    const t = setInterval(fetch, 10000)
    return () => { mounted = false; clearInterval(t) }
  }, [agentId, visible])

  if (!commits.length) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-dim)', fontSize: 12,
      }}>
        No commits on this branch
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '2px 0' }}>
      {commits.map((c, i) => (
        <div
          key={c.hash}
          onClick={() => window.api.openCommitDiff(agentId, c.hash)}
          onMouseEnter={() => setHoveredIdx(i)}
          onMouseLeave={() => setHoveredIdx(null)}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '8px 14px',
            cursor: 'pointer',
            background: hoveredIdx === i ? 'var(--surface2)' : 'transparent',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <GitCommitHorizontal size={14} style={{ flexShrink: 0, color: 'var(--accent)', opacity: 0.6, marginTop: 2 }} />

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Message */}
            <div style={{
              fontSize: 12, fontWeight: 500, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {c.message}
            </div>

            {/* Meta row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>
                {c.hash.slice(0, 7)}
              </span>

              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {c.author}
              </span>

              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {relativeTime(c.date)}
              </span>

              {c.filesChanged > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                  fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                }}>
                  <FileText size={10} /> {c.filesChanged}
                </span>
              )}

              {c.linesAdded > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 1,
                  fontSize: 10, color: '#16a34a', fontFamily: 'var(--font-mono)',
                }}>
                  <Plus size={9} strokeWidth={3} />{c.linesAdded}
                </span>
              )}

              {c.linesRemoved > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 1,
                  fontSize: 10, color: '#dc2626', fontFamily: 'var(--font-mono)',
                }}>
                  <Minus size={9} strokeWidth={3} />{c.linesRemoved}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
