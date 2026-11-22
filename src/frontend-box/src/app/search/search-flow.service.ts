import { HttpClient } from '@angular/common/http'
import { Injectable, inject, signal } from '@angular/core'
import { NavController } from '@ionic/angular/standalone'
import { firstValueFrom } from 'rxjs'
import { environment } from 'src/environments/environment'
import { CoverFlipService } from '../cover-flip.service'
import { type DisplayTextKey, DisplayTextsService } from '../display-texts.service'
import type { CategoryType, Media } from '../media'
import { SpotifyBlockService } from '../spotify-block.service'

// (fork "wishes") What the search, its artist page and its album page share: the pool's kinds, playing something of
// the pool, putting it on the start page, and the note the search shows when it is back on top.

// (radio: a station for children of the search's radio, search-radio.ts - its stream in feedUrl; never in the pool)
export type PoolKind = 'artist' | 'album' | 'playlist' | 'show' | 'podcast' | 'radio'

export interface PoolAlbum {
  id: string
  name: string
  cover: string
  release?: string
}

export interface PoolEntry {
  id: string
  kind: PoolKind
  spotifyId: string
  feedUrl?: string
  name: string
  artist: string
  cover: string
  albums?: PoolAlbum[]
  albumsAt?: string
}

/** a podcast for children from the directories (search-podcasts.ts): put on the start page by the child, no approval */
export interface KidsPodcast {
  feedUrl: string
  title: string
  author: string
  image: string
  episodes: number
}

/** (the id a kids podcast has as an entry of the search's pages - it is no entry of the pool) */
export const KIDS_PODCAST = 'kids-podcast'

export const kidsPodcastEntry = (p: KidsPodcast): PoolEntry => ({
  id: KIDS_PODCAST,
  kind: 'podcast',
  spotifyId: '',
  feedUrl: p.feedUrl,
  name: p.title,
  artist: p.author,
  cover: p.image,
})

/** a radio station for children (search-radio.ts): put on the start page by the child, no approval */
export interface KidsStation {
  url: string
  name: string
  image: string
  country: string
}

/** (the id a kids radio station has as an entry of the search's pages - it is no entry of the pool) */
export const KIDS_RADIO = 'kids-radio'

export const kidsRadioEntry = (s: KidsStation): PoolEntry => ({
  id: KIDS_RADIO,
  kind: 'radio',
  spotifyId: '',
  feedUrl: s.url,
  name: s.name,
  artist: '',
  cover: s.image,
})

/** what the child put on the start page itself (backend search-pool.ts own): "Einträge verwalten" */
export interface OwnEntry {
  ident: string
  kind: string
  name: string
  artist: string
  cover: string
  category: string
}

/** (fork "wishes") something on Spotify the child may wish (backend wishes.ts) */
export type WishKind = 'album' | 'artist' | 'show'
export interface WishItem {
  kind: WishKind
  id: string
  name: string
  artist: string
  cover: string
}
/** the pages of a search or of an artist's albums loaded so far (kept on the display: back and again ask nothing) */
export interface WishPages {
  items: WishItem[]
  more: boolean
  next: number
}

/** the names of the tabs in the box's language (display-texts.json) and their icons */
export const CATEGORY_LABEL: Record<string, { label: DisplayTextKey; icon: string }> = {
  audiobook: { label: 'searchCatAudiobook', icon: 'book-outline' },
  music: { label: 'searchCatMusic', icon: 'musical-notes-outline' },
  other: { label: 'searchCatRadio', icon: 'radio-outline' },
}

@Injectable({ providedIn: 'root' })
export class SearchFlowService {
  private readonly http = inject(HttpClient)
  private readonly navController = inject(NavController)
  private readonly coverFlip = inject(CoverFlipService)
  private readonly texts = inject(DisplayTextsService)
  private readonly spotifyBlock = inject(SpotifyBlockService)
  private readonly api = environment.backend.apiUrl

  /** the tabs a pool hit can go to (those shown on the start page; set by the search) */
  readonly categories = signal<CategoryType[]>([])
  /** the search pool (set by the search): something found on Spotify that is allowed is fetched, not wished */
  readonly pool = signal<PoolEntry[]>([])
  /** the open wishes ("kind:id"): marked "gewünscht", not wished again */
  readonly wished = signal<Set<string>>(new Set())
  // the pages loaded on this display (a search by its text, an artist by its id) - kept until the display reloads
  private readonly searchPages = new Map<string, WishPages>()
  private readonly artistPages = new Map<string, WishPages>()
  private readonly asking = new Set<string>()
  /** what the search says when it is shown again (added, already there, failed) */
  private note = ''
  /** the library changed (something was put on the start page): the search reads it again */
  private changed = false
  /** the search opened its artist or album page: coming back from there nothing is read again unless it changed */
  private ownPage = false

