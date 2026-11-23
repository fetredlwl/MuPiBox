import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone'
import { addIcons } from 'ionicons'
import { arrowBackOutline } from 'ionicons/icons'
import { of } from 'rxjs'
import { DisplayTextsService } from '../display-texts.service'
import { HeaderVisibilityService } from '../header-visibility.service'
import { KmStatusGroupComponent } from '../km-header/km-status-group.component'
import type { CategoryType } from '../media'
import { SpotifyBlockService } from '../spotify-block.service'
import { StatusComponent } from '../status/status.component'
import { SwiperComponent, type SwiperData } from '../swiper/swiper.component'
import { SwiperIonicEventsHelper } from '../swiper/swiper-ionic-events-helper'
import { KmThemeService } from '../theme/km-theme.service'
import { localizeCoverUrl } from '../utils'
import {
  type OwnEntry,
  type PlaylistSong,
  type PoolAlbum,
  type PoolEntry,
  SearchFlowService,
  type TargetPlaylist,
  type WishItem,
} from './search-flow.service'
import { CATEGORY_TILE, TILE_ICON, tilePicture } from './search-tiles'

// what the page lists: the thing itself (its cover), what can be done with it, the tabs it may go to
// ((fork "wishes") a song into a playlist of the child's own, its songs taken out of one)
type Act =
  | 'play'
  | 'start'
  | 'wish'
  | 'wished'
  | 'onbox'
  | 'move'
  | 'remove'
  | 'removeYes'
  | 'toPlaylist'
  | 'songs'
  | 'takeOutYes'
  | 'albumSongs'
type Tile =
  | { t: 'item' }
  | { t: 'act'; a: Act }
  | { t: 'cat'; c: CategoryType }
  | { t: 'target'; p: TargetPlaylist }
  | { t: 'song'; s: PlaylistSong }
  | { t: 'track'; w: WishItem }

const ACT_TEXT = {
  play: 'searchPlay',
  start: 'searchToStart',
  wish: 'wishButton',
  wished: 'wishWished',
  onbox: 'wishOnBox',
  move: 'searchMove',
  remove: 'searchRemove',
  removeYes: 'searchRemoveYes',
  toPlaylist: 'trackToPlaylist',
  songs: 'plSongs',
  takeOutYes: 'plTakeOutYes',
  albumSongs: 'trackSongs',
} as const
const ACT_ICON: Record<Act, string> = {
  play: TILE_ICON.play,
  start: TILE_ICON.plus,
  wish: TILE_ICON.star,
  wished: TILE_ICON.star,
  onbox: TILE_ICON.check,
  move: TILE_ICON.move,
  remove: TILE_ICON.cross,
  removeYes: TILE_ICON.cross,
  toPlaylist: TILE_ICON.plus,
  songs: TILE_ICON.music,
  takeOutYes: TILE_ICON.cross,
  albumSongs: TILE_ICON.music,
}
// (the star's yellow for wishing, the tick's green on the box, red for the last word on removing)
const ACT_COLOURS: Partial<Record<Act, { bg: string; ink: string }>> = {
  wish: { bg: '#f5b301', ink: '#2a1d00' },
  wished: { bg: '#f5b301', ink: '#2a1d00' },
  onbox: { bg: '#2fb36b', ink: '#ffffff' },
  removeYes: { bg: '#d94848', ink: '#ffffff' },
  takeOutYes: { bg: '#d94848', ink: '#ffffff' },
}

