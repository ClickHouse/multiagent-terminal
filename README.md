# multiagent-terminal

Run multiple Claude Code agents in parallel. Each agent gets its own git worktree, terminal, and status tracking.

---

![screenshot](screenshot.png)

## Why

Claude Code is powerful but single-threaded. You wait for one task to finish before starting the next. This app lets you run 5, 10, 20 agents at once --- each in an isolated worktree, each with its own terminal, each tracked in real time.

## Features

- **No flickering** --- unlike raw Claude Code terminal, the UI never flickers or redraws
- **Scroll-safe** --- reading history while agent outputs? Viewport stays put, no scroll hijacking
- **Session persistence** --- agents resume where they left off after app restart via `--continue`
- **Parallel agents** --- spawn unlimited Claude sessions, each in its own git worktree
- **Git worktrees** --- full isolation between agents, no branch conflicts, clean parallel work
- **Live status** --- thinking/working/done detection via PTY output analysis and named pipes
- **Notifications** --- system alerts + green/yellow card highlights when agents finish or are working
- **Terminal per agent** --- full xterm.js with GPU acceleration, scrollback, and bracketed paste
- **Git-aware** --- branch display, file count, line stats (+/-), PR detection, diff viewer
- **Shell tab** --- auxiliary terminal per agent for manual git/shell commands
- **Git log** --- commit history with stats, click to view individual diffs
- **Cross-platform** --- Linux, macOS, Windows (named pipes adapt per OS)

## Install

```bash
git clone https://github.com/ClickHouse/multiagent-terminal.git
cd multiagent-terminal
npm install
```

### Requirements

The app checks these on startup and won't launch without them:

| Command | What for |
|---------|----------|
| `git` | Worktree creation, diff, log |
| `gh` | PR detection, open in browser |
| `claude` | The agents themselves |
| `claude auth` | Must be authenticated |

## Dev

```bash
npm run dev      # electron-vite dev server with HMR
npm run build    # production build to out/
```

## How it works

### Each agent is isolated

```
your-repo/                    # base repository
your-repo-agent-1/            # worktree for agent 1
your-repo-agent-2/            # worktree for agent 2
your-repo-fix-auth/           # worktree for agent 3
```

Agents don't interfere with each other. Each gets a branch, a working directory, and a Claude process.

### Status detection

The status state machine tracks what each agent is doing without polling Claude:

```
idle ---(Enter)--> thinking ---(200B output)--> working ---(3s silence)--> idle
                       |                                                    ^
                       +-----------(60s timeout)----------------------------+
```

A named pipe (`mkfifo` on Unix, `\\.\pipe\` on Windows) receives JSON status updates from Claude's statusline, providing model name, context usage, and cost.

### What you see

| State | Card | Border | Badge |
|-------|------|--------|-------|
| **Idle** | Default | Blue (if selected) | --- |
| **Thinking/Working** | Amber tint | Amber | `working` / `thinking` |
| **Done** | Green tint | Green | `done 12s` |
| **Error/Stopped** | Default | --- | `error` / `stopped` |

Done cards stay green until you click them. The selected card flashes green briefly then fades back. Active cards glow amber. Everything is instant --- no transition animations.

## Stack

| Layer | Tech |
|-------|------|
| App shell | Electron |
| UI | React + TypeScript |
| Build | electron-vite (Vite) |
| Terminal | xterm.js + WebGL addon |
| State | Zustand |
| Persistence | electron-store |
| Git | simple-git |
| PTY | node-pty |
| Diff | diff2html |

## Project structure

```
src/
  main/              # Electron main process
    index.ts           IPC handlers, agent lifecycle, git ops
    agentManager.ts    PTY spawn/kill, status state machine
    statusPipe.ts      Named pipe reader (cross-platform)
    worktree.ts        Git worktree add/remove
    setup.ts           Statusline script installer
    settings.ts        Persistent settings
    state.ts           Agent state persistence
  preload/
    index.ts           Context bridge API
  renderer/            # React app
    App.tsx
    store/agents.ts      Zustand agent store
    store/settings.ts    Zustand settings store
    components/
      AgentList.tsx        Sidebar with drag-reorder
      AgentCard.tsx        Status card with highlights
      AgentDetail.tsx      Header + terminal + tabs
      Terminal.tsx          xterm.js wrapper
      ShellTerminal.tsx    Auxiliary shell
      GitLog.tsx           Commit history viewer
      NewAgentDialog.tsx   Create/clone dialog
      SettingsPanel.tsx    Settings modal
      ContextMenu.tsx      Right-click menu
  shared/
    types.ts           Agent, Settings, StatusUpdate types
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Font size | 13 | Terminal font size |
| Scroll speed | 3 | Scroll sensitivity (Alt = 3x) |
| Max lines | 5000 | Terminal scrollback buffer |
| `--dangerously-skip-permissions` | On | Disable to make Claude prompt for tool permissions |
| System notifications | Off | Alert when agent finishes |
| DevTools | Off | Chrome DevTools on startup |

## License

Apache 2.0 — see [LICENSE.md](LICENSE.md).
