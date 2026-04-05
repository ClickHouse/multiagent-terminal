/** Replace /home/username/... with ~/... for display. */
export function squashHome(p: string): string {
  if (!p) return p
  return p.replace(/^\/home\/[^/]+\//, '~/').replace(/^\/home\/[^/]+$/, '~')
}
