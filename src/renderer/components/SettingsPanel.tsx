import { useSettings } from '../store/settings'

interface Props { onClose: () => void }

export default function SettingsPanel({ onClose }: Props): JSX.Element {
  const { fontSize, devTools, resumeOnOpen, set } = useSettings()

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

          {/* Section: Terminal */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
            Terminal
          </div>

          {/* Resume session */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Resume last session</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Pass --continue on open (slower, restores context)</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={resumeOnOpen}
                onChange={e => set({ resumeOnOpen: e.target.checked })}
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

          {/* Preview */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '10px 14px',
            fontFamily: 'var(--font-mono)', fontSize: `${fontSize}px`,
            color: 'var(--text)', lineHeight: 1.5,
          }}>
            <span style={{ color: '#16a34a' }}>user@host</span>
            <span style={{ color: 'var(--text-dim)' }}>:~/project</span>
            <span style={{ color: 'var(--text)' }}>$ </span>
            <span>claude --dangerously-skip-permissions</span>
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
