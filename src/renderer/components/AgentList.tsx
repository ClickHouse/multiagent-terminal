import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Settings, Plus, BarChart3, Search } from 'lucide-react'
import { useAgentsStore } from '../store/agents'
import { useSettings } from '../store/settings'
import AgentCard from './AgentCard'
import NewAgentDialog from './NewAgentDialog'
import SettingsPanel from './SettingsPanel'

// Opacity decay constants
const OPACITY_MAX = 1.0
const OPACITY_MIN = 0.35
const DECAY_HALF_LIFE = 30 * 60 * 1000  // 30 min — opacity reaches ~0.67 here

type Page = 'agents' | 'stats' | 'search'

interface AgentListProps {
  currentPage: Page
  onPageChange: (page: Page) => void
}

export default function AgentList({ currentPage, onPageChange }: AgentListProps): JSX.Element {
  const { agents, selectedId, selectAgent, setAgents } = useAgentsStore()
  const brightMin = useSettings(s => s.brightAgents)
  const [showNew, setShowNew] = useState(false)
  const [cloneFrom, setCloneFrom] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // Per-agent opacity: top brightMin by recency stay at 1.0,
  // agents needing attention (unseen response, error) stay at 1.0,
  // the rest decay smoothly from last activity timestamp.
  const agentOpacity = useMemo(() => {
    const now = Date.now()
    const map = new Map<string, number>()

    // 1. Identify agents that are always full opacity
    const alwaysBright = new Set<string>()
    for (const a of agents) {
      if (a.status === 'thinking' || a.status === 'working' || a.status === 'starting') {
        alwaysBright.add(a.id)
      } else if (a.unseenResponse || a.status === 'error') {
        alwaysBright.add(a.id)
      }
    }

    // 2. Rank remaining agents by recency, keep top N bright
    const remaining = agents
      .filter(a => !alwaysBright.has(a.id))
      .map(a => ({
        id: a.id,
        ts: a.lastInputAt ?? a.lastFinishedAt ?? Date.parse(a.createdAt),
      }))
      .sort((a, b) => b.ts - a.ts)

    const brightSlots = Math.max(0, brightMin - alwaysBright.size)
    const recentBright = new Set(remaining.slice(0, brightSlots).map(r => r.id))

    // 3. Assign opacities
    for (const a of agents) {
      if (alwaysBright.has(a.id) || recentBright.has(a.id)) {
        map.set(a.id, OPACITY_MAX)
      } else {
        const lastActivity = a.lastInputAt ?? a.lastFinishedAt ?? Date.parse(a.createdAt)
        const elapsed = Math.max(0, now - lastActivity)
        const decay = Math.pow(2, -elapsed / DECAY_HALF_LIFE)
        map.set(a.id, Math.round((OPACITY_MIN + (OPACITY_MAX - OPACITY_MIN) * decay) * 100) / 100)
      }
    }
    return map
  }, [agents, brightMin])

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
            { key: 'search' as const, label: 'Search', icon: <Search size={11} strokeWidth={2.2} /> },
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
                  dimOpacity={agentOpacity.get(agent.id) ?? OPACITY_MAX}
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
