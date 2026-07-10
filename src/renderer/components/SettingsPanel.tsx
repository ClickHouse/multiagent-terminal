import { useSettings } from '../store/settings'
import { AGENT_CLIS, AgentCli } from '../../shared/types'

interface Props { onClose: () => void }

export default function SettingsPanel({ onClose }: Props): JSX.Element {
  const { defaultCli, fontSize, scrollSpeed, scrollback, skipPermissions, devTools, resumeOnOpen, notifications, brightAgents, set } = useSettings()

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.35)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 20px 60px rgba(15,23,42,0.15)',
        width: 420, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Settings</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px' }}>

          {/* Section: General */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
            General
          </div>

          {/* Default agent CLI */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Default agent CLI</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Used for new agents — override per agent via its context menu</div>
            </div>
            <select
              value={defaultCli}
              onChange={e => set({ defaultCli: e.target.value as AgentCli })}
              style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '4px 8px', fontSize: 12,
                color: 'var(--text)', cursor: 'pointer', outline: 'none',
              }}>
              {AGENT_CLIS.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Notifications */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>System notifications</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Notify when an agent finishes working</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={notifications}
                onChange={e => set({ notifications: e.target.checked })}
                style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
            </label>
          </div>

          {/* Section: Terminal */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12, marginTop: 20 }}>
            Terminal
          </div>

        {/* Skip permissions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Skip permission prompts</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Claude: --dangerously-skip-permissions · Codex: --dangerously-bypass-approvals-and-sandbox (restart agent to apply)</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={e => set({ skipPermissions: e.target.checked })}
                style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
            </label>
          </div>

        {/* DevTools */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Chrome DevTools</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Open on startup (restart required)</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={devTools}
                onChange={e => set({ devTools: e.target.checked })}
                style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
            </label>
          </div>

        {/* Font size */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Font size</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Applies to all terminals</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => set({ fontSize: Math.max(8, fontSize - 1) })}
                style={{ ...btnStyle, width: 28 }}
              >−</button>
              <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', minWidth: 20, textAlign: 'center' }}>
                {fontSize}
              </span>
              <button
                onClick={() => set({ fontSize: Math.min(24, fontSize + 1) })}
                style={{ ...btnStyle, width: 28 }}
              >+</button>
              <input
                type="range" min={8} max={24} value={fontSize}
                onChange={e => set({ fontSize: Number(e.target.value) })}
                style={{ width: 80, accentColor: 'var(--accent)' }}
              />
            </div>
          </div>

        {/* Scroll speed */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Scroll speed</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Terminal scroll sensitivity (Alt = 3x faster)</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', minWidth: 20, textAlign: 'center' }}>
                {scrollSpeed}
              </span>
              <input
                type="range" min={1} max={10} value={scrollSpeed}
                onChange={e => set({ scrollSpeed: Number(e.target.value) })}
                style={{ width: 80, accentColor: 'var(--accent)' }}
              />
            </div>
          </div>

        {/* Bright agents */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Bright agents</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>How many recent agents stay at full opacity (older ones fade)</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', minWidth: 20, textAlign: 'center' }}>
                {brightAgents}
              </span>
              <input
                type="range" min={0} max={20} value={brightAgents}
                onChange={e => set({ brightAgents: Number(e.target.value) })}
                style={{ width: 80, accentColor: 'var(--accent)' }}
              />
            </div>
          </div>

        {/* Scrollback */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Max lines</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Terminal scrollback buffer (restart agent to apply)</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', minWidth: 36, textAlign: 'center' }}>
                {scrollback}
              </span>
              <input
                type="range" min={1000} max={50000} step={1000} value={scrollback}
                onChange={e => set({ scrollback: Number(e.target.value) })}
                style={{ width: 80, accentColor: 'var(--accent)' }}
              />
            </div>
          </div>


        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius)', padding: '6px 18px', fontSize: 13,
            fontWeight: 500, cursor: 'pointer',
          }}>Done</button>
        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  height: 28, background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', fontSize: 16, cursor: 'pointer',
  color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
