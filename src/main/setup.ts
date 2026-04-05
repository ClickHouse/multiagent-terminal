import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'

const STATUSLINE_SCRIPT = `#!/bin/sh
# Installed by multiagent. Forwards Claude Code statusline JSON to
# the per-agent named pipe when running under multiagent supervision.
if [ -n "$MULTIAGENT_STATUS_PIPE" ] && [ -p "$MULTIAGENT_STATUS_PIPE" ]; then
    cat > "$MULTIAGENT_STATUS_PIPE"
fi
`

export function configDir(): string {
  // Use Electron's userData or fall back to ~/.config/multiagent
  try {
    return path.join(app.getPath('userData'))
  } catch {
    return path.join(os.homedir(), '.config', 'multiagent')
  }
}

export function pipesDir(): string {
  const dir = path.join(configDir(), 'pipes')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function agentPipePath(agentId: string): string {
  return path.join(pipesDir(), agentId)
}

export function ensureStatuslineScript(): string {
  const scriptPath = path.join(configDir(), 'statusline.sh')
  fs.mkdirSync(configDir(), { recursive: true })
  fs.writeFileSync(scriptPath, STATUSLINE_SCRIPT, { mode: 0o755 })
  return scriptPath
}

export function patchClaudeSettings(scriptPath: string): void {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch {
    // File doesn't exist or is invalid — start fresh.
  }
  if ('statusLine' in settings) return // already set, don't overwrite

  settings.statusLine = { type: 'command', command: scriptPath }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath + '.tmp', JSON.stringify(settings, null, 2))
  fs.renameSync(settingsPath + '.tmp', settingsPath)
}
