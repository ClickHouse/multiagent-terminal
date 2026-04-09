import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

interface Props { agentId: string; fontSize?: number; scrollSpeed?: number; visible?: boolean }

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

export default function ShellTerminal({ agentId, fontSize = 12, scrollSpeed = 3, visible = true }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const xterm = new XTerm({
      theme: THEME,
      fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
      fontSize,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true,
      copyOnSelect: true,
      scrollback: 2000,
      padding: 8,
      scrollSensitivity: scrollSpeed,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: scrollSpeed * 3,
    } as any)

    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))
    xterm.open(containerRef.current)
    if (xterm.element) xterm.element.style.background = '#f8fafc'

    xtermRef.current = xterm
    fitRef.current = fit

    // Spawn shell once per agent (PTY outlives xterm instances).
    if (!spawnedAgents.has(agentId)) {
      spawnedAgents.add(agentId)
      window.api.spawnShell(agentId)
    }

    requestAnimationFrame(() => {
      fit.fit()
      const { cols, rows } = xterm
      if (cols > 0 && rows > 0) window.api.shellResize(agentId, cols, rows)
    })

    xterm.onData(data => window.api.shellInput(agentId, data))

    xterm.onSelectionChange(() => {
      const sel = xterm.getSelection()
      if (sel) window.api.clipboardWrite(sel)
    })

    const pasteHandler = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain')
      if (text) {
        e.preventDefault()
        e.stopImmediatePropagation()
        window.api.shellInput(agentId, text.replace(/[\r\n]+$/, ''))
      }
    }
    const ta = containerRef.current?.querySelector('textarea')
    ta?.addEventListener('paste', pasteHandler as EventListener, { capture: true })

    xterm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
        const sel = xterm.getSelection()
        if (sel) window.api.clipboardWrite(sel)
        return false
      }
      return true
    })

    let writeBuffer = ''
    let rafId: number | null = null
    let userScrolledUp = false
    const viewport = () => xterm.element?.querySelector('.xterm-viewport') as HTMLElement | null
    xterm.onScroll(() => {
      userScrolledUp = xterm.buffer.active.viewportY < xterm.buffer.active.baseY
    })
    const flush = () => {
      if (writeBuffer) {
        if (userScrolledUp) {
          const vp = viewport()
          const saved = vp?.scrollTop ?? 0
          xterm.write(writeBuffer)
          if (vp) vp.scrollTop = saved
        } else {
          xterm.write(writeBuffer)
        }
        writeBuffer = ''
      }
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
      xtermRef.current = null
      fitRef.current = null
    }
  }, [agentId])

  // Refit when becoming visible.
  useEffect(() => {
    if (visible && fitRef.current) {
      requestAnimationFrame(() => fitRef.current?.fit())
    }
  }, [visible])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#f8fafc' }}
      onClick={() => xtermRef.current?.focus()}
    />
  )
}
