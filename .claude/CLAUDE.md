# multiagent

Electron desktop app for managing multiple Claude Code agents in parallel. Each agent gets its own git worktree and xterm.js terminal running `claude --dangerously-skip-permissions`.

## Stack
- **Electron** (main process) + **React + TypeScript** (renderer) + **Vite** build
- **node-pty** — PTY management for claude sessions
- **xterm.js** — terminal emulation in the renderer
- **zustand** — renderer state
- **electron-store** — JSON persistence
- **simple-git** — git worktree operations

## Project structure
```
src/
  main/         # Electron main process (Node.js)
    index.ts        — window + IPC handlers
    agentManager.ts — node-pty spawn/kill/resize
    worktree.ts     — git worktree add/remove
    state.ts        — electron-store persistence
    statusPipe.ts   — named pipe reader for Claude statusline JSON
    setup.ts        — statusline.sh installer
  preload/
    index.ts    — contextBridge IPC API exposed to renderer
  renderer/     — React app
    App.tsx
    store/agents.ts         — zustand store
    components/
      AgentList.tsx         — left panel
      AgentCard.tsx         — per-agent row with status dot + context bar
      AgentDetail.tsx       — right panel header + terminal
      Terminal.tsx          — xterm.js wrapper
      NewAgentDialog.tsx    — create agent modal
      ContextMenu.tsx       — right-click menu
  shared/
    types.ts    — Agent, AppState, StatusUpdate interfaces
```

## Dev
```bash
npm run dev    # starts electron-vite dev server with HMR
npm run build  # production build to out/
```

## Key behaviors
- Agents persist across restarts (state in `~/.config/multiagent/state.json`)
- On restart, agents show as stopped; click Restart → `claude --continue`
- Context/token bar reads from Claude's statusline JSON via named pipe
- Theme matches Terminator: cream `#fffbec` bg, dark `#3d3846` text, Ubuntu Mono
