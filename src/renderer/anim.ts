import { useEffect } from 'react'

// Shared low-frequency driver for status decorations (card spinners, the "done"
// pulse).
//
// `animation: … infinite` ticks the renderer + compositor at the display refresh
// rate for as long as the element exists. With a card list of ~20 agents there
// is almost always at least one spinner or one unseen "done" badge on screen, so
// the app composited continuously: on a 120 Hz 4K panel that measured ~14% CPU in
// the main process, ~39% in the renderer and ~30% in the GPU process while the
// terminals were pushing 0.3 KB/s (i.e. no real work at all).
//
// Instead, one timer writes CSS custom properties at 10 Hz and every decoration
// reads them. Idle decoration cost is 10 frames/s no matter how many agents are
// visible, and exactly zero when nothing is animating.

const TICK_MS = 100
const SPIN_STEPS = 8 // 45° per tick — reads as a deliberate stepped spinner
const PULSE_PERIOD_MS = 1800

let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null
let step = 0

function apply(): void {
  const root = document.documentElement.style
  root.setProperty('--spin-deg', `${(step % SPIN_STEPS) * (360 / SPIN_STEPS)}deg`)
  const phase = ((step * TICK_MS) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS
  const op = 1 - 0.45 * (1 - Math.cos(phase * 2 * Math.PI)) / 2
  root.setProperty('--pulse-op', op.toFixed(3))
}

/**
 * Keep `--spin-deg` / `--pulse-op` advancing while this component needs them.
 * Pass `false` when the component currently shows no animated decoration.
 */
export function useStatusAnimation(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    subscribers++
    if (!timer) {
      apply()
      timer = setInterval(() => { step++; apply() }, TICK_MS)
    }
    return () => {
      subscribers--
      if (subscribers === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [enabled])
}
