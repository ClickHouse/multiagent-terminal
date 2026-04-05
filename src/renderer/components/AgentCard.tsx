import { useState } from 'react'
import { GitBranch, FilePen } from 'lucide-react'
import { Agent, AgentStatus } from '../../shared/types'
import { useAgentsStore } from '../store/agents'
import ContextMenu from './ContextMenu'
import { squashHome } from '../utils'

interface Props {
  agent: Agent
  selected: boolean
  onSelect: () => void
  onClone: () => void
}

// CSS variable keys for each status — keeps component markup clean.
const STATUS_VARS: Record<AgentStatus, { fg: string; bg: string; dot: string; label: string; pulse: boolean }> = {
  starting: { fg: 'var(--s-starting-fg)', bg: 'var(--s-starting-bg)', dot: 'var(--s-starting-dot)', label: 'starting', pulse: false },
  idle:     { fg: 'var(--s-idle-fg)',     bg: 'var(--s-idle-bg)',     dot: 'var(--s-idle-dot)',     label: 'idle',     pulse: false },
  thinking: { fg: 'var(--s-thinking-fg)', bg: 'var(--s-thinking-bg)', dot: 'var(--s-thinking-dot)', label: 'thinking', pulse: true  },
  working:  { fg: 'var(--s-working-fg)',  bg: 'var(--s-working-bg)',  dot: 'var(--s-working-dot)',  label: 'working',  pulse: true  },
  error:    { fg: 'var(--s-error-fg)',    bg: 'var(--s-error-bg)',    dot: 'var(--s-error-dot)',    label: 'error',    pulse: false },
  stopped:  { fg: 'var(--s-stopped-fg)', bg: 'var(--s-stopped-bg)', dot: 'var(--s-stopped-dot)', label: 'stopped',  pulse: false },
}

export default function AgentCard({ agent, selected, onSelect, onClone }: Props): JSX.Element {
  const { agents, setAgents, selectAgent } = useAgentsStore()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')

  const sv = STATUS_VARS[agent.status]

  // Pre-warm: start the PTY on hover so it's already loading by the time user clicks.
  const handleMouseEnter = () => {
    if (agent.status === 'stopped') window.api.ensureRunning(agent.id)
  }

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

  return (
    <>
      <div
        onClick={onSelect}
        onMouseEnter={handleMouseEnter}
        onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: '1px solid var(--border)',
          borderLeft: `3px solid ${selected ? 'var(--accent)' : 'transparent'}`,
          background: selected ? 'var(--accent-light)' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--surface-hover)' }}
        onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Row 1: dot + name + status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: sv.dot,
            boxShadow: sv.pulse ? `0 0 0 3px ${sv.dot}40` : 'none',
            transition: 'box-shadow 0.3s',
          }} />

          {renaming ? (
            <input
              autoFocus value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
              onClick={e => e.stopPropagation()}
              style={{
                flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)',
                background: 'var(--bg)', border: '2px solid var(--accent)',
                borderRadius: 4, padding: '1px 6px', outline: 'none',
              }}
            />
          ) : (
            <span
              onDoubleClick={e => { e.stopPropagation(); setRenameVal(agent.name); setRenaming(true) }}
              title="Double-click to rename"
              style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {agent.name}
            </span>
          )}

          {/* "Waiting for input" badge — only when there's an unseen response */}
          {agent.unseenResponse && !selected && (
            <span title="Waiting for input" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 600,
              color: 'var(--s-idle-fg)',
              background: 'var(--s-idle-bg)',
              border: '1px solid var(--s-idle-dot)',
              borderRadius: 10,
              padding: '1px 7px',
              flexShrink: 0,
              animation: 'pulse 2s ease-in-out infinite',
            }}>
              ● waiting
            </span>
          )}

          {agent.status !== 'idle' && (
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: sv.fg, background: sv.bg,
              borderRadius: 4, padding: '1px 7px', flexShrink: 0,
            }}>
              {sv.label}
            </span>
          )}
        </div>

        {/* Row 2: branch + changed files + path */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, paddingLeft: 16, flexWrap: 'wrap' }}>
          {agent.branchName && (
            <span style={{
              fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-mono)',
              color: 'var(--accent)', background: 'var(--accent-light)',
              border: '1px solid var(--accent-border)', borderRadius: 4, padding: '1px 6px', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              <GitBranch size={10} strokeWidth={2.5} />
              {agent.branchName}
            </span>
          )}
          {agent.changedFiles > 0 && (
            <span
              title={`${agent.changedFiles} changed file${agent.changedFiles === 1 ? '' : 's'}`}
              style={{
                fontSize: 10, fontWeight: 600,
                color: 'var(--s-working-fg)', background: 'var(--s-working-bg)',
                borderRadius: 4, padding: '1px 6px', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 3,
              }}
            >
              <FilePen size={10} strokeWidth={2.5} /> {agent.changedFiles}
            </span>
          )}
          {agent.prNumber && (
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: 'var(--s-idle-fg)', background: 'var(--s-idle-bg)',
              borderRadius: 4, padding: '1px 5px', flexShrink: 0,
            }}>
              {agent.prRepo ? `${agent.prRepo}#${agent.prNumber}` : `#${agent.prNumber}`}
            </span>
          )}
          <span style={{
            fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}>
            {squashHome(agent.worktreePath)}
          </span>
        </div>

        {/* Row 3: context bar + meta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16 }}>
          <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2, transition: 'width 0.4s',
              width: `${agent.contextPercent}%`,
              background: agent.contextPercent >= 90 ? 'var(--s-error-dot)'
                        : agent.contextPercent >= 70 ? 'var(--s-thinking-dot)'
                        : 'var(--accent)',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', minWidth: 28, textAlign: 'right' }}>
            {agent.contextPercent > 0 ? `${Math.round(agent.contextPercent)}%` : '—'}
          </span>
          {agent.model && (() => {
            if (typeof agent.model !== 'string') {
              console.error('[AgentCard] agent.model is not a string:', typeof agent.model, agent.model)
              return null
            }
            return <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              {agent.model.replace('claude-', '').replace(/-\d{8}$/, '')}
            </span>
          })()}
          {agent.costUSD > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              ${agent.costUSD.toFixed(3)}
            </span>
          )}
        </div>
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
