import { AsyncPipe, NgTemplateOutlet } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  ViewEncapsulation,
  viewChild,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NavigationExtras, Router } from '@angular/router'
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone'
import { addIcons } from 'ionicons'
import { arrowBackOutline, bookOutline, closeOutline, musicalNotesOutline, radioOutline } from 'ionicons/icons'
import { catchError, firstValueFrom, forkJoin, type Observable, of, take } from 'rxjs'
import Keyboard from 'simple-keyboard'
import { environment } from 'src/environments/environment'

import type { Artist } from '../artist'
import { ArtworkService } from '../artwork.service'
import { CoverFlipService } from '../cover-flip.service'
import { KmStatusGroupComponent } from '../km-header/km-status-group.component'
import type { CategoryType, Media } from '../media'
import { isStandaloneMedia, MediaService } from '../media.service'
import type { MupiboxConfig } from '../mupibox-config.model'
import { StatusComponent } from '../status/status.component'
import { KmThemeService } from '../theme/km-theme.service'
import { localizeCoverUrl } from '../utils'

// The search pool ("Nur in der Suche", backend search-pool.ts): allowed by the parents, not on the start page
// (podcast: an RSS feed, feedUrl instead of spotifyId - put on the start page only: its episodes come with it)
type PoolKind = 'artist' | 'album' | 'playlist' | 'show' | 'podcast'
interface PoolAlbum {
  id: string
  name: string
  cover: string
  release: string
}
interface PoolEntry {
  id: string
  kind: PoolKind
  spotifyId: string
  feedUrl?: string
  name: string
  artist: string
  cover: string
  albums?: PoolAlbum[]
}
// what the child put on the start page from the pool (it may take these out again)
interface OwnEntry {
  ident: string
  kind: string
  name: string
  artist: string
  cover: string
  category: string
}

/** as the backend knows a pool entry in the library (search-pool.ts poolIdent): "album:<id>", "podcast:<feed>" … */
function poolIdent(e: PoolEntry): string {
  return e.kind === 'podcast' ? `podcast:${(e.feedUrl ?? '').replace(/^https?:\/\//i, '')}` : `${e.kind}:${e.spotifyId}`
}

// One hit: an artist (opens its albums, as on the start page), an album / episode (plays, as in the album list) or
// something of the pool (opens the sheet: play it, or put it on the start page)
interface Hit {
  key: string
  name: string
  sub: string
  imgSrc: Observable<string>
  category: CategoryType
  artist?: Artist
  media?: Media
  pool?: PoolEntry
  poolAlbum?: PoolAlbum
  round: boolean
  rank: number
}

// The sheet of a pool hit: the entry (an artist: its albums), the album of it chosen, the tabs to choose from
interface Sheet {
  entry: PoolEntry
  album?: PoolAlbum
  // putting it on the start page: the tab is chosen now ('whole': the whole artist)
  choosing?: 'one' | 'whole'
  busy?: boolean
}

// The categories searched: those of the start page's tabs with entries of the library. NAS folders are left out
// (read live from the NAS, slow or asleep); those the parents put into a category are in it.
const SEARCHED: CategoryType[] = ['audiobook', 'music', 'other']
const CATEGORY_LABEL: Record<string, { label: string; icon: string }> = {
  audiobook: { label: 'Hörspiele', icon: 'book-outline' },
  music: { label: 'Musik', icon: 'musical-notes-outline' },
  other: { label: 'Radio', icon: 'radio-outline' },
}
const MAX_HITS = 40

/** lower case, ß as ss, without accents and umlaut dots: "Blümchen" is found with "blumchen" and "BLÜMCHEN" */
export function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * How well a name fits what was typed: 0 starts with it, 1 a word starts with the first typed word, 2 contains all
 * typed words, null not at all. Typed words are separated by blanks; each must be in the name.
 */
export function searchRank(name: string, query: string): number | null {
  const n = normalizeForSearch(name)
  const q = normalizeForSearch(query).trim()
  const words = q.split(/\s+/).filter(Boolean)
  if (!words.length || !words.every((w) => n.includes(w))) return null
  if (n.startsWith(q)) return 0
  if (n.split(/[^a-z0-9]+/).some((w) => w.startsWith(words[0]))) return 1
  return 2
}