  /** the search goes to its artist or album page */
  openedOwnPage(): void {
    this.ownPage = true
  }

  // ---------- wishes from Spotify (backend wishes.ts) ----------

  /** the open wishes, from the box (no request to Spotify) */
  loadWished(): void {
    this.http.get<{ wishes: { kind: string; id: string }[] }>(`${this.api}/wishes/mine`).subscribe({
      next: (r) => this.wished.set(new Set((r?.wishes ?? []).map((w) => `${w.kind}:${w.id}`))),
      error: () => {},
    })
  }

  /**
   * Something found on Spotify that the parents allowed already (in the pool - an approved wish too): its page of the
   * pool, where the child fetches it itself. An album of an allowed artist too.
   */
  poolFor(w: WishItem): { entry: PoolEntry; album?: PoolAlbum } | undefined {
    const pool = this.pool()
    const entry = pool.find((e) => e.kind === w.kind && e.spotifyId === w.id)
    if (entry) return { entry }
    if (w.kind !== 'album') return undefined
    for (const e of pool) {
      const album = e.kind === 'artist' ? e.albums?.find((a) => a.id === w.id) : undefined
      if (album) return { entry: e, album }
    }
    return undefined
  }

  /** the pages of a search loaded so far, without asking (undefined: none yet) */
  searchKept(q: string): WishPages | undefined {
    return this.searchPages.get(q)
  }

  artistKept(id: string): WishPages | undefined {
    return this.artistPages.get(id)
  }

  /**
   * The first page of a search, or the next one (more): asked of the box only when not loaded on this display; the box
   * keeps each page a day. 'blocked': Spotify blocks the catalog now (nothing was asked).
   */
  searchWishes(q: string, more = false): Promise<WishPages | 'blocked' | 'failed'> {
    return this.pages(this.searchPages, `s|${q}`, q, more, (offset) => ({
      url: `${this.api}/wishes/search`,
      params: { q, offset },
    }))
  }

  artistWishes(id: string, more = false): Promise<WishPages | 'blocked' | 'failed'> {
    return this.pages(this.artistPages, `a|${id}`, id, more, (offset) => ({
      url: `${this.api}/wishes/artist`,
      params: { id, offset },
    }))
  }

  private async pages(
    kept: Map<string, WishPages>,
    lock: string,
    key: string,
    more: boolean,
    request: (offset: number) => { url: string; params: Record<string, string | number> },
  ): Promise<WishPages | 'blocked' | 'failed'> {
    const have = kept.get(key)
    if (have && !more) return have
    if (have && !have.more) return have
    if (this.asking.has(lock)) return have ?? 'failed'
    if (this.spotifyBlock.catalog()) return 'blocked'
    const offset = have?.next ?? 0
    this.asking.add(lock)
    try {
      const { url, params } = request(offset)
      const r = await firstValueFrom(this.http.get<{ items: WishItem[]; more: boolean }>(url, { params }))
      const pages = { items: [...(have?.items ?? []), ...(r?.items ?? [])], more: r?.more === true, next: offset + 10 }
      kept.set(key, pages)
      return pages
    } catch (err) {
      const blocked = (err as { error?: { error?: string } })?.error?.error === 'spotify_blocked'
      if (blocked) void this.spotifyBlock.refresh()
      return blocked ? 'blocked' : 'failed'
    } finally {
      this.asking.delete(lock)
    }
  }

  /** the child wishes it for a tab: the box tells the parents; back to the search, which says it was sent */
  async wish(item: WishItem, category: CategoryType): Promise<void> {
    try {
      const r = await firstValueFrom(
        this.http.post<{ ok: boolean; result: 'wished' | 'already' | 'there' | 'allowed' }>(`${this.api}/wishes`, {
          kind: item.kind,
          id: item.id,
          category,
        }),
      )
      this.note =
        r?.result === 'there'
          ? this.texts.text('wishThere', { n: item.name })
          : r?.result === 'allowed'
            ? this.texts.text('wishAllowed', { n: item.name })
            : r?.result === 'already'
              ? this.texts.text('wishAlready', { n: item.name })
              : this.texts.text('wishSent', { n: item.name })
      if (r?.result !== 'allowed') this.wished.update((s) => new Set([...s, `${item.kind}:${item.id}`]))
    } catch {
      this.note = this.texts.text('searchFailed')
    }
    void this.navController.navigateBack(['/search'])
  }

