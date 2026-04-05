import { useState } from 'react'
import { useAgentsStore } from '../store/agents'

export default function SetupBanner(): JSX.Element {
  const { setBaseRepoPath } = useAgentsStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handlePick = async () => {
    setError(''); setLoading(true)
    try {
      const chosen = await window.api.pickBaseRepo()
      if (chosen) setBaseRepoPath(chosen)
    } catch (e: any) { setError(e?.message ?? String(e)) }
    finally { setLoading(false) }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 16px', borderBottom: '1px solid var(--yellow-bg)',
      background: 'var(--yellow-bg)', fontSize: 12,
    }}>
      <span style={{ color: 'var(--yellow)' }}>⚠</span>
      <span style={{ color: 'var(--text-secondary)' }}>No base repository configured.</span>
      <button onClick={handlePick} disabled={loading} style={{
        background: 'var(--accent)', color: '#fff', border: 'none',
        borderRadius: 'var(--radius)', padding: '3px 10px', fontSize: 12,
        cursor: 'pointer', WebkitAppRegion: 'no-drag' as any,
      }}>
        {loading ? 'Opening…' : 'Choose repository'}
      </button>
      {error && <span style={{ color: 'var(--red)', fontSize: 11 }}>{error}</span>}
    </div>
  )
}
