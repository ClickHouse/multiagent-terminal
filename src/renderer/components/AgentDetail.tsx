import { useState, useEffect, useRef } from 'react'
import { Code2, GitCompare, GitPullRequest, RotateCcw, GitBranch, TerminalSquare, GitGraph, BarChart3 } from 'lucide-react'
import { Agent, AgentStatus, CLAUDE_MODELS } from '../../shared/types'
import { squashHome } from '../utils'
import { useSettings } from '../store/settings'
import Terminal from './Terminal'
import ShellTerminal from './ShellTerminal'
import GitLog from './GitLog'
import AgentStatsPanel from './stats/AgentStatsPanel'

interface Props { agent: Agent; isSelected?: boolean }

const MINUTE_BUCKETS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50]

function timeAgo(ts: number | null): string | null {
  if (!ts) return null
  const min = Math.floor((Date.now() - ts) / 60000)
  if (min < 1) return '<1m ago'
  if (min < 60) {
    const bucket = MINUTE_BUCKETS.findLast(b => b <= min) ?? 1
    return `${bucket}m ago`
  }
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

const STATUS_VARS: Record<AgentStatus, { fg: string; bg: string; dot: string; label: string }> = {
  starting: { fg: 'var(--s-starting-fg)', bg: 'var(--s-starting-bg)', dot: 'var(--s-starting-dot)', label: 'Starting' },
  idle:     { fg: 'var(--s-idle-fg)',     bg: 'var(--s-idle-bg)',     dot: 'var(--s-idle-dot)',     label: 'Idle'     },
  thinking: { fg: 'var(--s-thinking-fg)', bg: 'var(--s-thinking-bg)', dot: 'var(--s-thinking-dot)', label: 'Thinking' },
  working:  { fg: 'var(--s-working-fg)',  bg: 'var(--s-working-bg)',  dot: 'var(--s-working-dot)',  label: 'Working'  },
  error:    { fg: 'var(--s-error-fg)',    bg: 'var(--s-error-bg)',    dot: 'var(--s-error-dot)',    label: 'Error'    },
  stopped:  { fg: 'var(--s-stopped-fg)', bg: 'var(--s-stopped-bg)', dot: 'var(--s-stopped-dot)', label: 'Stopped'  },
}

function IconBtn({ icon, label, onClick, primary, title, disabled }: { icon: React.ReactNode; label?: string; onClick: () => void; primary?: boolean; title?: string; disabled?: boolean }) {
  return (
    <button onClick={disabled ? undefined : onClick} title={title ?? label} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      border: primary ? 'none' : '1px solid var(--border)',
      background: primary ? 'var(--accent)' : 'var(--bg)',
      color: primary ? '#fff' : 'var(--text-secondary)',
      transition: 'background 0.1s, border-color 0.1s',
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = primary ? 'var(--accent-hover)' : 'var(--surface2)' }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = primary ? 'var(--accent)' : 'var(--bg)' }}
    >
      {icon}{label}
    </button>
  )
}

const BOTTOM_PANEL_H_DEFAULT = 220
const BOTTOM_PANEL_H_MIN = 100
const BOTTOM_PANEL_H_KEY = 'multiagent.bottomPanelHeight'

