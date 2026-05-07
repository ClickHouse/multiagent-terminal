# multiagent

Electron desktop app for managing multiple Claude Code agents in parallel. Each agent gets its own git worktree and xterm.js terminal running `claude --dangerously-skip-permissions`.

## Stack
- **Electron** (main process) + **React + TypeScript** (renderer) + **Vite** build
- **node-pty** — PTY management for claude sessions
- **xterm.js** — terminal emulation in the renderer (with WebGL, search, fit, web-links addons)
- **zustand** — renderer state
- **electron-store** — JSON persistence
- **simple-git** — git worktree operations
- **Worker thread** — trigram-indexed cross-agent log search

## Project structure
```
src/
  main/             # Electron main process (Node.js)
    index.ts          — window + IPC handlers
    agentManager.ts   — node-pty spawn/kill/resize, status-tracking, gutter strip
    shellManager.ts   — generic PTY shells (non-Claude)
    worktree.ts       — git worktree add/remove
    state.ts          — electron-store persistence (agents)
    settings.ts       — electron-store persistence (settings)
    setup.ts          — statusline.sh installer + paths/configDir
    statusPipe.ts     — named-pipe reader for Claude statusline JSON
    terminalLog.ts    — per-session log files + search worker bridge
    searchWorker.ts   — Worker thread: trigram index, mtime-lazy refresh
    stats/
      aggregate.ts    — token/cost rollups across sessions
      classifier.ts   — message-type classification
      parser.ts       — Claude session JSONL parser
      pricing.ts      — model pricing tables
      types.ts        — stats data types
  preload/
    index.ts          — contextBridge IPC API exposed to renderer
  renderer/           # React app
    App.tsx
    main.tsx
    styles.css
    diffWindow.ts                — diff popup (diff2html)
    store/
      agents.ts                  — zustand store (agent list + selected)
      settings.ts                — zustand store (settings, mirrored from main)
    components/
      AgentList.tsx              — left panel
      AgentCard.tsx              — per-agent row with status dot + context bar
      AgentDetail.tsx            — right panel header + terminal
      Terminal.tsx               — xterm.js wrapper, Ctrl+F search bar
      ShellTerminal.tsx          — generic shell terminal
      NewAgentDialog.tsx         — create agent modal
      ContextMenu.tsx            — right-click menu
      SettingsPanel.tsx          — settings modal
      SetupBanner.tsx            — first-run setup prompt
      GitLog.tsx                 — recent commits with shortstat
      SearchPage.tsx             — cross-agent terminal log search
      StatsPage.tsx              — token spend dashboard
      stats/
        SummaryCards.tsx         — top-level totals
        DailyChart.tsx           — usage by day
        AgentStatsPanel.tsx      — per-agent breakdown
        BreakdownPanel.tsx       — by model / by activity
  shared/
    types.ts          — Agent, AppState, AppSettings, StatusUpdate interfaces
```

## Dev
```bash
npm run dev    # electron-vite dev server with HMR (passes --no-sandbox)
npm run build  # production build to out/
npx electron . --no-sandbox    # run the built bundle without packaging
npm run dist:linux | dist:mac | dist:win    # electron-builder package
```

## Key behaviors
- Agents persist across restarts (state in `~/.config/multiagent/state.json`)
- On restart, agents show as stopped; click Restart → `claude --continue`
- Context/token/cost bar reads Claude's statusline JSON via named pipe
- Diff/file/line counts compare against the PR base; `getMergeBase` runs a throttled (5min TTL) `git fetch` per worktree so a stale local `origin/main` doesn't inflate counts
- Reset (checkout default + pull) and Restart (chat reset) both clear transient metrics — counts repopulate on the next 10s poll
- Terminal log writes are coalesced into one `fs.write` per 250ms window using a chunk array (avoids O(n²) string concat)
- Shared 16ms PTY flush tick drains output for the selected agent; background agents coalesced to 500ms
- Optional setting strips Claude's hardcoded 2-column left gutter from terminal output (off by default; only the rendered output is stripped, log files keep raw bytes)
- Theme is light: white bg `#ffffff`, slate fg `#1e293b`, JetBrains Mono / Fira Code
