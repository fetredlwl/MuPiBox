// (fork "wishes") The start page sorted by the child itself (app › Bedienung am Display › "Kind darf die Startseite
// sortieren"; off: A to Z as always): the order of each tab kept on the box (backend start-order.ts). New tiles - not in
// the order yet - stand in front; an album added to an artist already there keeps that tile where it is.
import { HttpClient } from '@angular/common/http'
import { inject, Injectable, signal } from '@angular/core'
import { environment } from 'src/environments/environment'
import type { Artist } from './artist'
import { isStandaloneMedia } from './media.service'

type Order = Partial<Record<string, string[]>>

/** what a tile of the start page is kept by: its artist, its folder, or the playlist / station standing alone */
export function tileKey(a: Artist): string {
  const m = a.coverMedia
  if (m && isStandaloneMedia(m)) return `${m.type}:${m.playlistid || m.id || a.name}`
  if (m?.type === 'nas' && m.nasPath) return `nas:${m.nasPath}`
  if (m?.libraryPath) return `lib:${m.libraryPath}`
  return `artist:${a.name}`
}

@Injectable({ providedIn: 'root' })
export class StartOrderService {
  private readonly http = inject(HttpClient)
  private readonly api = `${environment.backend.apiUrl}/start-order`
  /** the child may sort (the parents' switch) */
  readonly on = signal(false)
  readonly order = signal<Order>({})

  constructor() {
    this.load()
  }

  /** asked again (the start page shows: the parents may have switched it) */
  load(): void {
    this.http.get<{ on: boolean; order: Order }>(this.api).subscribe({
      next: (r) => {
        this.on.set(r?.on === true)
        this.order.set(r?.order ?? {})
      },
      error: () => {},
    })
  }

  /** the tiles of a tab in the child's order (A to Z when it has none, or may not sort) - new ones in front */
  apply(artists: Artist[], category: string): Artist[] {
    return this.applyBy(artists, category, tileKey)
  }

  /** a list in the child's order of it (the usual order without one) - those not in it in front; key: what each is kept by */
  applyBy<T>(list: T[], category: string, key: (item: T) => string): T[] {
    const keys = this.on() ? this.order()[category] : undefined
    if (!keys?.length) return list
    const at = new Map(keys.map((k, i) => [k, i]))
    const fresh = list.filter((a) => !at.has(key(a)))
    const known = list.filter((a) => at.has(key(a))).sort((x, y) => (at.get(key(x)) ?? 0) - (at.get(key(y)) ?? 0))
    return [...fresh, ...known]
  }

  /** one tile moved: the tab's order as shown now, kept */
  move(shown: Artist[], category: string, from: number, to: number): void {
    this.moveBy(shown, category, from, to, tileKey)
  }

  /** one of a list moved (the search's start: its tiles) - its order as shown now, kept */
  moveBy<T>(shown: T[], category: string, from: number, to: number, key: (item: T) => string): void {
    if (from === to || from < 0 || to < 0 || from >= shown.length || to >= shown.length) return
    const keys = shown.map(key)
    const [k] = keys.splice(from, 1)
    keys.splice(to, 0, k)
    this.order.update((o) => ({ ...o, [category]: keys }))
    this.http.post(this.api, { category, keys }).subscribe({ error: () => {} })
  }

  /** "A–Z": the tab's order forgotten */
  reset(category: string): void {
    this.order.update((o) => {
      const { [category]: _gone, ...rest } = o
      return rest
    })
    this.http.post(`${this.api}/reset`, { category }).subscribe({ error: () => {} })
  }
}
