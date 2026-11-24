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
} as const

/**
 * The start page's tab icons as the box has always shown them (home.page.ts: Ionicons book-outline,
 * musical-notes-outline, radio-outline - copied from ionicons/dist/svg, 512 × 512): the tabs look the same wherever
 * they are chosen
 */
export const ION_ICON = {
  book: '<path d="M256 160c16-63.16 76.43-95.41 208-96a15.94 15.94 0 0 1 16 16v288a16 16 0 0 1-16 16c-128 0-177.45 25.81-208 64-30.37-38-80-64-208-64-9.88 0-16-8.05-16-17.93V80a15.94 15.94 0 0 1 16-16c131.57.59 192 32.84 208 96M256 160v288" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/>',
  music:
    '<path d="M192 218v-6c0-14.84 10-27 24.24-30.59l174.59-46.68A20 20 0 0 1 416 154v22" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/><path d="M416 295.94v80c0 13.91-8.93 25.59-22 30l-22 8c-25.9 8.72-52-10.42-52-38h0a33.37 33.37 0 0 1 23-32l51-18.15c13.07-4.4 22-15.94 22-29.85V58a10 10 0 0 0-12.6-9.61L204 102a16.48 16.48 0 0 0-12 16v226c0 13.91-8.93 25.6-22 30l-52 18c-13.88 4.68-22 17.22-22 32h0c0 27.58 26.52 46.55 52 38l22-8c13.07-4.4 22-16.08 22-30v-80" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/>',
  radio:
    '<circle cx="256" cy="256.02" r="32"/><path d="M184.25 192.25a96 96 0 0 0 0 127.52M327.77 319.77a96 96 0 0 0 0-127.52M133.28 141.28a168 168 0 0 0 0 229.44M378.72 370.72a168 168 0 0 0 0-229.44" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/><path d="M435 416a240.34 240.34 0 0 0 0-320M77 96a240.34 240.34 0 0 0 0 320" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/>',
} as const

/** the tabs' signs (CATEGORY_LABEL's categories) - the start page's own (ION_ICON) */
export const CATEGORY_TILE: Record<string, string> = {
  audiobook: ION_ICON.book,
  music: ION_ICON.music,
  other: ION_ICON.radio,
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

/** one of the start page's icons (ION_ICON, 512 × 512) as a cover - as tilePicture, the same size of sign */
export function ionPicture(host: HTMLElement, icon: string, colours?: { bg: string; ink: string }): string {
  const st = getComputedStyle(host)
  const bg = (colours?.bg ?? (st.getPropertyValue('--srch-accent').trim() || '#3880ff')).replace(/"/g, '')
  const ink = (colours?.ink ?? (st.getPropertyValue('--km-ink').trim() || '#ffffff')).replace(/"/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${bg}"/><g transform="translate(128 128) scale(0.5)" fill="${ink}" stroke="${ink}">${icon}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
