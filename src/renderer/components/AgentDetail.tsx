import { useRef, useState, useCallback, useEffect } from 'react'
import { Code2, GitCompare, GitPullRequest, RotateCcw, GitBranch } from 'lucide-react'
import { Agent, AgentStatus } from '../../shared/types'
import { squashHome } from '../utils'
import { useSettings } from '../store/settings'
import Terminal from './Terminal'
import ShellTerminal from './ShellTerminal'

interface Props { agent: Agent }

const STATUS_VARS: Record<AgentStatus, { fg: string; bg: string; dot: string; label: string }> = {
  starting: { fg: 'var(--s-starting-fg)', bg: 'var(--s-starting-bg)', dot: 'var(--s-starting-dot)', label: 'Starting' },
  idle:     { fg: 'var(--s-idle-fg)',     bg: 'var(--s-idle-bg)',     dot: 'var(--s-idle-dot)',     label: 'Idle'     },
  thinking: { fg: 'var(--s-thinking-fg)', bg: 'var(--s-thinking-bg)', dot: 'var(--s-thinking-dot)', label: 'Thinking' },
  working:  { fg: 'var(--s-working-fg)',  bg: 'var(--s-working-bg)',  dot: 'var(--s-working-dot)',  label: 'Working'  },
  error:    { fg: 'var(--s-error-fg)',    bg: 'var(--s-error-bg)',    dot: 'var(--s-error-dot)',    label: 'Error'    },
  stopped:  { fg: 'var(--s-stopped-fg)', bg: 'var(--s-stopped-bg)', dot: 'var(--s-stopped-dot)', label: 'Stopped'  },
}

function IconBtn({ icon, label, onClick, primary, title }: { icon: React.ReactNode; label?: string; onClick: () => void; primary?: boolean; title?: string }) {
  return (
    <button onClick={onClick} title={title ?? label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500,
      cursor: 'pointer',
      border: primary ? 'none' : '1px solid var(--border)',
      background: primary ? 'var(--accent)' : 'var(--bg)',
      color: primary ? '#fff' : 'var(--text-secondary)',
      transition: 'background 0.1s, border-color 0.1s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = primary ? 'var(--accent-hover)' : 'var(--surface2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = primary ? 'var(--accent)' : 'var(--bg)' }}
    >
      {icon}{label}
    </button>
  )
}

const MIN_SHELL_H = 80
const DEFAULT_SHELL_H = 180

