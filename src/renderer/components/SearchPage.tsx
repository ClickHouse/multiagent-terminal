import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, X, FolderOpen } from 'lucide-react'
import { useAgentsStore } from '../store/agents'

interface SearchMatch {
  agentId: string
  logFile: string
  line: string
  lineNumber: number
  contextBefore: string
  contextAfter: string
}

interface Props {
  onSelectAgent: (agentId: string) => void
}

export default function SearchPage({ onSelectAgent }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)
  const agents = useAgentsStore(s => s.agents)

  const agentNameMap = useMemo(() => new Map(agents.map(a => [a.id, a.name])), [agents])
  const agentPathMap = useMemo(() => new Map(agents.map(a => [a.id, a.worktreePath])), [agents])

  useEffect(() => { inputRef.current?.focus() }, [])

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      setSelectedAgent(null)
      return
    }
    const id = ++reqId.current
    setLoading(true)
    window.api.searchLogs(q.trim()).then(matches => {
      if (id !== reqId.current) return
      setResults(matches)
      setSearched(true)
      setLoading(false)
      // Auto-select first agent with results
      if (matches.length > 0) {
        setSelectedAgent(prev => {
          // Keep selection if it still has results
          if (prev && matches.some(m => m.agentId === prev)) return prev
          return matches[0].agentId
        })
      } else {
        setSelectedAgent(null)
      }
    }).catch(() => {
      if (id !== reqId.current) return
      setLoading(false)
      setSearched(true)
    })
  }, [])

  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const handleChange = (value: string) => {
    setQuery(value)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(value), 300)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      clearTimeout(timerRef.current)
      doSearch(query)
    }
    if (e.key === 'Escape' && query) {
      setQuery('')
      setResults([])
      setSearched(false)
      setSelectedAgent(null)
    }
  }

  // Group results by agent, sorted by match count desc
  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>()
    for (const m of results) {
      const list = map.get(m.agentId) ?? []
      list.push(m)
      map.set(m.agentId, list)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [results])

  const selectedMatches = useMemo(() => {
    if (!selectedAgent) return []
    return results.filter(m => m.agentId === selectedAgent)
  }, [results, selectedAgent])

  function highlightMatch(text: string, q: string): JSX.Element {
    if (!q) return <>{text}</>
    const lower = text.toLowerCase()
    const qLower = q.toLowerCase()
    const parts: JSX.Element[] = []
    let last = 0
    let idx = lower.indexOf(qLower)
    let key = 0
    while (idx >= 0) {
      if (idx > last) parts.push(<span key={key++}>{text.slice(last, idx)}</span>)
      parts.push(
        <span key={key++} style={{ background: '#fde68a', borderRadius: 2, padding: '0 1px' }}>
          {text.slice(idx, idx + q.length)}
        </span>
      )
      last = idx + q.length
      idx = lower.indexOf(qLower, last)
    }
    if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>)
    return <>{parts}</>
  }

  // Squash home prefix for display
  const home = typeof window !== 'undefined' ? '' : ''
  function shortPath(p: string): string {
    if (!p) return ''
    const h = p.match(/^\/home\/[^/]+/)?.[0] || p.match(/^\/Users\/[^/]+/)?.[0]
    return h ? '~' + p.slice(h.length) : p
  }

  const hasResults = searched && results.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Search bar */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '8px 14px',
        }}>
          <Search size={15} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search across all agent terminals..."
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-ui)',
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); setSearched(false); setSelectedAgent(null); inputRef.current?.focus() }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 2 }}
            >
              <X size={14} />
            </button>
          )}
          {searched && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
              {results.length}{results.length >= 200 ? '+' : ''} match{results.length === 1 ? '' : 'es'}
              {grouped.length > 0 && ` in ${grouped.length} agent${grouped.length === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
      </div>

      {/* Two-panel body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left panel: agents with matches */}
        <div style={{
          width: 260, flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {loading && (
            <div style={{ padding: 20, color: 'var(--text-dim)', fontSize: 13 }}>Searching...</div>
          )}

          {!loading && !searched && (
            <div style={{ padding: 20, color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.8 }}>
              Search terminal output across all agents.
              <div style={{ marginTop: 8 }}>
                <kbd style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 4, padding: '2px 6px', fontSize: 11, fontFamily: 'var(--font-mono)',
                }}>Ctrl+Shift+F</kbd>
                {' '}from anywhere
              </div>
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div style={{ padding: 20, color: 'var(--text-dim)', fontSize: 13 }}>
              No matches
            </div>
          )}

          {!loading && hasResults && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {grouped.map(([agentId, matches]) => {
                const name = agentNameMap.get(agentId) ?? agentId.slice(0, 8)
                const agentPath = agentPathMap.get(agentId)
                const isSelected = selectedAgent === agentId
                return (
                  <div
                    key={agentId}
                    onClick={() => setSelectedAgent(agentId)}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--selected-bg)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600,
                        color: isSelected ? 'var(--accent)' : 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {name}
                      </span>
                      <span style={{
                        fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0, marginLeft: 8,
                        color: 'var(--text-dim)',
                        background: isSelected ? 'var(--accent-light)' : 'var(--surface2)',
                        borderRadius: 10, padding: '1px 7px',
                      }}>
                        {matches.length}
                      </span>
                    </div>
                    {agentPath && (
                      <div style={{
                        fontSize: 11, color: 'var(--text-dim)', marginTop: 3,
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {shortPath(agentPath)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right panel: matches for selected agent */}
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
          {!hasResults && !loading && searched && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', color: 'var(--text-dim)', fontSize: 13,
            }}>
              No matches found for "{query}"
            </div>
          )}

          {!hasResults && !loading && !searched && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', color: 'var(--text-dim)', fontSize: 13, flexDirection: 'column', gap: 4,
            }}>
              <Search size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
              Type to search
            </div>
          )}

          {hasResults && selectedAgent && (
            <div style={{ padding: 0 }}>
              {/* Selected agent header */}
              <div style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                position: 'sticky', top: 0, zIndex: 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {agentNameMap.get(selectedAgent) ?? selectedAgent.slice(0, 8)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                    {selectedMatches.length} match{selectedMatches.length === 1 ? '' : 'es'}
                  </span>
                </div>
                <button
                  onClick={() => onSelectAgent(selectedAgent)}
                  title="Open agent terminal"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', background: 'var(--bg)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <FolderOpen size={12} /> Open
                </button>
              </div>

              {/* Match list */}
              {selectedMatches.map((m, i) => (
                <div
                  key={`${m.logFile}-${m.lineNumber}-${i}`}
                  style={{
                    padding: '10px 20px',
                    borderBottom: '1px solid var(--border)',
                    fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7,
                  }}
                >
                  {m.contextBefore && (
                    <div style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.contextBefore}
                    </div>
                  )}
                  <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--text-dim)', userSelect: 'none', marginRight: 10 }}>
                      {m.lineNumber}
                    </span>
                    {highlightMatch(m.line, query)}
                  </div>
                  {m.contextAfter && (
                    <div style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.contextAfter}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasResults && !selectedAgent && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', color: 'var(--text-dim)', fontSize: 13,
            }}>
              Select an agent from the left panel
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
