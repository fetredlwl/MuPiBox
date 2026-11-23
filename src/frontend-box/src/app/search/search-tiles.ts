// (fork "wishes") The search's tiles as covers of the start page's album list (mupi-swiper): a sign on the theme's
// colour, drawn as a picture - the search's start (its ways) and the album page (its buttons) are lists of covers like
// the start page and "Weiterhören", nothing of their own to draw.

/** the signs: the paths of a 24 × 24 icon, drawn as lines */
export const TILE_ICON = {
  play: '<path d="M8 5v14l11-7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M6 6l12 12M18 6 6 18"/>',
  move: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6"/>',
  radio:
    '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M7 9 17 4"/><circle cx="15.5" cy="15" r="2.5"/><path d="M6.5 13.5h3M6.5 16.5h3"/>',
} as const

/** the tabs' signs (CATEGORY_LABEL's categories) */
export const CATEGORY_TILE: Record<string, string> = {
  audiobook: TILE_ICON.book,
  music: TILE_ICON.music,
  other: TILE_ICON.radio,
}

/**
 * A sign as a cover: on the page's --srch-accent (km themes: their apricot) in --km-ink, or on the colours given (the
 * star's yellow, the tick's green)
 */
export function tilePicture(host: HTMLElement, icon: string, colours?: { bg: string; ink: string }): string {
  const st = getComputedStyle(host)
  const bg = (colours?.bg ?? (st.getPropertyValue('--srch-accent').trim() || '#3880ff')).replace(/"/g, '')
  const ink = (colours?.ink ?? (st.getPropertyValue('--km-ink').trim() || '#ffffff')).replace(/"/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${bg}"/><g transform="translate(6 6) scale(0.5)" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
