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
import { type DisplayTextKey, DisplayTextsService } from '../display-texts.service'
import { KmStatusGroupComponent } from '../km-header/km-status-group.component'
import type { CategoryType, Media } from '../media'
import { isStandaloneMedia, MediaService } from '../media.service'
import type { MupiboxConfig } from '../mupibox-config.model'
import { PlayerService } from '../player.service'
import { SpotifyBlockService } from '../spotify-block.service'
import { StatusComponent } from '../status/status.component'
import { KmThemeService } from '../theme/km-theme.service'
import { localizeCoverUrl } from '../utils'
import { NearEndDirective } from './near-end.directive'
import {
  CATEGORY_LABEL,
  type KidsPodcast,
  type KidsStation,
  kidsPodcastEntry,
  kidsRadioEntry,
  type OwnEntry,
  type PoolAlbum,
  type PoolEntry,
  SearchFlowService,
  type WishItem,
} from './search-flow.service'

// The search pool ("Nur in der Suche", backend search-pool.ts): allowed by the parents, not on the start page
// (podcast: an RSS feed, feedUrl instead of spotifyId - put on the start page only: its episodes come with it) - its
// types, playing and putting on the start page: SearchFlowService (shared with the artist and album page)

// (fork "wishes") Where the search looks - the tiles of its start: the child's own entries ("Einträge verwalten"),
// Spotify (wishes), podcasts and radio for children. Typed without a tile: the box's library and the pool, the tiles
// after the hits (each asks for the typed text when tapped).
type SearchMode = 'own' | 'spotify' | 'podcasts' | 'radio'
// (the word in the search field: where it looks)
// (the tiles' names at the start)
const WAY_LABEL: Record<SearchMode, DisplayTextKey> = {
  own: 'searchManageTile',
  spotify: 'wishSearchTile',
  podcasts: 'searchPodcastsButton',
  radio: 'searchRadioButton',
}
const MODE_LABEL: Record<SearchMode, DisplayTextKey> = {
  own: 'searchMine',
  spotify: 'searchSpotify',
  podcasts: 'searchPodcastsButton',
  radio: 'searchRadioButton',
}

