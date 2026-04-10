import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

interface Props { agentId: string; fontSize?: number; scrollSpeed?: number; scrollback?: number; visible?: boolean }

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

function SearchBar({ searchAddon, onClose }: { searchAddon: SearchAddon; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [resultIndex, setResultIndex] = useState(-1)
  const [resultCount, setResultCount] = useState(0)

  useEffect(() => {
    inputRef.current?.focus()
    const dispose = searchAddon.onDidChangeResults((e) => {
      setResultIndex(e.resultIndex)
      setResultCount(e.resultCount)
    })
    return () => dispose.dispose()
  }, [searchAddon])

  const searchOpts = { decorations: { activeMatchColorOverviewRuler: '#f59e0b', matchOverviewRuler: '#bfdbfe' } }

  useEffect(() => {
    if (!query) {
      searchAddon.clearDecorations()
      setResultIndex(-1)
      setResultCount(0)
      return
    }
    searchAddon.findNext(query, searchOpts)
  }, [query, searchAddon])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      searchAddon.clearDecorations()
      onClose()
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        searchAddon.findPrevious(query, searchOpts)
      } else {
        searchAddon.findNext(query, searchOpts)
      }
    }
  }

  const matchLabel = query
    ? resultCount === 0
      ? 'No results'
      : resultIndex >= 0
        ? `${resultIndex + 1}/${resultCount}`
        : `${resultCount}+`
    : null

  return (
    <div style={{
      position: 'absolute', top: 4, right: 16, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: 4,
      background: 'var(--surface, #f8fafc)', border: '1px solid var(--border, #e2e8f0)',
      borderRadius: 6, padding: '4px 8px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        style={{
          width: 180, padding: '3px 6px', fontSize: 12,
          border: '1px solid var(--border, #e2e8f0)', borderRadius: 4,
          background: '#fff', color: 'var(--text, #1e293b)',
          outline: 'none', fontFamily: 'var(--font-mono, monospace)',
        }}
      />
      {matchLabel && (
        <span style={{
          fontSize: 11, color: resultCount === 0 ? 'var(--s-error-fg, #dc2626)' : 'var(--text-dim, #94a3b8)',
          whiteSpace: 'nowrap', minWidth: 32, textAlign: 'center',
        }}>
          {matchLabel}
        </span>
      )}
      <button
        onClick={() => searchAddon.findPrevious(query, searchOpts)}
        title="Previous match (Shift+Enter)"
        style={{
          padding: '2px 6px', fontSize: 12, cursor: 'pointer',
          border: '1px solid var(--border, #e2e8f0)', borderRadius: 4,
          background: 'var(--bg, #fff)', color: 'var(--text-secondary, #64748b)',
        }}
      >&#x25B2;</button>
      <button
        onClick={() => searchAddon.findNext(query, searchOpts)}
        title="Next match (Enter)"
        style={{
          padding: '2px 6px', fontSize: 12, cursor: 'pointer',
          border: '1px solid var(--border, #e2e8f0)', borderRadius: 4,
          background: 'var(--bg, #fff)', color: 'var(--text-secondary, #64748b)',
        }}
      >&#x25BC;</button>
      <button
        onClick={() => { searchAddon.clearDecorations(); onClose() }}
        title="Close (Esc)"
        style={{
          padding: '2px 6px', fontSize: 12, cursor: 'pointer',
          border: '1px solid var(--border, #e2e8f0)', borderRadius: 4,
          background: 'var(--bg, #fff)', color: 'var(--text-secondary, #64748b)',
        }}
      >&times;</button>
    </div>
  )
}

