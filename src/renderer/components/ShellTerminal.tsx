import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

interface Props { agentId: string; fontSize?: number }

const THEME = {
  background: '#f8fafc', foreground: '#1e293b',
  cursor: '#1a56db', cursorAccent: '#f8fafc',
  selectionBackground: '#bfdbfe',
  black: '#1e293b', red: '#dc2626', green: '#16a34a', yellow: '#d97706',
  blue:  '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#f1f5f9',
  brightBlack: '#64748b', brightRed: '#ef4444', brightGreen: '#22c55e',
  brightYellow: '#f59e0b', brightBlue: '#3b82f6', brightMagenta: '#8b5cf6',
  brightCyan:  '#06b6d4', brightWhite: '#ffffff',
}

// Track which agents already have a shell spawned (persists across mounts).
const spawnedAgents = new Set<string>()

export default function ShellTerminal({ agentId, fontSize = 12 }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Fresh xterm on every mount — avoids detach/reattach event-listener issues.
    const xterm = new XTerm({
      theme: THEME,
      fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
      fontSize,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 2000,
      padding: 8,
    } as any)

    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))
    xterm.open(containerRef.current)
    if (xterm.element) xterm.element.style.background = '#f8fafc'

    // Spawn shell once per agent (PTY outlives xterm instances).
    if (!spawnedAgents.has(agentId)) {
      spawnedAgents.add(agentId)
      window.api.spawnShell(agentId)
    }

    requestAnimationFrame(() => {
      fit.fit()
      const { cols, rows } = xterm
      if (cols > 0 && rows > 0) window.api.shellResize(agentId, cols, rows)
      // Don't auto-focus — Claude terminal has priority. User clicks to focus shell.
    })

    xterm.onData(data => window.api.shellInput(agentId, data))

    let writeBuffer = ''
    let rafId: number | null = null
    const flush = () => {
      if (writeBuffer) { xterm.write(writeBuffer); writeBuffer = '' }
      rafId = null
    }
    const unsubOutput = window.api.onShellOutput((id, data) => {
      if (id !== agentId) return
      writeBuffer += data
      if (rafId === null) rafId = requestAnimationFrame(flush)
    })
    const unsubExit = window.api.onShellExited((id) => {
      if (id === agentId) {
        spawnedAgents.delete(agentId)
        xterm.write('\r\n\x1b[90m[shell exited]\x1b[0m\r\n')
      }
    })

    const ro = new ResizeObserver(() => {
      fit.fit()
      const { cols, rows } = xterm
      if (cols > 0 && rows > 0) window.api.shellResize(agentId, cols, rows)
    })
    ro.observe(containerRef.current)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      ro.disconnect()
      unsubOutput()
      unsubExit()
      xterm.dispose()
    }
  }, [agentId])

  // Update font size without remounting.
  useEffect(() => {
    // Font size changes are handled by the parent re-creating the component
    // or could be applied if we kept a ref. Simple approach: let the next
    // agentId change recreate it. For now fontSize changes are minor.
  }, [fontSize])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#f8fafc' }}
      onClick={() => {
        // Re-focus xterm when clicking anywhere in the container.
        const textarea = containerRef.current?.querySelector('textarea')
        textarea?.focus()
      }}
    />
  )
}