/** a podcast's feed as the backend compares it (search-pool.ts feedKey): without http(s):// */
const feedKey = (feed: string) => feed.replace(/^https?:\/\//i, '')

/** as the backend knows a pool entry in the library (search-pool.ts poolIdent): "album:<id>", "podcast:<feed>" … */
function poolIdent(e: PoolEntry): string {
  return e.kind === 'podcast' ? `podcast:${(e.feedUrl ?? '').replace(/^https?:\/\//i, '')}` : `${e.kind}:${e.spotifyId}`
}

// One hit: an artist (opens its albums, as on the start page), an album / episode (plays, as in the album list) or
// something of the pool (opens its own page: play it, or put it on the start page)
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

// The categories searched: those of the start page's tabs with entries of the library. NAS folders are left out
// (read live from the NAS, slow or asleep); those the parents put into a category are in it.
const SEARCHED: CategoryType[] = ['audiobook', 'music', 'other']
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
    NearEndDirective,
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
  // (the texts in the box's language; Spotify's block: its note, Spotify hits grey while it does not play)
  protected readonly texts = inject(DisplayTextsService)
  protected readonly spotifyBlock = inject(SpotifyBlockService)

  protected readonly r2 = inject(KmThemeService).roundTwo
  private readonly keyboardHost = viewChild<ElementRef<HTMLElement>>('keyboard')
  private keyboard?: Keyboard

  protected readonly query = signal('')
  /** typed enough to search (2 letters) */
  protected readonly typed = computed(() => normalizeForSearch(this.query()).trim().length >= 2)
  // (the keyboard comes when the field is tapped - the page starts with the tiles)
  protected readonly keyboardShown = signal(false)
  /** the tile chosen at the start: the search looks only there (none: the box's library and the pool) */
  protected readonly mode = signal<SearchMode | null>(null)
  protected readonly modeLabel = MODE_LABEL
  // a tile's name read aloud (its bar lights up meanwhile, as the start page's names)
  private readonly player = inject(PlayerService)
  protected readonly speaking = signal<SearchMode | null>(null)
  private speakingTimer = 0
  protected readonly loading = signal(true)
  // the tabs shown on the start page (the ones a pool hit can go to)
  protected readonly categories = signal<CategoryType[]>([])
  private readonly artists = signal<{ category: CategoryType; artist: Artist }[]>([])
  private readonly media = signal<{ category: CategoryType; media: Media }[]>([])
  private readonly pool = signal<PoolEntry[]>([])
  protected readonly own = signal<OwnEntry[]>([])
  /** "Einträge verwalten": the child's own, those fitting the typed text */
  protected readonly ownShown = computed(() => {
    const q = this.query().trim()
    if (!this.typed()) return this.own()
    return this.own().filter((o) => searchRank(o.name, q) !== null || (!!o.artist && searchRank(o.artist, q) !== null))
  })
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
      // an artist's albums by their own names (its name finds the artist: its albums are on its page)
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
  // ---------- podcasts for children (Apple's directory / the ARD Audiothek, search-podcasts.ts) ----------
  // switched on in the app (Bedienung › Suche); asked only when the child taps the tile, for the text typed then
  protected readonly podcastsOn = signal(false)
  private readonly podFor = signal('')
  private readonly podHits = signal<KidsPodcast[]>([])
  protected readonly podBusy = signal(false)
  // the tips before anything is typed ("Tipps für Kinder", the app's suggestions - asked when the tile "Podcasts" is
  // first chosen in a visit of the search, the backend asks Apple / the ARD every 6 hours at the soonest)
  private readonly tips = signal<KidsPodcast[] | null>(null)
  protected readonly tipsShown = computed(() =>
    this.podcastsOn() ? (this.tips() ?? []).filter((p) => !this.onBox().has(feedKey(p.feedUrl))) : [],
  )
  /** the podcasts on the box already (their feeds): not offered again - the library's and the child's own */
  private readonly onBox = computed(() => {
    const feeds = new Set<string>()
    for (const { media } of this.media()) if (media.type === 'rss' && media.id) feeds.add(feedKey(media.id))
    for (const o of this.own()) if (o.ident.startsWith('podcast:')) feeds.add(o.ident.slice('podcast:'.length))
    return feeds
  })
  /** the radio stations on the box already (their streams): not offered again */
  private readonly radioOnBox = computed(() => {
    const streams = new Set<string>()
    for (const { media } of this.media()) if (media.type === 'radio' && media.id) streams.add(feedKey(media.id))
    for (const o of this.own()) if (o.ident.startsWith('radio:')) streams.add(o.ident.slice('radio:'.length))
    return streams
  })
  /** the podcasts found for the text as it is now (another text: the tile again) */
  protected readonly podShown = computed(() =>
    this.podFor() && this.podFor() === normalizeForSearch(this.query()).trim()
      ? this.podHits().filter((p) => !this.onBox().has(feedKey(p.feedUrl)))
      : null,
  )

  // ---------- radio for children (radio-browser.info, search-radio.ts) ----------
  // switched on in the app (Bedienung › Suche); asked only when the child asks, for the text typed then; the tips (the
  // app's "Kinderradio") when the tile "Radio" is first chosen in a visit
  protected readonly radioOn = signal(false)
  private readonly radioFor = signal('')
  private readonly radioHits = signal<KidsStation[]>([])
  protected readonly radioBusy = signal(false)
  private readonly radioTips = signal<KidsStation[] | null>(null)
  protected readonly radioTipsShown = computed(() =>
    (this.radioTips() ?? []).filter((s) => !this.radioOnBox().has(feedKey(s.url))),
  )
  protected readonly radioShown = computed(() =>
    this.radioFor() && this.radioFor() === normalizeForSearch(this.query()).trim()
      ? this.radioHits().filter((s) => !this.radioOnBox().has(feedKey(s.url)))
      : null,
  )

  /** the tiles of the start: at least one to show */
  protected readonly waysShown = computed(
    () => this.own().length > 0 || this.wishesOn() || this.podcastsOn() || this.radioOn(),
  )

  // ---------- wishes from Spotify (backend wishes.ts; switched on in the app, Bedienung › Suche) ----------
  // asked only when the child taps "Bei Spotify suchen", 10 of each kind; the next page when the end of the hits comes
  // into view; every page kept on the display (back, the same text again: nothing asked) and a day on the box
  protected readonly wishesOn = signal(false)
  private readonly wishFor = signal('')
  private readonly wishItems = signal<WishItem[]>([])
  protected readonly wishMore = signal(false)
  protected readonly wishBusy = signal(false)
  protected readonly wishShown = computed(() =>
    this.wishFor() && this.wishFor() === normalizeForSearch(this.query()).trim() ? this.wishItems() : null,
  )

  protected readonly nothingFound = computed(
    () => !this.loading() && this.query().trim().length >= 2 && this.hits().length === 0,
  )

  protected readonly categoryLabel = CATEGORY_LABEL
  // (playing, putting on the start page and the tabs: shared with the artist and album page of the search)
  private readonly flow = inject(SearchFlowService)
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
        this.podcastsOn.set((config?.mupibox as { displayPodcasts?: boolean } | undefined)?.displayPodcasts === true)
        this.radioOn.set((config?.mupibox as { displayRadio?: boolean } | undefined)?.displayRadio === true)
        this.wishesOn.set((config?.mupibox as { displayWishes?: boolean } | undefined)?.displayWishes === true)
        if (this.wishesOn()) this.flow.loadWished()
        this.flow.categories.set(this.categories())
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
    // (Spotify does not play now: said once in a popup - the page keeps its room)
    this.spotifyBlock.tellIfBlocked()
    // back from the artist or album page: what happened there ("… ist jetzt bei Musik")
    const { note, changed, fromOwnPage } = this.flow.takeNote()
    if (note) this.showNote(note)
    // (back from the search's own artist or album page with nothing put on the start page: the hits stay as they were,
    // nothing is read again; back from elsewhere - the player, the start page - the library may have changed)
    if (this.entered && !fromOwnPage) this.loadLibrary()
    // (put on the start page: its lists are made again a moment later)
    if (changed) window.setTimeout(() => this.loadLibrary(), 1500)
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
      .subscribe((r) => {
        this.pool.set(r?.entries ?? [])
        // (the artist and album pages fetch what is allowed instead of wishing it)
        this.flow.pool.set(this.pool())
      })
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
        // (a tile chosen that asks a directory or Spotify: "Suchen" asks for the typed text)
        go: [
          'Q W E R T Z U I O P Ü',
          'A S D F G H J K L Ö Ä',
          '{123} Y X C V B N M ß {bksp}',
          '{hide} {space} {clear} {search}',
        ],
        goDigits: ['1 2 3 4 5 6 7 8 9 0', "- . , ! ? ' & ( ) :", '{abc} {bksp}', '{hide} {space} {clear} {search}'],
      },
      layoutName: 'default',
      display: {
        '{bksp}': '⌫',
        '{space}': ' ',
        '{123}': '123',
        '{abc}': 'ABC',
        '{hide}': '▼',
        '{clear}': '✕',
        '{search}': this.texts.text('searchKey'),
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
    window.clearTimeout(this.speakingTimer)
  }

  private keyPressed(button: string): void {
    if (button === '{123}') this.setLayout(true)
    else if (button === '{abc}') this.setLayout(false)
    else if (button === '{hide}') this.keyboardShown.set(false)
    else if (button === '{clear}') this.clear()
    else if (button === '{search}') this.searchHere()
  }

  /** the keyboard's keys: with "Suchen" where a directory or Spotify is asked */
  private setLayout(digits: boolean): void {
    const go = this.mode() === 'spotify' || this.mode() === 'podcasts' || this.mode() === 'radio'
    this.keyboard?.setOptions({
      layoutName: go ? (digits ? 'goDigits' : 'go') : digits ? 'digits' : 'default',
      display: { ...(this.keyboard?.options.display ?? {}), '{search}': this.texts.text('searchKey') },
    })
  }

  /** "Suchen" on the keyboard: the chosen tile asked for the typed text, the keyboard folded away for the hits */
  private searchHere(): void {
    if (!this.typed()) return
    const m = this.mode()
    if (m === 'spotify') void this.searchWishes()
    else if (m === 'podcasts') void this.searchPodcasts()
    else if (m === 'radio') void this.searchRadio()
    else return
    this.keyboardShown.set(false)
  }

  /** a tap on the field: the keyboard comes back */
  protected showKeyboard(): void {
    this.keyboardShown.set(true)
  }

  /** a tile's name in the box's language */
  protected wayName(m: SearchMode): string {
    return this.texts.text(WAY_LABEL[m])
  }

  /** a tile's name tapped: read aloud, as a name on the start page */
  protected sayWay(m: SearchMode): void {
    this.player.sayText(this.texts.text(WAY_LABEL[m]))
    this.speaking.set(m)
    window.clearTimeout(this.speakingTimer)
    this.speakingTimer = window.setTimeout(() => this.speaking.set(null), 1800)
  }

  /** a tile of the start: the search looks only there (Spotify: the keyboard at once - nothing to show before) */
  protected enterMode(m: SearchMode): void {
    this.mode.set(m)
    this.keyboard?.clearInput()
    this.query.set('')
    this.setLayout(false)
    this.keyboardShown.set(m === 'spotify')
    if (m === 'podcasts' && this.tips() === null) this.loadTips()
    if (m === 'radio' && this.radioTips() === null) this.loadRadioTips()
  }

  /** the tile "Bei Spotify suchen": with a text typed it asks for it, else the search looks on Spotify */
  protected wishTileClicked(): void {
    if (this.typed()) void this.searchWishes()
    else this.enterMode('spotify')
  }

  protected podTileClicked(): void {
    if (this.typed()) void this.searchPodcasts()
    else this.enterMode('podcasts')
  }

  protected radioTileClicked(): void {
    if (this.typed()) void this.searchRadio()
    else this.enterMode('radio')
  }

  protected clear(): void {
    this.keyboard?.clearInput()
    this.query.set('')
    this.keyboardShown.set(true)
  }

  /** back: from a tile to the start of the search, from there to the start page */
  protected goBack(): void {
    if (this.mode()) {
      this.mode.set(null)
      this.keyboard?.clearInput()
      this.query.set('')
      this.setLayout(false)
      this.keyboardShown.set(false)
      return
    }
    this.navController.navigateRoot('/home', { animationDirection: 'back' })
  }

  /** a tab's name in the box's language */
  protected catLabel(category: string): string {
    return this.flow.catLabel(category)
  }

  /** whether a hit is of Spotify (greyed while Spotify does not play) */
  protected isSpotify(hit: Hit): boolean {
    if (hit.pool) return hit.pool.kind !== 'podcast'
    return (hit.media ?? hit.artist?.coverMedia)?.type === 'spotify'
  }

  protected hitClicked(hit: Hit): void {
    // (Spotify does not play now: the note, nothing opened)
    if (this.spotifyBlock.player() && this.isSpotify(hit)) {
      this.spotifyBlock.tell()
      return
    }
    if (hit.pool) {
      if (hit.pool.kind === 'artist' && !hit.poolAlbum) this.openPoolArtist(hit.pool)
      else this.openPoolItem(hit.pool, hit.poolAlbum)
    } else if (hit.artist) {
      this.openArtist(hit.artist, hit.category)
    } else if (hit.media) {
      this.openMedia(hit.media)
    }
  }

  private loadTips(): void {
    this.tips.set([])
    this.http
      .get<{ shows: KidsPodcast[] }>(`${this.api}/search-podcasts/tips`)
      .pipe(
        catchError(() => of({ shows: [] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.tips.set(r?.shows ?? []))
  }

  private loadRadioTips(): void {
    this.radioTips.set([])
    this.http
      .get<{ stations: KidsStation[] }>(`${this.api}/search-radio/tips`)
      .pipe(
        catchError(() => of({ stations: [] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.radioTips.set(r?.stations ?? []))
  }

  /** "Radio": the directory asked for the typed text (the backend keeps each text a day) */
  protected async searchRadio(): Promise<void> {
    const q = normalizeForSearch(this.query()).trim()
    if (q.length < 2 || this.radioBusy()) return
    this.radioBusy.set(true)
    try {
      const r = await firstValueFrom(
        this.http.get<{ stations: KidsStation[] }>(`${this.api}/search-radio`, { params: { q } }),
      )
      this.radioHits.set(r?.stations ?? [])
      this.radioFor.set(q)
    } catch {
      this.showNote(this.texts.text('searchFailed'))
    } finally {
      this.radioBusy.set(false)
    }
  }

  /** a radio station for children: its page, "Auf die Startseite" (no approval needed) */
  protected openKidsRadio(s: KidsStation): void {
    this.flow.openedOwnPage()
    void this.navController.navigateForward(['/search-album'], { state: { entry: kidsRadioEntry(s) } })
  }

  /** one of the child's own: its page - another tab, or off the start page */
  protected openOwn(o: OwnEntry): void {
    this.flow.openedOwnPage()
    void this.navController.navigateForward(['/search-album'], { state: { own: o } })
  }

  /** "Podcasts für Kinder": the directories asked for the typed text (the backend keeps each text a day) */
  protected async searchPodcasts(): Promise<void> {
    const q = normalizeForSearch(this.query()).trim()
    if (q.length < 2 || this.podBusy()) return
    this.podBusy.set(true)
    try {
      const r = await firstValueFrom(
        this.http.get<{ shows: KidsPodcast[] }>(`${this.api}/search-podcasts`, { params: { q } }),
      )
      this.podHits.set(r?.shows ?? [])
      this.podFor.set(q)
    } catch {
      this.showNote(this.texts.text('searchFailed'))
    } finally {
      this.podBusy.set(false)
    }
  }

  /** "Bei Spotify suchen": the first page for the typed text (kept on the display: tapped again, nothing is asked) */
  protected async searchWishes(): Promise<void> {
    const q = normalizeForSearch(this.query()).trim()
    if (q.length < 2 || this.wishBusy()) return
    // (Spotify answers nothing new now: said, nothing asked)
    if (this.spotifyBlock.catalog()) {
      this.spotifyBlock.tell('catalog')
      return
    }
    this.wishBusy.set(true)
    const r = await this.flow.searchWishes(q)
    this.wishBusy.set(false)
    if (r === 'blocked') return this.spotifyBlock.tell('catalog')
    if (r === 'failed') return this.showNote(this.texts.text('searchFailed'))
    this.wishItems.set(r.items)
    this.wishMore.set(r.more)
    this.wishFor.set(q)
  }

  /** the end of the hits came into view: the next page (only when there is one) */
  protected async moreWishes(): Promise<void> {
    const q = this.wishFor()
    if (!q || !this.wishMore() || this.wishBusy()) return
    this.wishBusy.set(true)
    const r = await this.flow.searchWishes(q, true)
    this.wishBusy.set(false)
    if (typeof r === 'string') {
      // (no further tries from this list: it says nothing more)
      this.wishMore.set(false)
      if (r === 'blocked') this.spotifyBlock.tell('catalog')
      return
    }
    if (this.wishFor() !== q) return
    this.wishItems.set(r.items)
    this.wishMore.set(r.more)
  }

  protected isWished(w: WishItem): boolean {
    return this.flow.wished().has(`${w.kind}:${w.id}`)
  }

  /** a hit of Spotify: an artist its albums, an album / a show its page with "Wünschen" */
  protected openWish(w: WishItem): void {
    // (allowed already - an approved wish: the pool's page, the child fetches it itself; on the box: its page says so)
    const allowed = w.there ? undefined : this.flow.poolFor(w)
    if (allowed) {
      if (allowed.entry.kind === 'artist' && !allowed.album) this.openPoolArtist(allowed.entry)
      else this.openPoolItem(allowed.entry, allowed.album)
      return
    }
    this.flow.openedOwnPage()
    if (w.kind === 'artist') void this.navController.navigateForward(['/search-artist'], { state: { wishArtist: w } })
    else void this.navController.navigateForward(['/search-album'], { state: { wish: w } })
  }

  /** a podcast for children: its page, "Auf die Startseite" (no approval needed) */
  protected openKidsPodcast(p: KidsPodcast): void {
    this.flow.openedOwnPage()
    void this.navController.navigateForward(['/search-album'], { state: { entry: kidsPodcastEntry(p) } })
  }

  // ---------- a pool hit: a page of its own (the search stays as it is behind it, the back arrow comes back here) ----------

  /** an artist of the pool: its albums not on the start page yet, as the start page's album list shows them */
  private openPoolArtist(entry: PoolEntry): void {
    const have = new Set(this.media().map(({ media }) => media.id))
    const albums = (entry.albums ?? []).filter((a) => !have.has(a.id))
    this.flow.openedOwnPage()
    void this.navController.navigateForward(['/search-artist'], { state: { entry, albums } })
  }

  /** one album (of a pool artist), a playlist, a podcast: big, with "Abspielen" and "Auf die Startseite" */
  private openPoolItem(entry: PoolEntry, album?: PoolAlbum): void {
    this.flow.openedOwnPage()
    void this.navController.navigateForward(['/search-album'], { state: { entry, album } })
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
