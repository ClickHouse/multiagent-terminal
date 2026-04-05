import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface Props { agentId: string; fontSize?: number }

interface Cached { xterm: XTerm; fit: FitAddon }

// Keep terminals alive across agent switches — never dispose them.
const cache = new Map<string, Cached>()

const THEME = {
  background:          '#ffffff',
  foreground:          '#1e293b',
  cursor:              '#1a56db',
  cursorAccent:        '#ffffff',
  selectionBackground: '#bfdbfe',
  black: '#1e293b', red: '#dc2626', green: '#16a34a', yellow: '#d97706',
  blue:  '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#f8fafc',
  brightBlack: '#64748b', brightRed: '#ef4444', brightGreen: '#22c55e',
  brightYellow: '#f59e0b', brightBlue: '#3b82f6', brightMagenta: '#8b5cf6',
  brightCyan:  '#06b6d4', brightWhite: '#ffffff',
}

function createAndCache(agentId: string, fontSize: number): Cached {
  const xterm = new XTerm({
    theme: THEME,
    fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
    fontSize,
    lineHeight: 1.45,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 5000,
    padding: 12,
    linkHandler: {
      activate: (_e: MouseEvent, uri: string) => window.api.openExternal(uri),
    },
  } as any)

  const fit = new FitAddon()
  xterm.loadAddon(fit)
  xterm.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))

  xterm.onData(data => window.api.sendInput(agentId, data))

  // Wire PTY output → xterm with write batching.
  // All chunks arriving within one animation frame are coalesced into a single
  // xterm.write() call, so the terminal jumps to the bottom once rather than
  // scrolling line-by-line through each incoming chunk.
  let writeBuffer = ''
  let rafId: number | null = null
  const flush = () => {
    if (writeBuffer) { xterm.write(writeBuffer); writeBuffer = '' }
    rafId = null
  }
  window.api.onTerminalOutput((id, data) => {
    if (id !== agentId) return
    writeBuffer += data
    if (rafId === null) rafId = requestAnimationFrame(flush)
  })

  const inst = { xterm, fit }
  cache.set(agentId, inst)
  return inst
}

export default function Terminal({ agentId, fontSize = 13 }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  // Update font size live without rebuilding.
  useEffect(() => {
    const inst = cache.get(agentId)
    if (inst) {
      inst.xterm.options.fontSize = fontSize
      inst.fit.fit()
    }
  }, [fontSize, agentId])

  useEffect(() => {
    if (!containerRef.current) return

    let inst = cache.get(agentId)

    // Safely detach any previous terminal — don't use innerHTML='' which destroys xterm's DOM.
    while (containerRef.current.firstChild) {
      containerRef.current.removeChild(containerRef.current.firstChild)
    }

    if (!inst) {
      inst = createAndCache(agentId, fontSize)
      inst.xterm.open(containerRef.current)
      // Paint the xterm root element white so the gap below the last row isn't black.
      if (inst.xterm.element) inst.xterm.element.style.background = '#ffffff'
    } else {
      if (inst.xterm.element) {
        containerRef.current.appendChild(inst.xterm.element)
      }
    }

    const { xterm, fit } = inst

    requestAnimationFrame(() => {
      fit.fit()
      const { cols, rows } = xterm
      if (cols > 0 && rows > 0) window.api.resizeTerminal(agentId, cols, rows)
      xterm.focus()
    })

    const ro = new ResizeObserver(() => {
      fit.fit()
      const { cols, rows } = xterm
      if (cols > 0 && rows > 0) window.api.resizeTerminal(agentId, cols, rows)
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      // Do NOT dispose or remove the xterm element —
      // it lives in the cache and will be reattached on next switch.
    }
  }, [agentId])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100%',
        overflow: 'hidden',
        background: '#ffffff',
      }}
      onClick={() => {
        cache.get(agentId)?.xterm.focus()
      }}
    />
  )
}