function loadStoredHeight(): number {
  const raw = localStorage.getItem(BOTTOM_PANEL_H_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n >= BOTTOM_PANEL_H_MIN ? n : BOTTOM_PANEL_H_DEFAULT
}

export default function AgentDetail({ agent, isSelected = true }: Props): JSX.Element {
  const sv = STATUS_VARS[agent.status]
  if (!sv) console.error('[AgentDetail] unknown status:', agent?.status)
  const isActive = agent.status !== 'stopped' && agent.status !== 'error'
  const fontSize = useSettings(s => s.fontSize)
  const scrollSpeed = useSettings(s => s.scrollSpeed)
  const scrollback = useSettings(s => s.scrollback)
  const [diffLoading, setDiffLoading] = useState(false)
  const [bottomTab, setBottomTab] = useState<'shell' | 'gitlog' | 'stats' | null>(null)
  const [bottomH, setBottomH] = useState<number>(() => loadStoredHeight())

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = bottomH
    const maxH = Math.max(BOTTOM_PANEL_H_MIN, window.innerHeight - 200)
    let latestH = startH
    const onMove = (ev: MouseEvent) => {
      latestH = Math.min(maxH, Math.max(BOTTOM_PANEL_H_MIN, startH + (startY - ev.clientY)))
      setBottomH(latestH)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { localStorage.setItem(BOTTOM_PANEL_H_KEY, String(Math.round(latestH))) } catch { /* ignore */ }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  // Tick to keep "ago" labels fresh (30s only — no 50ms fade timer)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!isSelected) return
    const t = setInterval(() => tick(n => n + 1), 30000)
    return () => clearInterval(t)
  }, [isSelected])

  // CSS-transition-based border flash when agent finishes
  const [borderFlash, setBorderFlash] = useState(false)
  const prevFinishedRef = useRef(agent.lastFinishedAt)
  useEffect(() => {
    if (agent.lastFinishedAt && agent.lastFinishedAt !== prevFinishedRef.current && agent.status === 'idle') {
      prevFinishedRef.current = agent.lastFinishedAt
      setBorderFlash(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setBorderFlash(false)))
    } else {
      prevFinishedRef.current = agent.lastFinishedAt
    }
  }, [agent.lastFinishedAt, agent.status])

  // Lazily start the agent PTY when first opened, and clear the unseen badge.
  useEffect(() => {
    if (!isSelected) return
    window.api.ensureRunning(agent.id)
    window.api.markSeen(agent.id)
  }, [agent.id, isSelected])

  // Poll file count + PR every 30s, line stats every 5 min (only when selected).
  useEffect(() => {
    if (!isSelected) return
    window.api.getChangedFiles(agent.id)
    window.api.getPRNumber(agent.id)
    window.api.getLineStats(agent.id)
    const fast = setInterval(() => {
      window.api.getChangedFiles(agent.id)
      window.api.getPRNumber(agent.id)
    }, 30000)
    const slow = setInterval(() => {
      window.api.getLineStats(agent.id)
    }, 300000)
    return () => { clearInterval(fast); clearInterval(slow) }
  }, [agent.id, isSelected])

  const handleDiff = async () => {
    setDiffLoading(true)
    try {
      await window.api.openDiff(agent.id)
    } finally {
      setDiffLoading(false)
    }
  }

  const toggleTab = (tab: 'shell' | 'gitlog' | 'stats') => {
    setBottomTab(prev => prev === tab ? null : tab)
  }

  const isWorking = agent.status === 'thinking' || agent.status === 'working'
  const stateBorderColor = isWorking ? '#eab308' : borderFlash ? '#22c55e' : 'transparent'
  const borderTransition = borderFlash || isWorking ? 'border-color 0s' : 'border-color 3s ease-out'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0,
        padding: '12px 16px',
        borderLeft: `2px solid ${stateBorderColor}`,
        borderRight: `2px solid ${stateBorderColor}`,
        borderTop: `2px solid ${stateBorderColor}`,
        transition: borderTransition,
      }}>
        {/* Row 1: Identity + Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            {/* Status indicator */}
            {(agent.status === 'thinking' || agent.status === 'working' || agent.status === 'starting') ? (
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, animation: 'statusSpin 0.7s linear infinite' }}>
                <circle cx="8" cy="8" r="4.5" stroke={sv.dot} strokeOpacity={0.5} strokeWidth={6} />
                <path d="M8 3.5a4.5 4.5 0 0 1 4.5 4.5" stroke={sv.dot} strokeWidth={6} strokeLinecap="round" />
              </svg>
            ) : (
              <span style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: sv.dot,
              }} />
            )}

            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent.name}
            </span>

            <span style={{
              fontSize: 11, fontWeight: 600,
              color: sv.fg, background: sv.bg,
              borderRadius: 4, padding: '2px 8px', flexShrink: 0,
            }}>
              {sv.label}
            </span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            <IconBtn icon={<Code2 size={14} />} label="VSCode" onClick={() => window.api.openVSCode(agent.id)} />
            <IconBtn icon={<GitCompare size={14} />} label="Diff" onClick={handleDiff} title="View diff" />
            <IconBtn
              icon={<GitPullRequest size={14} />}
              label={agent.prNumber ? `${agent.prRepo || ''}#${agent.prNumber}` : (agent.prRepo || undefined)}
              title={agent.prNumber ? `Open PR ${agent.prRepo}#${agent.prNumber}` : (agent.prRepo ? `Open ${agent.prRepo} on GitHub` : 'No repo')}
              onClick={() => agent.prNumber ? window.api.openPR(agent.id) : window.api.openRepo(agent.id)}
              primary={!!agent.prNumber}
              disabled={!agent.prNumber && !agent.prRepo}
            />
            <IconBtn icon={<RotateCcw size={14} />} label="Restart" title="Restart claude (new context)" onClick={() => window.api.restartAgent(agent.id)} />
          </div>
        </div>

        {/* Row 2: Path + Branch + Stats | Model + Context + Cost */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 0 }}>
            {(() => {
              const dot = <span style={{ color: 'var(--text-dim)', opacity: 0.4, margin: '0 6px' }}>&middot;</span>
              const items: React.ReactNode[] = []
              items.push(
                <span key="path" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, color: 'var(--text-dim)' }}>
                  {squashHome(agent.worktreePath)}
                </span>
              )
              if (agent.currentBranch || agent.branchName) items.push(
                <span key="branch" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                  <GitBranch size={11} strokeWidth={2.2} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 3 }} />
                  {agent.currentBranch || agent.branchName}
                </span>
              )
              if (agent.changedFiles > 0) items.push(
                <span key="files" style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {agent.changedFiles} file{agent.changedFiles === 1 ? '' : 's'}
                </span>
              )
              if (agent.linesAdded > 0 || agent.linesRemoved > 0) items.push(
                <span key="lines" style={{ flexShrink: 0 }}>
                  <span style={{ color: '#16a34a' }}>+{agent.linesAdded}</span>
                  {' '}
                  <span style={{ color: '#dc2626' }}>-{agent.linesRemoved}</span>
                </span>
              )
              // Show one status: working/thinking shows elapsed since sent, idle shows done time
              const isAgentActive = agent.status === 'thinking' || agent.status === 'working'
              if (isAgentActive && agent.lastInputAt) {
                items.push(
                  <span key="activity" title={new Date(agent.lastInputAt).toLocaleTimeString()} style={{ color: 'var(--s-working-fg)', flexShrink: 0 }}>
                    working for {timeAgo(agent.lastInputAt)?.replace(' ago', '')}
                  </span>
                )
              } else if (!isAgentActive && agent.lastFinishedAt) {
                items.push(
                  <span key="done" title={new Date(agent.lastFinishedAt).toLocaleTimeString()} style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
                    done {timeAgo(agent.lastFinishedAt)}
                  </span>
                )
              }
              return items.map((item, i) => <>{i > 0 && dot}{item}</>)
            })()}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {agent.contextPercent > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 48, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    width: `${agent.contextPercent}%`,
                    background: agent.contextPercent >= 90 ? 'var(--s-error-dot)'
                              : agent.contextPercent >= 70 ? 'var(--s-thinking-dot)'
                              : 'var(--accent)',
                  }} />
                </div>
                <span style={{
                  fontWeight: 500,
                  color: agent.contextPercent >= 90 ? 'var(--s-error-fg)'
                        : agent.contextPercent >= 70 ? 'var(--s-thinking-fg)'
                        : 'var(--text-secondary)',
                }}>
                  {Math.round(agent.contextPercent)}%
                </span>
              </div>
            )}
            <select
              value={agent.launchModel ?? ''}
              onChange={(e) => window.api.setAgentModel(agent.id, e.target.value)}
              title="Model — switches a running session via /model, applies to restarts via --model"
              style={{
                color: 'var(--text-secondary)',
                background: 'var(--surface2)', borderRadius: 4, padding: '2px 4px',
                border: '1px solid var(--border)', fontSize: 'inherit',
                fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
              }}>
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === '' && agent.model && typeof agent.model === 'string'
                    ? agent.model.replace('claude-', '').replace(/-\d{8}$/, '')
                    : m.label}
                </option>
              ))}
            </select>
            {agent.costUSD > 0 && (
              <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                ${agent.costUSD.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Claude terminal */}
      <div style={{
        flex: 1, overflow: 'hidden', padding: '8px 8px 0', background: '#ffffff', minHeight: 0,
        borderLeft: `2px solid ${stateBorderColor}`,
        borderRight: `2px solid ${stateBorderColor}`,
        transition: borderTransition,
      }}>
        <Terminal agentId={agent.id} fontSize={fontSize} scrollSpeed={scrollSpeed} scrollback={scrollback} visible={isSelected} />
      </div>

      {/* Bottom bar + collapsible panel */}
      <div style={{
        flexShrink: 0, borderTop: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        borderLeft: `2px solid ${stateBorderColor}`,
        borderRight: `2px solid ${stateBorderColor}`,
        borderBottom: `2px solid ${stateBorderColor}`,
        transition: borderTransition,
      }}>
        {/* Drag handle — only when a tab is open */}
        {bottomTab && (
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            style={{
              height: 4, cursor: 'ns-resize', background: 'var(--border)',
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--border)' }}
          />
        )}
        {/* Tab bar — always visible at bottom */}
        <div style={{
          display: 'flex', gap: 0, background: 'var(--surface)',
          borderBottom: bottomTab ? '1px solid var(--border)' : 'none',
        }}>
          {([
            { key: 'shell' as const, label: 'Shell', icon: <TerminalSquare size={12} /> },
            { key: 'gitlog' as const, label: 'Git Log', icon: <GitGraph size={12} /> },
            { key: 'stats' as const, label: 'Stats', icon: <BarChart3 size={12} /> },
          ]).map(tab => {
            const active = bottomTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => toggleTab(tab.key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', fontSize: 12, fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-dim)',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {tab.icon}{tab.label}
              </button>
            )
          })}
        </div>

        {/* Panel content — only rendered when a tab is active */}
        {bottomTab && (
          <div style={{ height: bottomH, overflow: 'hidden', background: bottomTab === 'shell' ? '#f8fafc' : 'var(--bg)', padding: bottomTab === 'shell' ? '4px 8px 0' : '0' }}>
            <div style={{ display: bottomTab === 'shell' ? 'block' : 'none', height: '100%' }}>
              <ShellTerminal agentId={agent.id} fontSize={Math.max(11, fontSize - 1)} scrollSpeed={scrollSpeed} visible={isSelected && bottomTab === 'shell'} />
            </div>
            <div style={{ display: bottomTab === 'gitlog' ? 'block' : 'none', height: '100%' }}>
              <GitLog agentId={agent.id} visible={isSelected && bottomTab === 'gitlog'} />
            </div>
            <div style={{ display: bottomTab === 'stats' ? 'block' : 'none', height: '100%' }}>
              <AgentStatsPanel agentId={agent.id} visible={isSelected && bottomTab === 'stats'} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
