import { useEffect, useRef } from 'react'
import { Pencil, Copy, ExternalLink, GitCompare, GitPullRequest, RotateCcw, RefreshCcw, Trash2 } from 'lucide-react'
import { Agent } from '../../shared/types'

interface Props {
  x: number; y: number; agent: Agent
  onClose: () => void; onRemove: () => void
  onRestart: () => void; onRename?: () => void; onClone?: () => void
}

export default function ContextMenu({ x, y, agent, onClose, onRemove, onRestart, onRename, onClone }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const items = [
    { icon: <Pencil size={13} />,         label: 'Rename',                  action: () => { onRename?.(); onClose() } },
    { icon: <Copy size={13} />,           label: 'Clone agent',             action: () => { onClone?.(); onClose() } },
    null,
    { icon: <ExternalLink size={13} />,   label: 'Open in VSCode',          action: () => { window.api.openVSCode(agent.id); onClose() } },
    { icon: <GitCompare size={13} />,     label: 'View diff',               action: () => { window.api.openDiff(agent.id); onClose() } },
    { icon: <GitPullRequest size={13} />, label: 'Open PR',                 action: () => { window.api.openPR(agent.id); onClose() } },
    null,
    {
      icon: <RotateCcw size={13} />, label: 'Restart',
      action: () => { onRestart(); onClose() },
      disabled: agent.status !== 'stopped' && agent.status !== 'error',
    },
    {
      icon: <RefreshCcw size={13} />, label: 'Reset (checkout master, pull)',
      action: () => { window.api.resetAgent(agent.id); onClose() },
    },
    { icon: <Trash2 size={13} />, label: 'Remove agent', danger: true, action: () => { onRemove(); onClose() } },
  ]

  const W = 192, itemH = 30
  const totalH = items.reduce((h, i) => h + (i === null ? 9 : itemH), 0) + 8
  const left = x + W > window.innerWidth  ? x - W : x
  const top  = y + totalH > window.innerHeight ? y - totalH : y

  return (
    <div ref={ref} style={{
      position: 'fixed', zIndex: 1000, left, top,
      width: W, padding: '4px 0',
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: '0 8px 24px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.06)',
    }}>
      {items.map((item, i) =>
        item === null ? (
          <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        ) : (
          <button key={i} onClick={item.disabled ? undefined : item.action}
            disabled={item.disabled}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', textAlign: 'left',
              padding: '0 12px', height: itemH, fontSize: 12,
              background: 'transparent', border: 'none',
              color: item.danger ? 'var(--red)' : item.disabled ? 'var(--text-dim)' : 'var(--text)',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={e => {
              if (!item.disabled) e.currentTarget.style.background = item.danger ? 'var(--red-bg)' : 'var(--surface2)'
            }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ opacity: 0.6, display: 'flex' }}>{item.icon}</span>
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
