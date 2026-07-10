import { useState, useEffect, useRef } from 'react'
import { GitBranch } from 'lucide-react'
import { Agent, AgentStatus } from '../../shared/types'
import { useAgentsStore } from '../store/agents'
import ContextMenu from './ContextMenu'
import { squashHome } from '../utils'

interface Props {
  agent: Agent
  selected: boolean
  dimOpacity: number   // 0.35–1.0, computed by AgentList via time-decay
  onSelect: () => void
  onClone: () => void
}

const STATUS_VARS: Record<AgentStatus, { fg: string; bg: string; dot: string; label: string; spin: boolean }> = {
  starting: { fg: 'var(--s-starting-fg)', bg: 'var(--s-starting-bg)', dot: 'var(--s-starting-dot)', label: 'starting', spin: true  },
  idle:     { fg: 'var(--s-idle-fg)',     bg: 'var(--s-idle-bg)',     dot: 'var(--s-idle-dot)',     label: 'idle',     spin: false },
  thinking: { fg: 'var(--s-thinking-fg)', bg: 'var(--s-thinking-bg)', dot: 'var(--s-thinking-dot)', label: 'thinking', spin: true  },
  working:  { fg: 'var(--s-working-fg)',  bg: 'var(--s-working-bg)',  dot: 'var(--s-working-dot)',  label: 'working',  spin: true  },
  error:    { fg: 'var(--s-error-fg)',    bg: 'var(--s-error-bg)',    dot: 'var(--s-error-dot)',    label: 'error',    spin: false },
  stopped:  { fg: 'var(--s-stopped-fg)', bg: 'var(--s-stopped-bg)', dot: 'var(--s-stopped-dot)', label: 'stopped',  spin: false },
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m${rs < 10 ? '0' : ''}${rs}s`
}

export default function AgentCard({ agent, selected, dimOpacity, onSelect, onClone }: Props): JSX.Element {
  const { agents, setAgents, selectAgent } = useAgentsStore()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [hovered, setHovered] = useState(false)

  const sv = STATUS_VARS[agent.status]
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    if (!agent.workingStartedAt) return
    const t = setInterval(() => forceUpdate(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [!!agent.workingStartedAt])

  const elapsedSec = agent.workingStartedAt
    ? Math.floor((Date.now() - agent.workingStartedAt) / 1000)
    : null

  const handleRemove = async () => {
    await window.api.removeAgent(agent.id)
    const next = agents.filter(a => a.id !== agent.id)
    setAgents(next)
    if (selected && next.length > 0) selectAgent(next[0].id)
  }

  const commitRename = async () => {
    setRenaming(false)
    if (renameVal.trim() && renameVal.trim() !== agent.name)
      await window.api.renameAgent(agent.id, renameVal.trim())
  }

  const isFinished = agent.status === 'idle' && agent.unseenResponse && !selected
  const isActive = agent.status === 'thinking' || agent.status === 'working'
  const showStatusLabel = agent.status !== 'idle'

  // CSS-animated green flash when selected agent finishes (replaces 50ms JS timer)
  const [showDoneOverlay, setShowDoneOverlay] = useState(false)
  const prevFinishedRef = useRef(agent.lastFinishedAt)
  useEffect(() => {
    if (agent.lastFinishedAt && agent.lastFinishedAt !== prevFinishedRef.current && selected && agent.status === 'idle') {
      prevFinishedRef.current = agent.lastFinishedAt
      setShowDoneOverlay(true)
      const t = setTimeout(() => setShowDoneOverlay(false), 3100)
      return () => clearTimeout(t)
    }
    prevFinishedRef.current = agent.lastFinishedAt
  }, [agent.lastFinishedAt, selected, agent.status])

  // State tint
  const stateTint = isFinished
    ? (hovered ? '#dcfce7' : 'var(--finished-bg)')
    : isActive
    ? (selected ? (hovered ? '#fef0c7' : '#fef5e1') : (hovered ? '#fef5e1' : '#fffaf0'))
    : null

  const cardBg = selected
    ? (stateTint ?? 'var(--selected-bg)')
    : stateTint ?? (hovered ? 'var(--surface-hover)' : 'transparent')

  const meta: string[] = []

  return (
    <>
      <div
        onClick={onSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
        style={{
          position: 'relative' as const,
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: '1px solid var(--border)',
          borderLeft: isFinished
            ? '4px solid #22c55e'
            : isActive
            ? '4px solid #e89b0e'
            : selected || hovered
            ? '4px solid var(--accent)'
            : '4px solid transparent',
          background: cardBg,
          transition: 'opacity 0.3s',
          boxShadow: selected || hovered ? 'inset 0 0 0 1px var(--accent-border)' : 'none',
          opacity: (selected || hovered) ? 1 : dimOpacity,
        }}
      >
        {showDoneOverlay && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'rgba(34, 197, 94, 0.15)',
            animation: 'fadeOut 3s ease-out forwards',
          }} />
        )}
        {/* Row 1: name + badges + status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          {renaming ? (
            <input
              autoFocus value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
              onClick={e => e.stopPropagation()}
              style={{
                flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text)',
                background: 'var(--bg)', border: '2px solid var(--accent)',
                borderRadius: 4, padding: '1px 6px', outline: 'none',
              }}
            />
          ) : (
            <span
              onDoubleClick={e => { e.stopPropagation(); setRenameVal(agent.name); setRenaming(true) }}
              title="Double-click to rename"
              style={{
                flex: 1, fontSize: 14, fontWeight: selected ? 700 : 600,
                color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {agent.name}
            </span>
          )}

          {agent.cli === 'codex' && (
            <span title="Runs Codex CLI" style={{
              fontSize: 10, fontWeight: 600, color: 'var(--text-dim)',
              border: '1px solid var(--border)', borderRadius: 4,
              padding: '0 5px', flexShrink: 0,
            }}>
              codex
            </span>
          )}

          {elapsedSec !== null && (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: sv.fg, flexShrink: 0 }}>
              {formatDuration(elapsedSec)}
            </span>
          )}

          {isFinished && (
            <span title="Waiting for input" style={{
              fontSize: 11, fontWeight: 700, color: '#fff', background: '#22c55e',
              borderRadius: 10, padding: '1px 7px', flexShrink: 0,
              animation: 'pulse 1.8s ease-in-out infinite',
            }}>
              done{agent.lastTaskDuration != null ? ` ${formatDuration(agent.lastTaskDuration)}` : ''}
            </span>
          )}

          {showStatusLabel && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: sv.fg, background: sv.bg,
              borderRadius: 4, padding: '1px 6px', flexShrink: 0,
            }}>
              {sv.label}
            </span>
          )}

          {/* Status dot / spinner */}
          {sv.spin ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, animation: 'statusSpin 0.7s linear infinite' }}>
              <circle cx="8" cy="8" r="4.5" stroke={sv.dot} strokeOpacity={0.5} strokeWidth={6} />
              <path d="M8 3.5a4.5 4.5 0 0 1 4.5 4.5" stroke={sv.dot} strokeWidth={6} strokeLinecap="round" />
            </svg>
          ) : (
            <span style={{
              width: isFinished ? 12 : 9, height: isFinished ? 12 : 9,
              borderRadius: '50%', flexShrink: 0,
              background: isFinished ? '#22c55e' : sv.dot,
            }} />
          )}
        </div>

        {/* Row 2: working directory + branch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <span style={{
            color: 'var(--text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {squashHome(agent.worktreePath)}
          </span>
          {(agent.currentBranch || agent.branchName) && (
            <span style={{
              color: 'var(--accent)',
              display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
            }}>
              <GitBranch size={11} strokeWidth={2.5} />
              {agent.currentBranch || agent.branchName}
            </span>
          )}
        </div>

        {/* Row 3: PR title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: meta.length > 0 || agent.contextPercent >= 80 ? 3 : 0, minWidth: 0 }}>
          {agent.prTitle && (
            <span title={agent.prTitle} style={{
              fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
            }}>
              {agent.prTitle}
            </span>
          )}
        </div>

        {/* Row 3: meta */}
        {(meta.length > 0 || agent.contextPercent >= 80) && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 0 }}>
            {meta.map((item, i) => (
              <span key={i}>
                {i > 0 && <span style={{ margin: '0 5px', opacity: 0.4 }}>&middot;</span>}
                {item}
              </span>
            ))}
            {agent.contextPercent >= 80 && (
              <span style={{
                fontWeight: 600,
                color: agent.contextPercent >= 90 ? 'var(--s-error-fg)' : 'var(--s-thinking-fg)',
                marginLeft: meta.length > 0 ? 5 : 0,
              }}>
                {meta.length > 0 && <span style={{ opacity: 0.4, fontWeight: 400, marginRight: 5 }}>&middot;</span>}
                {Math.round(agent.contextPercent)}%
              </span>
            )}
          </div>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y} agent={agent}
          onClose={() => setCtxMenu(null)}
          onRemove={handleRemove}
          onRestart={() => window.api.restartAgent(agent.id)}
          onRename={() => { setRenameVal(agent.name); setRenaming(true) }}
          onClone={onClone}
        />
      )}
    </>
  )
}
