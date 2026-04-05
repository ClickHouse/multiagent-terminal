import Store from 'electron-store'
import { AppSettings, DEFAULT_SETTINGS } from '../shared/types.js'

// @ts-ignore
const store = new Store<AppSettings>({ name: 'settings', defaults: DEFAULT_SETTINGS })

export function getSettings(): AppSettings {
  return {
    fontSize:     store.get('fontSize',     DEFAULT_SETTINGS.fontSize),
    devTools:     store.get('devTools',     DEFAULT_SETTINGS.devTools),
    resumeOnOpen: store.get('resumeOnOpen', DEFAULT_SETTINGS.resumeOnOpen),
  }
}

export function saveSettings(s: Partial<AppSettings>): AppSettings {
  if (s.fontSize     !== undefined) store.set('fontSize',     s.fontSize)
  if (s.devTools     !== undefined) store.set('devTools',     s.devTools)
  if (s.resumeOnOpen !== undefined) store.set('resumeOnOpen', s.resumeOnOpen)
  return getSettings()
}