// (fork "wishes") One thing of the search pool - an album (of a pool artist), a playlist, a podcast, or a whole artist
// ("Alles holen"): laid out as "Weiterhören" - the start page's album list (mupi-swiper) with the thing's cover first,
// then "Abspielen" and "Auf die Startseite" as covers of their own (a sign on the theme's colour, the name on its bar,
// read aloud on a tap). "Auf die Startseite" lists the tabs instead, the header asks "Wohin?". Nothing of the page's
// own to draw: a theme draws it as it draws the start page. One way back: the arrow top left (from the tabs to the
// buttons, else to the page before).
// Wish mode (something found on Spotify, backend wishes.ts): "Wünschen" instead - the tab, and the parents decide; not
// played before that. Already wished: "Gewünscht", nothing to tap.
// Own mode ("Einträge verwalten"): something the child put on the start page itself - "Woanders hin" (another tab) or
// "Entfernen" (asked once more in the same place); a playlist of its own account also "Songs herausnehmen" (its songs as
// covers, one tapped is asked once more: "Ja, herausnehmen").
// New playlist ("Neue Playlist", its name typed in the search): the tabs at once - made in the child's account and put
// on the start page there (backend search-playlists.ts).
// Song (a single song of the Spotify search): "In eine Playlist" when the child can play it already, else "Wünschen" -
// then the playlists of its own on the start page instead of the tabs ("In welche Playlist?").
@Component({
  selector: 'app-search-album',
  templateUrl: 'search-album.page.html',
  styleUrls: ['search-album.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonTitle,
    IonContent,
    KmStatusGroupComponent,
    StatusComponent,
    SwiperComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
// (the covers are drawn on Ionic's page events, as on the album list: SwiperIonicEventsHelper)
export class SearchAlbumPage extends SwiperIonicEventsHelper {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  private readonly router = inject(Router)
  private readonly navController = inject(NavController)
  protected readonly flow = inject(SearchFlowService)
  protected readonly spotifyBlock = inject(SpotifyBlockService)
  protected readonly texts = inject(DisplayTextsService)
  protected readonly r2 = inject(KmThemeService).roundTwo
  // the top bar folded away: the covers drawn larger, as on "Weiterhören"
  protected readonly headerHidden = inject(HeaderVisibilityService).hidden

  protected readonly entry = signal<PoolEntry | null>(null)
  /** something of Spotify to wish (instead of an entry of the pool) */
  protected readonly wish = signal<WishItem | null>(null)
  protected readonly wished = computed(() => {
    const w = this.wish()
    return !!w && this.flow.wished().has(`${w.kind}:${w.id}`)
  })
  /** one of the child's own on the start page (instead of an entry of the pool) */
  protected readonly own = signal<OwnEntry | null>(null)
  /** "Entfernen" tapped: asked once more */
  protected readonly removing = signal(false)
  /** the tabs an own entry may go to: the shown ones but its own */
  protected readonly elsewhere = computed(() => this.flow.categories().filter((c) => c !== this.own()?.category))
  protected readonly album = signal<PoolAlbum | undefined>(undefined)
  /** the whole artist ("Alles holen") */
  protected readonly whole = signal(false)
  /** "Auf die Startseite" tapped: the tabs are asked */
  protected readonly choosing = signal(false)
  protected readonly busy = signal(false)
  /** (fork "wishes") a new playlist's name (typed in the search) */
  protected readonly newPlaylist = signal<string | null>(null)
  /** a single song of the Spotify search */
  protected readonly track = signal<WishItem | null>(null)
  protected readonly trackWished = computed(() => {
    const t = this.track()
    return !!t && this.flow.wished().has(`track:${t.id}`)
  })
  /** "Songs herausnehmen": the songs of the child's playlist (null: not shown), the one tapped (asked once more) */
  protected readonly songs = signal<PlaylistSong[] | null>(null)
  protected readonly songPick = signal<PlaylistSong | null>(null)
  /** the child's playlists the song is in already (✓, not to choose) */
  protected readonly inPlaylists = signal<Set<string>>(new Set())
  /** "Songs" of an album: its songs as covers (null: not shown) - one tapped opens its page */
  protected readonly albumTracks = signal<WishItem[] | null>(null)
  /** the album of Spotify this page shows (a hit, an album of an allowed artist, an allowed one) - its songs */
  protected readonly albumId = computed(() => {
    const w = this.wish()
    if (w?.kind === 'album') return w.id
    const a = this.album()
    if (a) return a.id
    const e = this.entry()
    return e?.kind === 'album' && !this.whole() ? e.spotifyId : null
  })

  protected readonly title = computed(
    () =>
      this.newPlaylist() ??
      this.track()?.name ??
      this.own()?.name ??
      this.wish()?.name ??
      this.album()?.name ??
      this.entry()?.name ??
      '',
  )
  /** the header: the name - or the question while the tabs (or the last word on removing) are listed */
  protected readonly heading = computed(() =>
    this.choosing()
      ? this.texts.text(this.track() ? 'trackWhich' : 'searchWhere')
      : this.removing()
        ? this.texts.text('searchRemoveQ')
        : this.albumTracks()
          ? this.texts.text('trackSongs')
          : this.songPick()
            ? this.texts.text('plTakeOutQ')
            : this.songs()
              ? this.texts.text('plSongs')
              : this.title(),
  )
  protected readonly cover = computed(() =>
    localizeCoverUrl(
      this.track()?.cover ||
        this.own()?.cover ||
        this.wish()?.cover ||
        this.album()?.cover ||
        this.entry()?.cover ||
        undefined,
    ),
  )
  protected readonly round = computed(
    () =>
      this.own()?.kind === 'artist' ||
      this.wish()?.kind === 'artist' ||
      (!this.album() && this.entry()?.kind === 'artist'),
  )
  protected readonly playable = computed(() => {
    if (this.wish()) return false
    const e = this.entry()
    return !!e && !this.whole() && this.flow.playable(e, this.album())
  })

  /** what is listed: the tabs while they are asked, else the thing and what can be done with it */
  private readonly tiles = computed<Tile[]>(() => {
    const cats = (list: CategoryType[]): Tile[] => list.map((c): Tile => ({ t: 'cat', c }))
    const act = (a: Act): Tile => ({ t: 'act', a })
    if (this.newPlaylist() !== null)
      return this.choosing() ? cats(this.flow.categories()) : [{ t: 'item' }, act('start')]
    const t = this.track()
    if (t) {
      if (this.choosing()) return this.flow.playlists().targets.map((p): Tile => ({ t: 'target', p }))
      return [{ t: 'item' }, act(t.allowed ? 'toPlaylist' : this.trackWished() ? 'wished' : 'wish')]
    }
    const o = this.own()
    if (o) {
      const song = this.songPick()
      if (song) return [{ t: 'song', s: song }, act('takeOutYes')]
      const songs = this.songs()
      if (songs) return songs.map((x): Tile => ({ t: 'song', s: x }))
      if (this.choosing()) return cats(this.elsewhere())
      if (this.removing()) return [{ t: 'item' }, act('removeYes')]
      // (a playlist of its own account: its songs too)
      const ownList = o.kind === 'playlist' && o.own === true && this.flow.playlists().tracks
      return [
        { t: 'item' },
        ...(this.elsewhere().length ? [act('move')] : []),
        ...(ownList ? [act('songs')] : []),
        act('remove'),
      ]
    }
    const albumTracks = this.albumTracks()
    if (albumTracks) return albumTracks.map((w): Tile => ({ t: 'track', w }))
    if (this.choosing()) return cats(this.flow.categories())
    const out: Tile[] = [{ t: 'item' }]
    // (podcasts, shows and a whole artist: on the start page only - their episodes / albums come with them there)
    if (this.playable()) out.push(act('play'))
    // (wished: the parents decide in the app; on the box already: nothing to wish or fetch)
    const w = this.wish()
    if (w) out.push(act(w.there ? 'onbox' : this.wished() ? 'wished' : 'wish'))
    else out.push(act('start'))
    // (an album of Spotify with single songs on: its songs - one goes into a playlist of the child's own)
    if (this.albumId() && this.flow.playlists().tracks) out.push(act('albumSongs'))
    return out
  })
  protected readonly swiperData = computed<SwiperData<Tile>[]>(() =>
    this.tiles().map((tile) => {
      if (tile.t === 'item') return { name: this.title(), imgSrc: of(this.cover()), data: tile, kind: 'album' as const }
      if (tile.t === 'cat') {
        return {
          name: this.flow.catLabel(tile.c),
          imgSrc: of(tilePicture(this.host.nativeElement, CATEGORY_TILE[tile.c] ?? TILE_ICON.music)),
          data: tile,
          dim: this.busy(),
        }
      }
      if (tile.t === 'target') {
        // (the song is in it already: ✓, grey - a tap says so)
        const there = this.inPlaylists().has(tile.p.id)
        return {
          name: tile.p.name,
          imgSrc: of(localizeCoverUrl(tile.p.cover || undefined)),
          data: tile,
          dim: this.busy() || there,
          ...(there ? { mark: '✓' } : {}),
        }
      }
      if (tile.t === 'track')
        return {
          name: tile.w.name,
          sub: tile.w.artist
            ? `${this.texts.text('searchKindSong')} · ${tile.w.artist}`
            : this.texts.text('searchKindSong'),
          imgSrc: of(localizeCoverUrl(tile.w.cover || undefined)),
          data: tile,
          kind: 'album' as const,
          mark: tile.w.allowed ? '+' : '★',
        }
      if (tile.t === 'song')
        return {
          name: tile.s.name,
          imgSrc: of(localizeCoverUrl(tile.s.cover || undefined)),
          data: tile,
          kind: 'album' as const,
        }
      return {
        name: this.texts.text(ACT_TEXT[tile.a]),
        imgSrc: of(tilePicture(this.host.nativeElement, ACT_ICON[tile.a], ACT_COLOURS[tile.a])),
        data: tile,
        // (wished already: nothing to tap; Spotify blocks the box: "Abspielen" grey - a tap tells why)
        dim: tile.a === 'wished' || (tile.a === 'play' && this.spotifyBlock.player()),
      }
    }),
  )
  protected readonly swiperNames = computed(() =>
    this.swiperData()
      .map((d) => d.name)
      .join('|'),
  )
  /** the list's position kept per step: the tabs start at their first, back to the buttons where they were */
  protected readonly listKey = computed(
    () =>
      `search-album|${this.choosing() ? 'tabs' : this.removing() ? 'remove' : this.albumTracks() ? 'tracks' : this.songPick() ? 'song' : this.songs() ? 'songs' : 'acts'}|${this.title()}`,
  )

  constructor() {
    super()
    addIcons({ arrowBackOutline })
    const state = this.router.currentNavigation()?.extras.state as
      | {
          entry?: PoolEntry
          album?: PoolAlbum
          whole?: boolean
          wish?: WishItem
          own?: OwnEntry
          newPlaylist?: string
          track?: WishItem
        }
      | undefined
    this.entry.set(state?.entry ?? null)
    this.track.set(state?.track ?? null)
    // (a new playlist: the tabs at once - its name was typed already)
    if (typeof state?.newPlaylist === 'string' && state.newPlaylist) {
      this.newPlaylist.set(state.newPlaylist)
      this.choosing.set(this.flow.categories().length > 1)
    }
    this.own.set(state?.own ?? null)
    this.wish.set(state?.wish ?? null)
    this.album.set(state?.album)
    this.whole.set(state?.whole === true)
  }

  override ionViewWillEnter(): void {
    // (opened afresh without the search behind it - a reload of the display: nothing to show)
    if (!this.entry() && !this.wish() && !this.own() && !this.track() && this.newPlaylist() === null)
      void this.navController.navigateRoot(['/search'])
    super.ionViewWillEnter()
  }

  protected tileClicked(tile: Tile): void {
    if (this.busy()) return
    if (tile.t === 'cat') {
      void this.addTo(tile.c)
      return
    }
    if (tile.t === 'target') {
      void this.intoPlaylist(tile.p)
      return
    }
    if (tile.t === 'track') {
      // (one of the album's songs: its own page - into a playlist, or wished for one; an address of its own: the router
      // does not go to the same address again)
      this.flow.openedOwnPage()
      void this.navController.navigateForward(['/search-album'], {
        queryParams: { song: tile.w.id },
        state: { track: tile.w },
      })
      return
    }
    if (tile.t === 'song') {
      // (a song of the list: asked once more - the one asked about: nothing)
      if (!this.songPick()) this.songPick.set(tile.s)
      return
    }
    // (the thing's own cover: plays it where it can be played)
    const a = tile.t === 'item' ? (this.playable() ? 'play' : null) : tile.a
    switch (a) {
      case 'play':
        this.play()
        return
      case 'start':
      case 'wish':
        this.toStart()
        return
      case 'move':
        this.moveOwn()
        return
      case 'remove':
      case 'removeYes':
        void this.removeOwn()
        return
      case 'toPlaylist':
        this.choosePlaylist()
        return
      case 'songs':
        void this.showSongs()
        return
      case 'takeOutYes':
        void this.takeOut()
        return
      case 'albumSongs':
        void this.showAlbumSongs()
        return
    }
  }

  protected goBack(): void {
    if (this.albumTracks()) {
      this.albumTracks.set(null)
      return
    }
    if (this.songPick()) {
      this.songPick.set(null)
      return
    }
    if (this.songs()) {
      this.songs.set(null)
      return
    }
    // (a new playlist: its tabs came first - back is back to the search)
    if ((this.choosing() || this.removing()) && !(this.newPlaylist() !== null && this.flow.categories().length > 1)) {
      this.choosing.set(false)
      this.removing.set(false)
      return
    }
    void this.navController.pop()
  }

  /** a song: the playlists of the child's own on the start page (with one only, straight there; none: said) */
  private choosePlaylist(): void {
    const targets = this.flow.playlists().targets
    if (!targets.length) {
      this.flow.noteBack(this.texts.text('trackNoPlaylist'))
      return
    }
    // (always asked, one playlist too: the child sees where the song goes; those it is in already marked ✓)
    void this.markContaining()
    this.choosing.set(true)
  }

  /** the child's playlists the song is in already (asked while the choice shows) */
  private async markContaining(): Promise<void> {
    const t = this.track()
    if (t) this.inPlaylists.set(await this.flow.trackIn(t.id))
  }

  /** the song into the playlist chosen - at once when the child can play it already, else wished for it */
  private async intoPlaylist(p: TargetPlaylist): Promise<void> {
    const t = this.track()
    if (!t || this.busy()) return
    if (this.inPlaylists().has(p.id)) {
      this.flow.noteBack(this.texts.text('trackAlready', { n: t.name, p: p.name }))
      return
    }
    this.busy.set(true)
    if (t.allowed) await this.flow.putTrack(t, p)
    else await this.flow.wish(t, 'music', p)
  }

  /** "Songs": the album's songs (from Spotify, kept a day) */
  private async showAlbumSongs(): Promise<void> {
    const id = this.albumId()
    if (!id || this.busy()) return
    this.busy.set(true)
    const songs = await this.flow.albumSongs(id)
    this.busy.set(false)
    if (!songs) {
      this.flow.noteBack(this.texts.text('searchFailed'))
      return
    }
    if (!songs.length) {
      this.flow.noteBack(this.texts.text('wishNone'))
      return
    }
    this.albumTracks.set(songs)
  }

  /** "Songs herausnehmen": the songs of the playlist (read from Spotify) */
  private async showSongs(): Promise<void> {
    const o = this.own()
    if (!o || this.busy()) return
    this.busy.set(true)
    const songs = await this.flow.songs(o.ident.slice('playlist:'.length))
    this.busy.set(false)
    if (!songs) return this.flow.noteBack(this.texts.text('searchFailed'))
    if (!songs.length) return this.flow.noteBack(this.texts.text('plSongsNone'))
    this.songs.set(songs)
  }

  /** "Ja, herausnehmen": the song out of the playlist */
  private async takeOut(): Promise<void> {
    const o = this.own()
    const song = this.songPick()
    if (!o || !song || this.busy()) return
    this.busy.set(true)
    await this.flow.takeOut(o, song)
  }

  protected play(): void {
    const e = this.entry()
    if (e) this.flow.play(e, this.album())
  }

  /** "Auf die Startseite": the tabs - with one tab only, straight there */
  protected toStart(): void {
    // (a song: wished for a playlist of the child's own, not for a tab)
    if (this.track()) {
      this.choosePlaylist()
      return
    }
    const cats = this.flow.categories()
    if (cats.length === 1) {
      void this.addTo(cats[0])
      return
    }
    this.choosing.set(true)
  }

  protected async addTo(category: CategoryType): Promise<void> {
    if (this.busy()) return
    const name = this.newPlaylist()
    if (name !== null) {
      this.busy.set(true)
      await this.flow.createPlaylist(name, category)
      return
    }
    const o = this.own()
    if (o) {
      this.busy.set(true)
      await this.flow.moveOwn(o, category)
      return
    }
    const w = this.wish()
    if (w) {
      this.busy.set(true)
      await this.flow.wish(w, category)
      return
    }
    const e = this.entry()
    if (!e) return
    this.busy.set(true)
    await this.flow.addTo(e, category, this.whole() ? undefined : this.album())
  }

  /** "Woanders hin": the other tabs (with one other only, straight there) */
  protected moveOwn(): void {
    const cats = this.elsewhere()
    if (cats.length === 1) {
      void this.addTo(cats[0])
      return
    }
    this.choosing.set(true)
  }

  /** "Entfernen": asked once more; "Ja, entfernen": off the start page */
  protected async removeOwn(): Promise<void> {
    const o = this.own()
    if (!o || this.busy()) return
    if (!this.removing()) {
      this.removing.set(true)
      return
    }
    this.busy.set(true)
    await this.flow.removeOwn(o)
  }
}