export default function AgentDetail({ agent }: Props): JSX.Element {
  console.log('[AgentDetail] render:', agent?.name, agent?.status)
  const sv = STATUS_VARS[agent.status]
  if (!sv) console.error('[AgentDetail] unknown status:', agent?.status)
  const isActive = agent.status !== 'stopped' && agent.status !== 'error'
  const fontSize = useSettings(s => s.fontSize)
  const shellHRef = useRef(DEFAULT_SHELL_H)
  const shellPanelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  // Lazily start the agent PTY when first opened, and clear the unseen badge.
  useEffect(() => {
    window.api.ensureRunning(agent.id)
    window.api.markSeen(agent.id)
  }, [agent.id])

  // Poll changed file count + PR number every 10s.
  useEffect(() => {
    window.api.getChangedFiles(agent.id)
    window.api.getPRNumber(agent.id)
    const t = setInterval(() => {
      window.api.getChangedFiles(agent.id)
      window.api.getPRNumber(agent.id)
    }, 10000)
    return () => clearInterval(t)
  }, [agent.id])

  const handleDiff = async () => {
    setDiffLoading(true)
    try {
      await window.api.openDiff(agent.id)
    } finally {
      setDiffLoading(false)
    }
  }

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: shellHRef.current }

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !shellPanelRef.current) return
      const newH = Math.max(MIN_SHELL_H, dragRef.current.startH + (dragRef.current.startY - ev.clientY))
      shellHRef.current = newH
      // Update DOM directly — no React re-render during drag.
      shellPanelRef.current.style.height = `${newH}px`
    }

    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Trigger ResizeObserver in the terminal components so xterm refits.
      shellPanelRef.current?.dispatchEvent(new Event('resize'))
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0, gap: 12, minHeight: 52,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          {/* Status dot */}
          <span style={{
            width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
            background: sv.dot,
            boxShadow: isActive ? `0 0 0 3px ${sv.dot}35` : 'none',
            transition: 'box-shadow 0.3s',
          }} />

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {agent.name}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: sv.fg, background: sv.bg,
                borderRadius: 4, padding: '2px 8px',
              }}>
                {sv.label}
              </span>
              {(agent.currentBranch || agent.branchName) && (
                <span style={{
                  fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: 'var(--accent)', background: 'var(--accent-light)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: 4, padding: '2px 9px',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}>
                  <GitBranch size={12} strokeWidth={2.2} />
                  {agent.currentBranch || agent.branchName}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              {squashHome(agent.worktreePath)}
            </div>
          </div>

          {/* Activity + metrics */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 4, flexShrink: 0 }}>
            {agent.contextPercent > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 52, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    width: `${agent.contextPercent}%`,
                    background: agent.contextPercent >= 90 ? 'var(--s-error-dot)'
                              : agent.contextPercent >= 70 ? 'var(--s-thinking-dot)'
                              : 'var(--accent)',
                  }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {Math.round(agent.contextPercent)}%
                </span>
              </div>
            )}
            {agent.model && typeof agent.model === 'string' && (
              <span style={{
                fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
                background: 'var(--surface2)', borderRadius: 4, padding: '2px 7px',
                border: '1px solid var(--border)',
              }}>
                {agent.model.replace('claude-', '').replace(/-\d{8}$/, '')}
              </span>
            )}
            {agent.costUSD > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                ${agent.costUSD.toFixed(4)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <IconBtn icon={<Code2 size={14} />} label="VSCode" onClick={() => window.api.openVSCode(agent.id)} />
          <button
            onClick={handleDiff} disabled={diffLoading}
            title={`View diff${agent.changedFiles > 0 ? ` (${agent.changedFiles} changed)` : ''}`}
            style={{
              position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500,
              cursor: diffLoading ? 'wait' : 'pointer',
              border: agent.changedFiles > 0 ? '1px solid var(--s-working-dot)' : '1px solid var(--border)',
              background: agent.changedFiles > 0 ? 'var(--s-working-bg)' : 'var(--bg)',
              color: agent.changedFiles > 0 ? 'var(--s-working-fg)' : 'var(--text-secondary)',
            }}
          >
            <GitCompare size={14} />
            {agent.changedFiles > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -6,
                background: 'var(--s-working-dot)', color: '#fff',
                borderRadius: 8, fontSize: 10, fontWeight: 700,
                padding: '0 4px', minWidth: 16, textAlign: 'center',
                lineHeight: '16px', height: 16, boxShadow: '0 0 0 2px var(--bg)',
              }}>
                {agent.changedFiles > 99 ? '99+' : agent.changedFiles}
              </span>
            )}
          </button>
          <IconBtn
            icon={<GitPullRequest size={14} />}
            label={agent.prNumber ? `${agent.prRepo || ''}#${agent.prNumber}` : undefined}
            title={agent.prNumber ? `Open PR ${agent.prRepo}#${agent.prNumber}` : 'Open PR'}
            onClick={() => window.api.openPR(agent.id)}
            primary={!!agent.prNumber}
          />
          {agent.status === 'error' && (
            <IconBtn icon={<RotateCcw size={14} />} label="Restart" onClick={() => window.api.restartAgent(agent.id)} primary />
          )}
        </div>
      </div>

      {/* Claude terminal */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '10px 12px 0', background: '#ffffff' }}>
        <Terminal agentId={agent.id} fontSize={fontSize} />
      </div>

      {/* Draggable divider */}
      <div
        onMouseDown={onDividerMouseDown}
        style={{
          height: 6, flexShrink: 0, cursor: 'row-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          userSelect: 'none',
        }}
      >
        <div style={{ width: 32, height: 2, borderRadius: 1, background: 'var(--border-strong)' }} />
      </div>

      {/* Shell terminal */}
      <div ref={shellPanelRef} style={{ height: DEFAULT_SHELL_H, flexShrink: 0, overflow: 'hidden', background: '#f8fafc', padding: '6px 8px 0' }}>
        <ShellTerminal agentId={agent.id} fontSize={Math.max(11, fontSize - 1)} />
      </div>
    </div>
  )
}