@Component({
  selector: 'app-search',
  templateUrl: 'search.page.html',
  styleUrls: ['search.page.scss'],
  imports: [
    AsyncPipe,
    NgTemplateOutlet,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonFooter,
    KmStatusGroupComponent,
    StatusComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // (the keyboard draws its keys itself: its styles must reach them - all of them below app-search, see search.page.scss)
  encapsulation: ViewEncapsulation.None,
})
export class SearchPage implements AfterViewInit, OnDestroy {
  private readonly mediaService = inject(MediaService)
  private readonly artworkService = inject(ArtworkService)
  private readonly router = inject(Router)
  private readonly navController = inject(NavController)
  private readonly coverFlip = inject(CoverFlipService)
  private readonly http = inject(HttpClient)
  private readonly destroyRef = inject(DestroyRef)
  private readonly api = environment.backend.apiUrl

  protected readonly r2 = inject(KmThemeService).roundTwo
  private readonly keyboardHost = viewChild<ElementRef<HTMLElement>>('keyboard')
  private keyboard?: Keyboard

  protected readonly query = signal('')
  protected readonly keyboardShown = signal(true)
  protected readonly loading = signal(true)
  // the tabs shown on the start page (the ones a pool hit can go to)
  protected readonly categories = signal<CategoryType[]>([])
  private readonly artists = signal<{ category: CategoryType; artist: Artist }[]>([])
  private readonly media = signal<{ category: CategoryType; media: Media }[]>([])
  private readonly pool = signal<PoolEntry[]>([])
  protected readonly own = signal<OwnEntry[]>([])
  protected readonly sheet = signal<Sheet | null>(null)
  // the child's own entry tapped once: a second tap takes it out (a tap by mistake does nothing)
  protected readonly removing = signal<string | null>(null)
  protected readonly note = signal('')
  private noteTimer = 0
  // (the pool asked again while the page is open: allowed in the app meanwhile, it shows without leaving the search)
  private poolTimer = 0
  private entered = false
  private static readonly POOL_REFRESH_MS = 30_000

  protected readonly hits = computed<Hit[]>(() => {
    const q = this.query().trim()
    if (normalizeForSearch(q).replace(/\s/g, '').length < 2) return []
    const hits: Hit[] = []
    const seen = new Set<string>()
    for (const { category, artist } of this.artists()) {
      const rank = searchRank(artist.name, q)
      const key = `a|${category}|${artist.name}|${artist.coverMedia?.libraryPath ?? artist.coverMedia?.nasPath ?? ''}`
      if (rank === null || seen.has(key)) continue
      seen.add(key)
      hits.push({
        key,
        name: artist.name,
        sub: '',
        imgSrc: this.artworkService.getArtistArtwork(artist.coverMedia),
        category,
        artist,
        round: true,
        rank,
      })
    }
    // (what is on the start page already: not offered again from the pool)
    const inLibrary = new Set<string>()
    for (const { category, media } of this.media()) {
      if (media.id) inLibrary.add(`album:${media.id}`)
      if (media.playlistid) inLibrary.add(`playlist:${media.playlistid}`)
      // (playlists and stations without an artist are already hits of their own above; placeholders play nothing)
      if (isStandaloneMedia(media) || !media.title) continue
      if (media.unavailable && !media.id && !media.playlistid && !media.showid && !media.audiobookid) continue
      const rank = searchRank(media.title, q)
      const key = `m|${category}|${media.artist}|${media.title}|${media.id ?? media.libraryPath ?? media.nasPath ?? ''}`
      if (rank === null || seen.has(key)) continue
      seen.add(key)
      // (albums after artists of the same rank: a tap on the artist shows them all)
      hits.push({
        key,
        name: media.title,
        sub: media.artist ?? '',
        imgSrc: this.artworkService.getArtwork(media),
        category,
        media,
        round: false,
        rank: rank + 0.5,
      })
    }
    for (const o of this.own()) inLibrary.add(o.ident)
    // the pool: after the library's hits of the same rank
    const cover = (url: string) => of(localizeCoverUrl(url || undefined))
    for (const entry of this.pool()) {
      if (inLibrary.has(poolIdent(entry))) continue
      // (a playlist Spotify made itself, allowed before the app refused them: it would not play - the player waited)
      if (entry.kind === 'playlist' && /^37i9dQZF/.test(entry.spotifyId)) continue
      const rank = Math.min(searchRank(entry.name, q) ?? 9, entry.artist ? (searchRank(entry.artist, q) ?? 9) + 0.2 : 9)
      if (rank < 9) {
        hits.push({
          key: `p|${entry.id}`,
          name: entry.name,
          sub: entry.kind === 'artist' ? '' : entry.artist,
          imgSrc: cover(entry.cover),
          category: 'music',
          pool: entry,
          round: entry.kind === 'artist',
          rank: rank + 0.7,
        })
      }
      // an artist's albums by their own names (its name finds the artist: its albums are in its sheet)
      if (entry.kind === 'artist' && rank >= 9) {
        for (const album of entry.albums ?? []) {
          if (inLibrary.has(`album:${album.id}`)) continue
          const albumRank = searchRank(album.name, q)
          if (albumRank === null) continue
          hits.push({
            key: `p|${entry.id}|${album.id}`,
            name: album.name,
            sub: entry.name,
            imgSrc: cover(album.cover),
            category: 'music',
            pool: entry,
            poolAlbum: album,
            round: false,
            rank: albumRank + 0.8,
          })
        }
      }
    }
    return hits
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'de', { numeric: true }))
      .slice(0, MAX_HITS)
  })

  // "nothing found" only once something was typed and the library is there
  protected readonly nothingFound = computed(
    () => !this.loading() && this.query().trim().length >= 2 && this.hits().length === 0,
  )

  // the albums of the artist in the sheet (not those on the start page already)
  protected readonly sheetAlbums = computed(() => {
    const s = this.sheet()
    if (!s || s.entry.kind !== 'artist' || s.album) return []
    const have = new Set(this.media().map(({ media }) => media.id))
    return (s.entry.albums ?? [])
      .filter((a) => !have.has(a.id))
      .map((a) => ({ ...a, imgSrc: localizeCoverUrl(a.cover || undefined) }))
  })

  protected readonly categoryLabel = CATEGORY_LABEL
  protected readonly coverUrl = (url: string) => localizeCoverUrl(url || undefined)

  constructor() {
    addIcons({ arrowBackOutline, closeOutline, bookOutline, musicalNotesOutline, radioOutline })
    this.http
      .get<MupiboxConfig>(`${this.api}/config`)
      .pipe(
        catchError(() => of(undefined)),
        takeUntilDestroyed(),
      )
      .subscribe((config) => {
        const hidden = config?.mupibox?.hiddenCategories ?? []
        this.categories.set(SEARCHED.filter((c) => !hidden.includes(c)))
        this.loadLibrary()
      })
    this.poolTimer = window.setInterval(() => this.loadPool(), SearchPage.POOL_REFRESH_MS)
  }

  /**
   * Every time the page shows (the first time too): the pool and the child's own entries asked again - the page stays
   * in the navigation stack behind an album list or the player, and the parents may have allowed something meanwhile.
   * Coming back, the library too (the parents or the child may have changed it).
   */
  ionViewWillEnter(): void {
    this.loadPool()
    if (this.entered) this.loadLibrary()
    this.entered = true
  }

  // the library of the shown tabs (the lists the start page keeps: no new lookups at Spotify)
  private loadLibrary(): void {
    const categories = this.categories()
    if (!categories.length) {
      this.loading.set(false)
      return
    }
    // (one answer per category: its entries with the NAS folders of last time - a NAS asleep is not waited for;
    // the artists are grouped from them as on the start page)
    forkJoin(
      categories.map((category) =>
        this.mediaService.fetchMediaData(category).pipe(
          take(1),
          catchError(() => of([] as Media[])),
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lists) => {
          this.artists.set(
            lists.flatMap((list, i) =>
              this.mediaService.groupArtists(list).map((artist) => ({ category: categories[i], artist })),
            ),
          )
          this.media.set(lists.flatMap((list, i) => list.map((media) => ({ category: categories[i], media }))))
          this.loading.set(false)
        },
        error: () => this.loading.set(false),
      })
  }

  private loadPool(): void {
    this.http
      .get<{ entries: PoolEntry[] }>(`${this.api}/search-pool`)
      .pipe(
        catchError(() => of({ entries: [] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.pool.set(r?.entries ?? []))
    this.http
      .get<{ entries: OwnEntry[] }>(`${this.api}/search-pool/own`)
      .pipe(
        catchError(() => of({ entries: [] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.own.set(r?.entries ?? []))
  }

  ngAfterViewInit(): void {
    const host = this.keyboardHost()?.nativeElement
    if (!host) return
    this.keyboard = new Keyboard(host, {
      // capital letters: the ones children learn first (the search does not tell upper and lower case apart)
      layout: {
        default: [
          'Q W E R T Z U I O P Ü',
          'A S D F G H J K L Ö Ä',
          '{123} Y X C V B N M ß {bksp}',
          '{hide} {space} {clear}',
        ],
        digits: ['1 2 3 4 5 6 7 8 9 0', "- . , ! ? ' & ( ) :", '{abc} {bksp}', '{hide} {space} {clear}'],
      },
      layoutName: 'default',
      display: {
        '{bksp}': '⌫',
        '{space}': ' ',
        '{123}': '123',
        '{abc}': 'ABC',
        '{hide}': '▼',
        '{clear}': '✕',
      },
      theme: 'hg-theme-default mupi-search-keys',
      onChange: (input: string) => this.query.set(input),
      onKeyPress: (button: string) => this.keyPressed(button),
    })
  }

  ngOnDestroy(): void {
    this.keyboard?.destroy()
    window.clearTimeout(this.noteTimer)
    window.clearInterval(this.poolTimer)
  }

  private keyPressed(button: string): void {
    if (button === '{123}') this.keyboard?.setOptions({ layoutName: 'digits' })
    else if (button === '{abc}') this.keyboard?.setOptions({ layoutName: 'default' })
    else if (button === '{hide}') this.keyboardShown.set(false)
    else if (button === '{clear}') this.clear()
  }

  /** a tap on the field: the keyboard comes back */
  protected showKeyboard(): void {
    this.keyboardShown.set(true)
  }

  protected clear(): void {
    this.keyboard?.clearInput()
    this.query.set('')
    this.keyboardShown.set(true)
  }

  protected goBack(): void {
    this.navController.navigateRoot('/home', { animationDirection: 'back' })
  }

  protected hitClicked(hit: Hit): void {
    if (hit.pool) {
      this.sheet.set({ entry: hit.pool, album: hit.poolAlbum })
    } else if (hit.artist) {
      this.openArtist(hit.artist, hit.category)
    } else if (hit.media) {
      this.openMedia(hit.media)
    }
  }

  // ---------- the sheet of a pool hit ----------

  protected closeSheet(): void {
    this.sheet.set(null)
  }

  protected openPoolAlbum(album: PoolAlbum): void {
    const s = this.sheet()
    if (s) this.sheet.set({ entry: s.entry, album })
  }

  /** back from an album of the artist to the artist */
  protected sheetBack(): void {
    const s = this.sheet()
    if (!s) return
    if (s.choosing) this.sheet.set({ ...s, choosing: undefined })
    else if (s.album && s.entry.kind === 'artist') this.sheet.set({ entry: s.entry })
    else this.closeSheet()
  }

  protected choose(what: 'one' | 'whole'): void {
    const s = this.sheet()
    if (!s) return
    // only one tab: no question
    const cats = this.categories()
    if (cats.length === 1) {
      this.sheet.set({ ...s, choosing: what })
      void this.addTo(cats[0])
      return
    }
    this.sheet.set({ ...s, choosing: what })
  }

  /** play it from the search, without putting it on the start page */
  protected play(): void {
    const s = this.sheet()
    if (!s) return
    const e = s.entry
    const media: Media | undefined = s.album
      ? {
          type: 'spotify',
          category: 'music',
          id: s.album.id,
          title: s.album.name,
          artist: e.name,
          cover: s.album.cover,
        }
      : e.kind === 'album'
        ? {
            type: 'spotify',
            category: 'music',
            id: e.spotifyId,
            title: e.name,
            artist: e.artist || e.name,
            cover: e.cover,
          }
        : e.kind === 'playlist'
          ? { type: 'spotify', category: 'music', playlistid: e.spotifyId, title: e.name, cover: e.cover }
          : undefined
    if (!media) return
    this.closeSheet()
    void this.navController.navigateForward(['/player'], { state: { media }, animation: this.coverFlip.animation })
  }

  /** on the start page under the chosen tab: the album / playlist, or the whole artist */
  protected async addTo(category: CategoryType): Promise<void> {
    const s = this.sheet()
    if (!s || s.busy) return
    this.sheet.set({ ...s, busy: true })
    const albumId = s.choosing === 'whole' ? undefined : s.album?.id
    const name = s.choosing === 'whole' ? s.entry.name : (s.album?.name ?? s.entry.name)
    try {
      const r = await firstValueFrom(
        this.http.post<{ ok: boolean; result: 'added' | 'already' }>(`${this.api}/search-pool/add-to-library`, {
          poolId: s.entry.id,
          albumId,
          category,
        }),
      )
      this.closeSheet()
      this.showNote(
        r?.result === 'already'
          ? `${name} ist schon da.`
          : `${name} ist jetzt bei ${CATEGORY_LABEL[category]?.label ?? category}.`,
      )
      this.loadPool()
      // (the lists of the start page are made again with the library: the search's too, a moment later)
      window.setTimeout(() => this.loadLibrary(), 1500)
    } catch {
      this.sheet.set({ ...s, busy: false })
      this.showNote('Das hat nicht geklappt.')
    }
  }

  // ---------- the child's own entries ----------

  protected async removeOwn(o: OwnEntry): Promise<void> {
    if (this.removing() !== o.ident) {
      this.removing.set(o.ident)
      return
    }
    this.removing.set(null)
    try {
      await firstValueFrom(this.http.post(`${this.api}/search-pool/remove-own`, { ident: o.ident }))
      this.own.update((list) => list.filter((x) => x.ident !== o.ident))
      this.showNote(`${o.name} ist weg.`)
      window.setTimeout(() => this.loadLibrary(), 1500)
    } catch {
      this.showNote('Das hat nicht geklappt.')
    }
  }

  private showNote(text: string): void {
    this.note.set(text)
    window.clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => this.note.set(''), 4000)
  }

  // ---------- library hits ----------

  // as a tap on the start page (HomePage.artistCoverClicked)
  private openArtist(artist: Artist, category: CategoryType): void {
    const media = artist.coverMedia
    const playable =
      (media?.type === 'nas' && !media.nasIsContainer) ||
      (media?.type === 'library' && !!media.libraryPath && !media.libraryIsContainer) ||
      isStandaloneMedia(media)
    if (playable) {
      void this.navController.navigateForward(['/player'], { state: { media }, animation: this.coverFlip.animation })
      return
    }
    const navigationExtras: NavigationExtras = {
      state: { artist, category },
      queryParams:
        media?.type === 'nas' ? { nas: media.nasPath } : media?.libraryPath ? { lib: media.libraryPath } : undefined,
    }
    this.router.navigate(['/medialist'], navigationExtras)
  }

  // as a tap in the album list (MedialistPage.coverClicked): a folder opens its level, everything else plays
  private openMedia(media: Media): void {
    if (media.type === 'library' && media.libraryPath && media.libraryIsContainer) {
      this.router.navigate(['/medialist'], { queryParams: { lib: media.libraryPath } })
      return
    }
    if (media.type === 'nas' && media.nasIsContainer) {
      this.router.navigate(['/medialist'], { queryParams: { nas: media.nasPath } })
      return
    }
    void this.navController.navigateForward(['/player'], { state: { media }, animation: this.coverFlip.animation })
  }
}