  catLabel(category: string): string {
    const key = CATEGORY_LABEL[category]?.label
    return key ? this.texts.text(key) : ''
  }

  /** the note and whether the library changed, once (the search reads them when it is shown again) */
  takeNote(): { note: string; changed: boolean; fromOwnPage: boolean } {
    const out = { note: this.note, changed: this.changed, fromOwnPage: this.ownPage }
    this.note = ''
    this.changed = false
    this.ownPage = false
    return out
  }

  /** whether it can be played from the search (an album, a playlist; podcasts and shows go on the start page only) */
  playable(entry: PoolEntry, album?: PoolAlbum): boolean {
    return !!album || entry.kind === 'album' || entry.kind === 'playlist'
  }

  /** play it from the search, without putting it on the start page */
  play(entry: PoolEntry, album?: PoolAlbum): void {
    if (this.spotifyBlock.player()) {
      this.spotifyBlock.tell()
      return
    }
    const media: Media | undefined = album
      ? { type: 'spotify', category: 'music', id: album.id, title: album.name, artist: entry.name, cover: album.cover }
      : entry.kind === 'album'
        ? {
            type: 'spotify',
            category: 'music',
            id: entry.spotifyId,
            title: entry.name,
            artist: entry.artist || entry.name,
            cover: entry.cover,
          }
        : entry.kind === 'playlist'
          ? { type: 'spotify', category: 'music', playlistid: entry.spotifyId, title: entry.name, cover: entry.cover }
          : undefined
    if (!media) return
    void this.navController.navigateForward(['/player'], { state: { media }, animation: this.coverFlip.animation })
  }

  /**
   * On the start page under the tab (album: one album of the artist; none: the entry, a whole artist too), then back
   * to the search, which tells what happened.
   */
  async addTo(entry: PoolEntry, category: CategoryType, album?: PoolAlbum): Promise<void> {
    const name = album?.name ?? entry.name
    try {
      // (a podcast or a radio station for children found by the search: its own way in, only what it handed out)
      const r = await firstValueFrom(
        entry.id === KIDS_PODCAST
          ? this.http.post<{ ok: boolean; result: 'added' | 'already' }>(`${this.api}/search-podcasts/add`, {
              feedUrl: entry.feedUrl,
              category,
            })
          : entry.id === KIDS_RADIO
            ? this.http.post<{ ok: boolean; result: 'added' | 'already' }>(`${this.api}/search-radio/add`, {
                url: entry.feedUrl,
                category,
              })
            : this.http.post<{ ok: boolean; result: 'added' | 'already' }>(`${this.api}/search-pool/add-to-library`, {
                poolId: entry.id,
                albumId: album?.id,
                category,
              }),
      )
      this.note =
        r?.result === 'already'
          ? this.texts.text('searchAlready', { n: name })
          : this.texts.text('searchAdded', { n: name, c: this.catLabel(category) })
      this.changed = true
    } catch {
      this.note = this.texts.text('searchFailed')
    }
    void this.navController.navigateBack(['/search'])
  }

  // ---------- "Einträge verwalten": what the child put on the start page itself ----------

  /** under another tab, then back to the search, which tells it */
  async moveOwn(own: OwnEntry, category: CategoryType): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.api}/search-pool/move-own`, { ident: own.ident, category }))
      this.note = this.texts.text('searchAdded', { n: own.name, c: this.catLabel(category) })
      this.changed = true
    } catch {
      this.note = this.texts.text('searchFailed')
    }
    void this.navController.navigateBack(['/search'])
  }

  /** off the start page, then back to the search, which tells it */
  async removeOwn(own: OwnEntry): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.api}/search-pool/remove-own`, { ident: own.ident }))
      this.note = this.texts.text('searchGone', { n: own.name })
      this.changed = true
    } catch {
      this.note = this.texts.text('searchFailed')
    }
    void this.navController.navigateBack(['/search'])
  }
}
