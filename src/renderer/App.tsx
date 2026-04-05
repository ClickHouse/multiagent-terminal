import { useEffect, useState } from 'react'
import { Component, type ReactNode } from 'react'
import { useAgentsStore, initStoreListeners } from './store/agents'
import { useSettings } from './store/settings'

class ErrorBoundary extends Component<{children: ReactNode}, {error: string|null}> {
  constructor(props: any) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e: any) {
    console.error('[ErrorBoundary] caught:', e)
    return { error: String(e) }
  }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 24, color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        RENDER ERROR:{'\n'}{this.state.error}
      </div>
    )
    return this.props.children
  }
}
import AgentList from './components/AgentList'
import AgentDetail from './components/AgentDetail'
import SetupBanner from './components/SetupBanner'

let listenersInited = false

export default function App(): JSX.Element {
  const { agents, selectedId, baseRepoPath, setAgents, setBaseRepoPath } = useAgentsStore()
  const [loading, setLoading] = useState(true)

  const loadSettings = useSettings(s => s.load)

  useEffect(() => {
    if (!listenersInited) { initStoreListeners(); listenersInited = true }
    loadSettings()
    window.api.getState().then((st: any) => {
      setAgents(st?.agents ?? [])
      setBaseRepoPath(st?.baseRepoPath ?? '')
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null
  console.log('[App] render: agents:', agents.length, 'selectedId:', selectedId, 'selected:', selectedAgent?.name ?? 'null', 'loading:', loading)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Drag region — zero height, invisible */}
      <div style={{ height: 0, WebkitAppRegion: 'drag' as any }} />

<div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{
          width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--border)', background: 'var(--surface)',
          overflow: 'hidden',
        }}>
          <AgentList />
        </div>

        {/* Main panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
          {selectedAgent ? (
            <ErrorBoundary>
              <AgentDetail agent={selectedAgent} />
            </ErrorBoundary>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 32 }}>🤖</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                {agents.length === 0 ? 'Create your first agent to get started.' : 'Select an agent from the sidebar.'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
