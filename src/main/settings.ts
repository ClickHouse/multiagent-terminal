import Store from 'electron-store'
import { AppSettings, DEFAULT_SETTINGS } from '../shared/types.js'

// @ts-ignore
const store = new Store<AppSettings>({ name: 'settings', defaults: DEFAULT_SETTINGS })

export function getSettings(): AppSettings {
  return {
    defaultCli:   store.get('defaultCli',   DEFAULT_SETTINGS.defaultCli),
    fontSize:     store.get('fontSize',     DEFAULT_SETTINGS.fontSize),
    scrollSpeed:  store.get('scrollSpeed',  DEFAULT_SETTINGS.scrollSpeed),
    scrollback:   store.get('scrollback',   DEFAULT_SETTINGS.scrollback),
    skipPermissions: store.get('skipPermissions', DEFAULT_SETTINGS.skipPermissions),
    devTools:     store.get('devTools',     DEFAULT_SETTINGS.devTools),
    resumeOnOpen: store.get('resumeOnOpen', DEFAULT_SETTINGS.resumeOnOpen),
    notifications: store.get('notifications', DEFAULT_SETTINGS.notifications),
    brightAgents:  store.get('brightAgents',  DEFAULT_SETTINGS.brightAgents),
  }
}

export function saveSettings(s: Partial<AppSettings>): AppSettings {
  if (s.defaultCli   !== undefined) store.set('defaultCli',   s.defaultCli)
  if (s.fontSize     !== undefined) store.set('fontSize',     s.fontSize)
  if (s.scrollSpeed  !== undefined) store.set('scrollSpeed',  s.scrollSpeed)
  if (s.scrollback   !== undefined) store.set('scrollback',   s.scrollback)
  if (s.skipPermissions !== undefined) store.set('skipPermissions', s.skipPermissions)
  if (s.devTools     !== undefined) store.set('devTools',     s.devTools)
  if (s.resumeOnOpen !== undefined) store.set('resumeOnOpen', s.resumeOnOpen)
  if (s.notifications !== undefined) store.set('notifications', s.notifications)
  if (s.brightAgents !== undefined) store.set('brightAgents', s.brightAgents)
  return getSettings()
}
