---
date: 2026-04-06
topic: git-log-panel
---

# Git Log Panel per Agent

## Problem Frame

Users managing multiple agents see a changed-files count badge but have no visibility into *what* was committed on each agent's branch. Understanding agent progress requires opening a shell and running git log manually, which breaks the monitoring flow.

## Requirements

**Panel Layout**
- R1. Add a "Git Log" tab alongside the existing shell terminal in AgentDetail's bottom panel
- R2. User can switch between Shell and Git Log tabs; the active tab is visually indicated
- R3. The bottom panel's draggable divider and resize behavior work the same regardless of active tab

**Commit List**
- R4. Show the 10 most recent commits on the agent's worktree branch
- R5. Each commit row displays: short hash, commit message (truncated), relative time (e.g. "3m ago"), and number of files changed
- R6. The list refreshes on the same polling interval as the changed-files count (every 10s when the agent is selected)

**Diff Viewing**
- R7. Clicking a commit row opens a diff for that commit in an external browser tab, reusing the existing diff2html infrastructure

## Success Criteria

- User can see what an agent committed without leaving the app or opening a shell
- Clicking a commit shows a readable diff without additional setup

## Scope Boundaries

- No inline diff rendering inside the app
- No multi-commit selection or range diffs
- No commit actions (revert, cherry-pick, etc.)
- No git log for non-worktree agents (graceful no-op)

## Key Decisions

- **Tab in bottom panel** over separate panel or header section: avoids adding layout complexity, reuses existing resize infrastructure, user decides how much space to allocate
- **External browser for diffs** over inline: consistent with existing diff viewer, simpler implementation, better for large diffs
- **Same polling interval as changed-files**: avoids extra git load, data stays in sync

## Next Steps

-> `/ce:plan` for structured implementation planning
