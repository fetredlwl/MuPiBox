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

export type PoolKind = 'artist' | 'album' | 'playlist' | 'show' | 'podcast'

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
      const r = await firstValueFrom(
        this.http.post<{ ok: boolean; result: 'added' | 'already' }>(`${this.api}/search-pool/add-to-library`, {
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
}