export default function Terminal({ agentId, fontSize = 13, scrollSpeed = 3, scrollback = 5000, visible = true }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const visibleRef = useRef(visible)
  const writeBufferRef = useRef('')
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showSearch, setShowSearch] = useState(false)

  // Keep visibleRef in sync.
  visibleRef.current = visible

  const openSearch = useCallback(() => setShowSearch(true), [])
  const closeSearch = useCallback(() => {
    setShowSearch(false)
    xtermRef.current?.focus()
  }, [])

  // Create xterm once on mount, dispose on unmount.
  useEffect(() => {
    if (!containerRef.current) return

    const xterm = new XTerm({
      theme: THEME,
      fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
      fontSize,
      lineHeight: 1.45,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback,
      padding: 12,
      scrollSensitivity: scrollSpeed,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: scrollSpeed * 3,
      linkHandler: {
        activate: (_e: MouseEvent, uri: string) => window.api.openExternal(uri),
      },
    } as any)

    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))

    const search = new SearchAddon()
    xterm.loadAddon(search)
    searchRef.current = search

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      xterm.loadAddon(webgl)
    } catch { /* GPU unavailable — canvas renderer used */ }

    xterm.open(containerRef.current)

    if (xterm.element) {
      xterm.element.style.background = '#ffffff'
      const vp = xterm.element.querySelector('.xterm-viewport') as HTMLElement | null
      if (vp) vp.style.backgroundColor = '#ffffff'
    }

    xtermRef.current = xterm
    fitRef.current = fit

    xterm.onData(data => window.api.sendInput(agentId, data))

    xterm.onSelectionChange(() => {
      const sel = xterm.getSelection()
      if (sel) window.api.clipboardWrite(sel)
    })

    // Intercept paste in capture phase (before xterm's handler) to strip trailing newlines.
    // Wrap in bracketed paste sequences so Claude treats it as paste (no mid-paste submit)
    // and terminal:input skips markThinking (filtered by \x1b check).
    const pasteHandler = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain')
      if (text) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const cleaned = text.replace(/[\r\n]+$/, '')
        window.api.sendInput(agentId, `\x1b[200~${cleaned}\x1b[201~`)
      }
    }
    const ta = containerRef.current?.querySelector('textarea')
    ta?.addEventListener('paste', pasteHandler as EventListener, { capture: true })

    xterm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Ctrl+Shift+C: copy selection
      if (e.ctrlKey && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
        const sel = xterm.getSelection()
        if (sel) window.api.clipboardWrite(sel)
        return false
      }
      // Ctrl+F or Cmd+F: open search bar
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && e.type === 'keydown') {
        openSearch()
        return false
      }
      return true
    })

    // --- Buffered output with scroll-lock ---
    // When the user scrolls up, new output should NOT yank the viewport to the bottom.
    let userScrolledUp = false
    const viewport = () => xterm.element?.querySelector('.xterm-viewport') as HTMLElement | null

    // Detect user scroll position: if not at bottom, they're reading history.
    xterm.onScroll(() => {
      const buf = xterm.buffer.active
      userScrolledUp = buf.viewportY < buf.baseY
    })

    const flush = () => {
      if (writeBufferRef.current) {
        if (userScrolledUp) {
          const vp = viewport()
          const savedScrollTop = vp?.scrollTop ?? 0
          xterm.write(writeBufferRef.current)
          // Restore scroll position synchronously after write.
          if (vp) vp.scrollTop = savedScrollTop
        } else {
          xterm.write(writeBufferRef.current)
        }
        writeBufferRef.current = ''
      }
      flushTimerRef.current = null
    }

    const unsubOutput = window.api.onTerminalOutput((id, data) => {
      if (id !== agentId) return
      writeBufferRef.current += data
      if (visibleRef.current && flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(flush, 32)
      }
    })

    const unsubClear = window.api.onTerminalClear((id) => {
      if (id !== agentId) return
      writeBufferRef.current = ''
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
      xterm.reset()
    })

    requestAnimationFrame(() => {
      fit.fit()
      const { cols, rows } = xterm
      if (cols > 0 && rows > 0) window.api.resizeTerminal(agentId, cols, rows)
    })

    const ro = new ResizeObserver(() => {
      fit.fit()
      const { cols, rows } = xterm
      if (cols > 0 && rows > 0) window.api.resizeTerminal(agentId, cols, rows)
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      unsubOutput()
      unsubClear()
      xterm.dispose()
      xtermRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
  }, [agentId])

  // Handle fontSize / scrollSpeed changes.
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize
      xtermRef.current.options.scrollSensitivity = scrollSpeed
      xtermRef.current.options.fastScrollSensitivity = scrollSpeed * 3
      fitRef.current?.fit()
    }
  }, [fontSize, scrollSpeed])

  // Handle visibility changes: flush buffer, refit, focus.
  useEffect(() => {
    const xterm = xtermRef.current
    const fit = fitRef.current
    if (!xterm || !fit) return

    if (visible) {
      // Flush buffered output.
      if (writeBufferRef.current) {
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
        xterm.write(writeBufferRef.current)
        writeBufferRef.current = ''
      }
      // Refit after becoming visible (dimensions may have changed).
      requestAnimationFrame(() => {
        fit.fit()
        const { cols, rows } = xterm
        if (cols > 0 && rows > 0) window.api.resizeTerminal(agentId, cols, rows)
        xterm.focus()
      })
    } else {
      // Pause flush timer while hidden.
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
    }
  }, [visible, agentId])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#ffffff', position: 'relative' }}
      onClick={() => xtermRef.current?.focus()}
    >
      {showSearch && searchRef.current && (
        <SearchBar searchAddon={searchRef.current} onClose={closeSearch} />
      )}
    </div>
  )
}
