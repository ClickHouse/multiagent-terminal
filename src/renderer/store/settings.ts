import { create } from 'zustand'
import { AppSettings, DEFAULT_SETTINGS } from '../../shared/types'

interface SettingsState extends AppSettings {
  load: () => Promise<void>
  set: (patch: Partial<AppSettings>) => Promise<void>
}


export const useSettings = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,

  load: async () => {
    const s = await window.api.getSettings()
    set(s)
    // Listen for changes from other windows / main process.
    window.api.onSettingsChanged((updated: AppSettings) => set(updated))
  },

  set: async (patch) => {
    set(patch)  // optimistic
    await window.api.saveSettings(patch)
  },
}))
