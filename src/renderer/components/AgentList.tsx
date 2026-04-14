import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Settings, Plus, BarChart3 } from 'lucide-react'
import { useAgentsStore } from '../store/agents'
import AgentCard from './AgentCard'
import NewAgentDialog from './NewAgentDialog'
import SettingsPanel from './SettingsPanel'

const RECENT_COUNT = 6
const NEW_AGENT_MS = 60 * 60 * 1000 // 1 hour

interface AgentListProps {
  currentPage: 'agents' | 'stats'
  onPageChange: (page: 'agents' | 'stats') => void
}

export default function AgentList({ currentPage, onPageChange }: AgentListProps): JSX.Element {
  const { agents, selectedId, selectAgent, setAgents } = useAgentsStore()
  const [showNew, setShowNew] = useState(false)
  const [cloneFrom, setCloneFrom] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // Highlight recently active agents. No dimming when ≤5 total.
  const recentIds = useMemo(() => {
    if (agents.length <= RECENT_COUNT) return null // all highlighted
    const now = Date.now()
    const activeIds = new Set(
      agents.filter(a => a.status === 'thinking' || a.status === 'working').map(a => a.id)
    )
    const ranked = agents
      .filter(a => !activeIds.has(a.id))
      .map(a => {
        const isNew = now - Date.parse(a.createdAt) < NEW_AGENT_MS
        return { id: a.id, ts: a.lastInputAt ?? (isNew ? Date.parse(a.createdAt) : 0) }
      })
      .filter(a => a.ts > 0)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RECENT_COUNT - activeIds.size)
      .map(a => a.id)
    return new Set([...activeIds, ...ranked])
  }, [agents])

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const handleCreated = (agent: any) => {
    if (!agents.find((a: any) => a.id === agent.id)) {
      setAgents([...agents, agent])
    }
    selectAgent(agent.id)
    setShowNew(false)
    setCloneFrom(null)
  }

  const handleClone = (agentId: string) => {
    setCloneFrom(agentId)
    setShowNew(true)
  }

  const onDragStart = useCallback((e: React.DragEvent, agentId: string) => {
    setDragId(agentId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', agentId)
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5'
    }
  }, [])

  // Auto-scroll when dragging near edges
  const scrollRafRef = useRef<number | null>(null)
  const dragYRef = useRef(0)

  useEffect(() => {
    if (!dragId) {
      if (scrollRafRef.current) { cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = null }
      return
    }
    const EDGE = 40
    const SPEED = 8
    const tick = () => {
      const el = listRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const y = dragYRef.current
      if (y < rect.top + EDGE && el.scrollTop > 0) {
        el.scrollTop -= SPEED
      } else if (y > rect.bottom - EDGE && el.scrollTop < el.scrollHeight - el.clientHeight) {
        el.scrollTop += SPEED
      }
      scrollRafRef.current = requestAnimationFrame(tick)
    }
    scrollRafRef.current = requestAnimationFrame(tick)
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current) }
  }, [dragId])

  const onDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
    setDragId(null)
    setDropTarget(null)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(idx)
  }, [])

  const onDrop = useCallback((e: React.DragEvent, targetIdx: number) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId) return
    const sourceIdx = agents.findIndex(a => a.id === sourceId)
    if (sourceIdx < 0 || sourceIdx === targetIdx) return

    const reordered = [...agents]
    const [moved] = reordered.splice(sourceIdx, 1)
    reordered.splice(targetIdx, 0, moved)

    setAgents(reordered)
    window.api.reorderAgents(reordered.map(a => a.id))
    setDragId(null)
    setDropTarget(null)
  }, [agents, setAgents])

  const sourceAgent = cloneFrom ? agents.find(a => a.id === cloneFrom) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px 10px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: 2 }}>
          {([
            { key: 'agents' as const, label: 'Agents', count: agents.length > 0 ? agents.length : undefined },
            { key: 'stats' as const, label: 'Stats', icon: <BarChart3 size={11} strokeWidth={2.2} /> },
          ]).map(tab => {
            const active = currentPage === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => onPageChange(tab.key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  cursor: 'pointer', border: 'none', borderRadius: 4,
                  background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-dim)',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                {tab.icon}{tab.label}
                {tab.count !== undefined && (
                  <span style={{
                    fontSize: 10, background: active ? 'var(--surface2)' : 'var(--border)',
                    color: 'var(--text-dim)', borderRadius: 10, padding: '0px 5px', fontWeight: 500,
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => setShowSettings(true)}
          title="Settings"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '5px 7px',
            cursor: 'pointer', color: 'var(--text-dim)',
          }}
        ><Settings size={14} /></button>
        <button
          onClick={() => { setCloneFrom(null); setShowNew(true) }}
          title="New agent"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius)', padding: '5px 10px',
            fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}
        >
          <Plus size={13} strokeWidth={2.5} /> New
        </button>
        </div>
      </div>

      {/* Agent list */}
      <div ref={listRef} onDragOver={e => { dragYRef.current = e.clientY }} style={{ flex: 1, overflowY: 'auto' }}>
        {agents.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.8 }}>
            No agents yet.<br />Click <strong>+ New</strong> to create one.
          </div>
        ) : (
          agents.map((agent, idx) => {
            const isSel = agent.id === selectedId
            return (
              <div
                key={agent.id}
                draggable
                onDragStart={e => onDragStart(e, agent.id)}
                onDragEnd={onDragEnd}
                onDragOver={e => onDragOver(e, idx)}
                onDrop={e => onDrop(e, idx)}
                style={{
                  borderTop: dropTarget === idx && dragId !== agent.id
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                  ...(isSel ? { position: 'sticky' as const, top: 0, bottom: 0, zIndex: 2 } : {}),
                }}
              >
                <AgentCard
                  agent={agent}
                  selected={isSel}
                  recentlyActive={recentIds === null || recentIds.has(agent.id)}
                  onSelect={() => { selectAgent(agent.id); onPageChange('agents') }}
                  onClone={() => handleClone(agent.id)}
                />
              </div>
            )
          })
        )}
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showNew && (
        <NewAgentDialog
          onClose={() => { setShowNew(false); setCloneFrom(null) }}
          onCreated={handleCreated}
          sourceAgent={sourceAgent}
        />
      )}
    </div>
  )
}
