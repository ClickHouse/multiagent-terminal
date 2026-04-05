import { useState } from 'react'
import { Settings, Plus } from 'lucide-react'
import { useAgentsStore } from '../store/agents'
import AgentCard from './AgentCard'
import NewAgentDialog from './NewAgentDialog'
import SettingsPanel from './SettingsPanel'

export default function AgentList(): JSX.Element {
  const { agents, selectedId, selectAgent, setAgents } = useAgentsStore()
  const [showNew, setShowNew] = useState(false)
  const [cloneFrom, setCloneFrom] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const handleCreated = (agent: any) => {
    console.log('[AgentList] handleCreated:', agent?.name, agent?.id, 'status:', agent?.status)
    if (!agents.find((a: any) => a.id === agent.id)) {
      console.log('[AgentList] adding locally, agents before:', agents.length)
      setAgents([...agents, agent])
    } else {
      console.log('[AgentList] already in store (from broadcast)')
    }
    selectAgent(agent.id)
    setShowNew(false)
    setCloneFrom(null)
  }

  const handleClone = (agentId: string) => {
    setCloneFrom(agentId)
    setShowNew(true)
  }

  const sourceAgent = cloneFrom ? agents.find(a => a.id === cloneFrom) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px 10px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Agents
          </span>
          {agents.length > 0 && (
            <span style={{
              fontSize: 11, background: 'var(--surface2)', color: 'var(--text-dim)',
              borderRadius: 10, padding: '1px 6px', fontWeight: 500,
            }}>
              {agents.length}
            </span>
          )}
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
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {agents.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.8 }}>
            No agents yet.<br />Click <strong>+ New</strong> to create one.
          </div>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedId}
              onSelect={() => selectAgent(agent.id)}
              onClone={() => handleClone(agent.id)}
            />
          ))
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
