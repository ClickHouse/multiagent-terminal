import { useRef, useState, useEffect } from 'react'
import { Agent } from '../../shared/types'
import { squashHome } from '../utils'

interface Props {
  onClose: () => void
  onCreated: (agent: Agent) => void
  sourceAgent?: Agent  // if set, pre-fill from this agent (clone)
}

const FUNNY_NAMES = [
  'caffeinated-hamster', 'grumpy-capybara', 'sleepy-axolotl', 'turbo-raccoon',
  'cosmic-platypus', 'rusty-narwhal', 'sneaky-quokka', 'lazy-gopher',
  'spicy-penguin', 'vibing-dragon', 'cursed-ferret', 'blessed-goblin',
  'chaotic-wizard', 'fluffy-gremlin', 'based-potato', 'mega-sloth',
  'yolo-salamander', 'sus-armadillo', 'ultra-opossum', 'funky-pangolin',
]

function randomName(): string {
  return FUNNY_NAMES[Math.floor(Math.random() * FUNNY_NAMES.length)]
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)',
  color: 'var(--text)', borderRadius: 'var(--radius)', padding: '7px 10px',
  fontSize: 13, width: '100%', outline: 'none', fontFamily: 'inherit',
}

const monoStyle: React.CSSProperties = {
  ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 12,
}

export default function NewAgentDialog({ onClose, onCreated, sourceAgent }: Props): JSX.Element {
  const [name, setName] = useState(() => randomName())
  const [baseRepo, setBaseRepo] = useState(() => sourceAgent?.baseRepoPath ?? '')
  const [worktreeDest, setWorktreeDest] = useState('')
  const [createWorktree, setCreateWorktree] = useState(true)
  const [customDest, setCustomDest] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.select(); nameRef.current?.focus() }, [])

  const pickBaseRepo = async () => {
    const chosen = await window.api.pickDirectory()
    if (chosen) setBaseRepo(chosen)
  }

  const pickDest = async () => {
    const chosen = await window.api.pickDirectory()
    if (chosen) setWorktreeDest(chosen)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    setLoading(true); setError('')
    try {
      const agent = await window.api.createAgent(
        trimmedName,
        createWorktree ? (baseRepo.trim() || null) : null,  // base repo only for worktree
        createWorktree ? (worktreeDest.trim() || null) : (baseRepo.trim() || null),  // dest or working dir
        createWorktree,
      )
      onCreated(agent)
    } catch (err: any) {
      setError(err?.message ?? String(err))
      setLoading(false)
    }
  }

  const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'agent-name'

  // Derive the default destination: sibling of base repo, or ~/name if no base set.
  const defaultDest = baseRepo.trim()
    ? `${baseRepo.trim().replace(/\/$/, '')}-${sanitized}`
    : `~/${sanitized}`

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.35)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        boxShadow: '0 20px 60px rgba(15,23,42,0.15)', padding: '24px 28px', width: 480,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
            {sourceAgent ? `Clone from ${sourceAgent.name}` : 'New Agent'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} onKeyDown={(e) => e.key === 'Escape' && onClose()}>

          {/* Agent name */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Agent name</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')} />
              <button type="button" title="Random name" onClick={() => setName(randomName())}
                style={{ flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 16, cursor: 'pointer' }}>
                🎲
              </button>
            </div>
          </div>

          {/* Directory — always rendered, label changes based on checkbox */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
              {createWorktree ? 'Base repository' : 'Working directory'}
              <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: 6 }}>
                {createWorktree ? '(leave empty to auto-detect)' : `(empty → ${defaultDest})`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={baseRepo}
                onChange={(e) => setBaseRepo(e.target.value)}
                placeholder={createWorktree ? 'Auto-detect from current directory' : defaultDest}
                style={monoStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <button type="button" onClick={createWorktree ? pickBaseRepo : pickDest}
                style={{ flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Browse…
              </button>
            </div>
          </div>

          {/* Create git worktree — always in the same position */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={createWorktree} onChange={(e) => setCreateWorktree(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Create git worktree</span>
            </label>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3, paddingLeft: 22 }}>
              {createWorktree ? 'New branch + working tree from the base repo.' : 'Run claude directly in the directory, no git operations.'}
            </p>
          </div>

          {/* Worktree destination — only when checkbox is on */}
          {createWorktree && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={customDest} onChange={(e) => { setCustomDest(e.target.checked); if (!e.target.checked) setWorktreeDest('') }}
                    style={{ width: 13, height: 13, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Custom worktree destination</span>
                </label>
              </div>
              {customDest ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={worktreeDest} onChange={(e) => setWorktreeDest(e.target.value)}
                    placeholder={defaultDest} style={monoStyle}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')} />
                  <button type="button" onClick={pickDest}
                    style={{ flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Browse…
                  </button>
                </div>
              ) : (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', padding: '7px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                  {defaultDest}
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 'var(--radius)', padding: '9px 12px', fontSize: 12, marginTop: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button type="button" onClick={onClose}
              style={{ background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 16px', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={loading || !name.trim()}
              style={{ background: loading || !name.trim() ? 'var(--surface2)' : 'var(--accent)', color: loading || !name.trim() ? 'var(--text-dim)' : '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '6px 16px', fontSize: 13, fontWeight: 500, cursor: loading || !name.trim() ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Creating…' : sourceAgent ? 'Clone Agent' : 'Create Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
