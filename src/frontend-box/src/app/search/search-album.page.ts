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
import { type OwnEntry, type PoolAlbum, type PoolEntry, SearchFlowService, type WishItem } from './search-flow.service'
import { CATEGORY_TILE, TILE_ICON, tilePicture } from './search-tiles'

// what the page lists: the thing itself (its cover), what can be done with it, the tabs it may go to
type Act = 'play' | 'start' | 'wish' | 'wished' | 'onbox' | 'move' | 'remove' | 'removeYes'
type Tile = { t: 'item' } | { t: 'act'; a: Act } | { t: 'cat'; c: CategoryType }

const ACT_TEXT = {
  play: 'searchPlay',
  start: 'searchToStart',
  wish: 'wishButton',
  wished: 'wishWished',
  onbox: 'wishOnBox',
  move: 'searchMove',
  remove: 'searchRemove',
  removeYes: 'searchRemoveYes',
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
}
// (the star's yellow for wishing, the tick's green on the box, red for the last word on removing)
const ACT_COLOURS: Partial<Record<Act, { bg: string; ink: string }>> = {
  wish: { bg: '#f5b301', ink: '#2a1d00' },
  wished: { bg: '#f5b301', ink: '#2a1d00' },
  onbox: { bg: '#2fb36b', ink: '#ffffff' },
  removeYes: { bg: '#d94848', ink: '#ffffff' },
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
// "Entfernen" (asked once more in the same place).
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

  protected readonly title = computed(
    () => this.own()?.name ?? this.wish()?.name ?? this.album()?.name ?? this.entry()?.name ?? '',
  )
  /** the header: the name - or the question while the tabs (or the last word on removing) are listed */
  protected readonly heading = computed(() =>
    this.choosing()
      ? this.texts.text('searchWhere')
      : this.removing()
        ? this.texts.text('searchRemoveQ')
        : this.title(),
  )
  protected readonly cover = computed(() =>
    localizeCoverUrl(
      this.own()?.cover || this.wish()?.cover || this.album()?.cover || this.entry()?.cover || undefined,
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
    if (this.own()) {
      if (this.choosing()) return cats(this.elsewhere())
      if (this.removing()) return [{ t: 'item' }, act('removeYes')]
      return [{ t: 'item' }, ...(this.elsewhere().length ? [act('move')] : []), act('remove')]
    }
    if (this.choosing()) return cats(this.flow.categories())
    const out: Tile[] = [{ t: 'item' }]
    // (podcasts, shows and a whole artist: on the start page only - their episodes / albums come with them there)
    if (this.playable()) out.push(act('play'))
    // (wished: the parents decide in the app; on the box already: nothing to wish or fetch)
    const w = this.wish()
    if (w) out.push(act(w.there ? 'onbox' : this.wished() ? 'wished' : 'wish'))
    else out.push(act('start'))
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
    () => `search-album|${this.choosing() ? 'tabs' : this.removing() ? 'remove' : 'acts'}|${this.title()}`,
  )

  constructor() {
    super()
    addIcons({ arrowBackOutline })
    const state = this.router.currentNavigation()?.extras.state as
      | { entry?: PoolEntry; album?: PoolAlbum; whole?: boolean; wish?: WishItem; own?: OwnEntry }
      | undefined
    this.entry.set(state?.entry ?? null)
    this.own.set(state?.own ?? null)
    this.wish.set(state?.wish ?? null)
    this.album.set(state?.album)
    this.whole.set(state?.whole === true)
  }

  override ionViewWillEnter(): void {
    // (opened afresh without the search behind it - a reload of the display: nothing to show)
    if (!this.entry() && !this.wish() && !this.own()) void this.navController.navigateRoot(['/search'])
    super.ionViewWillEnter()
  }

  protected tileClicked(tile: Tile): void {
    if (this.busy()) return
    if (tile.t === 'cat') {
      void this.addTo(tile.c)
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
    }
  }

  protected goBack(): void {
    if (this.choosing() || this.removing()) {
      this.choosing.set(false)
      this.removing.set(false)
      return
    }
    void this.navController.pop()
  }

  protected play(): void {
    const e = this.entry()
    if (e) this.flow.play(e, this.album())
  }

  /** "Auf die Startseite": the tabs - with one tab only, straight there */
  protected toStart(): void {
    const cats = this.flow.categories()
    if (cats.length === 1) {
      void this.addTo(cats[0])
      return
    }
    this.choosing.set(true)
  }

  protected async addTo(category: CategoryType): Promise<void> {
    if (this.busy()) return
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
