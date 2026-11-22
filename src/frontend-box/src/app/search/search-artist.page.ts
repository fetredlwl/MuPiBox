import { NgTemplateOutlet } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core'
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
import { KmStatusGroupComponent } from '../km-header/km-status-group.component'
import { SpotifyBlockService } from '../spotify-block.service'
import { StatusComponent } from '../status/status.component'
import { SwiperComponent, type SwiperData } from '../swiper/swiper.component'
import { SwiperIonicEventsHelper } from '../swiper/swiper-ionic-events-helper'
import { KmThemeService } from '../theme/km-theme.service'
import { localizeCoverUrl } from '../utils'
import { type PoolAlbum, type PoolEntry, SearchFlowService, type WishItem } from './search-flow.service'

// An album on this page: of a pool artist (play / put on the start page) or of Spotify (wish it)
type ArtistAlbum = { pool: PoolAlbum } | { wish: WishItem }

// (fork "wishes") An artist of the search: laid out as the start page's album list (same header, same covers, same
// theme), a tap opens the album's page.
//   pool  - an artist of the pool: its albums not on the start page yet, handed over by the search (nothing asked);
//           "Alles holen" in the header puts the whole artist on the start page
//   wish  - an artist found on Spotify: its albums 10 at a time (the box's kept list or Spotify's pages, a day on the
//           box), the next 10 only when the child swipes to the end; loaded once on this display - back here or again
//           later asks nothing; "Ganzen Künstler wünschen" in the header
@Component({
  selector: 'app-search-artist',
  templateUrl: 'search-artist.page.html',
  styleUrls: ['search-artist.page.scss'],
  imports: [
    NgTemplateOutlet,
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
export class SearchArtistPage extends SwiperIonicEventsHelper {
  private readonly router = inject(Router)
  private readonly navController = inject(NavController)
  private readonly spotifyBlock = inject(SpotifyBlockService)
  private readonly flow = inject(SearchFlowService)
  protected readonly texts = inject(DisplayTextsService)
  protected readonly r2 = inject(KmThemeService).roundTwo

  protected readonly entry = signal<PoolEntry | null>(null)
  protected readonly wishArtist = signal<WishItem | null>(null)
  private readonly poolAlbums = signal<PoolAlbum[]>([])
  private readonly wishAlbums = signal<WishItem[]>([])
  private readonly wishMore = signal(false)
  protected readonly loading = signal(false)
  private readonly failed = signal(false)
  // (the page is in: covers that come later - Spotify's answer after the page change - are drawn as well)
  private readonly entered = signal(false)

  protected readonly name = computed(() => this.entry()?.name ?? this.wishArtist()?.name ?? '')
  protected readonly swiperData = computed<SwiperData<ArtistAlbum>[]>(() =>
    this.wishArtist()
      ? this.wishAlbums().map((w) => ({
          name: w.name,
          imgSrc: of(localizeCoverUrl(w.cover || undefined)),
          data: { wish: w },
          kind: 'album' as const,
        }))
      : this.poolAlbums().map((a) => ({
          name: a.name,
          imgSrc: of(localizeCoverUrl(a.cover || undefined)),
          data: { pool: a },
          kind: 'album' as const,
          dim: this.spotifyBlock.player(),
        })),
  )
  protected readonly empty = computed(() =>
    this.wishArtist()
      ? this.loading()
        ? 'searchAlbumsLoading'
        : this.failed()
          ? 'searchFailed'
          : 'wishNone'
      : this.entry()?.albums
        ? 'searchAllThere'
        : 'searchAlbumsLoading',
  )

  constructor() {
    super()
    addIcons({ arrowBackOutline })
    // The covers' swiper is there only once the albums are: when they came after the page change (the first visit,
    // Spotify asked), it never heard the page's events and stayed empty - back again (loaded then) it was full.
    effect(() => {
      const swiper = this.swiperComponent()
      if (swiper && this.entered()) untracked(() => swiper.ionViewDidEnter())
    })
    const state = this.router.currentNavigation()?.extras.state as
      | { entry?: PoolEntry; albums?: PoolAlbum[]; wishArtist?: WishItem }
      | undefined
    this.entry.set(state?.entry ?? null)
    this.poolAlbums.set(state?.albums ?? [])
    this.wishArtist.set(state?.wishArtist ?? null)
    const w = state?.wishArtist
    if (w) {
      // (loaded on this display before: shown at once, nothing asked)
      const have = this.flow.artistKept(w.id)
      if (have) {
        this.wishAlbums.set(have.items)
        this.wishMore.set(have.more)
      } else {
        void this.loadWishAlbums(false)
      }
    }
  }

  override ionViewWillEnter(): void {
    // (opened afresh without the search behind it - a reload of the display: nothing to show)
    if (!this.entry() && !this.wishArtist()) void this.navController.navigateRoot(['/search'])
    super.ionViewWillEnter()
  }

  // (no covers - all of the artist on the start page already: no swiper to tell)
  override ionViewDidEnter(): void {
    this.entered.set(true)
    if (this.swiperComponent()) super.ionViewDidEnter()
  }

  override ionViewWillLeave(): void {
    this.entered.set(false)
    if (this.swiperComponent()) super.ionViewWillLeave()
  }

  private async loadWishAlbums(more: boolean): Promise<void> {
    const w = this.wishArtist()
    if (!w || this.loading()) return
    this.loading.set(true)
    const r = await this.flow.artistWishes(w.id, more)
    this.loading.set(false)
    if (typeof r === 'string') {
      this.wishMore.set(false)
      this.failed.set(r === 'failed')
      if (r === 'blocked') this.spotifyBlock.tell('catalog')
      return
    }
    this.failed.set(false)
    this.wishAlbums.set(r.items)
    this.wishMore.set(r.more)
  }

  /** the child swiped to the last covers: the next 10 (only when there are more) */
  protected nearEnd(): void {
    if (this.wishArtist() && this.wishMore()) void this.loadWishAlbums(true)
  }

  protected goBack(): void {
    void this.navController.pop()
  }

  protected albumClicked(album: ArtistAlbum): void {
    if ('wish' in album) {
      void this.navController.navigateForward(['/search-album'], { state: { wish: album.wish } })
      return
    }
    if (this.spotifyBlock.player()) {
      this.spotifyBlock.tell()
      return
    }
    void this.navController.navigateForward(['/search-album'], { state: { entry: this.entry(), album: album.pool } })
  }

  /** "Alles von … holen" / "Ganzen Künstler wünschen": the whole artist - its page asks for the tab */
  protected getAll(): void {
    const w = this.wishArtist()
    if (w) void this.navController.navigateForward(['/search-album'], { state: { wish: w } })
    else void this.navController.navigateForward(['/search-album'], { state: { entry: this.entry(), whole: true } })
  }
}
