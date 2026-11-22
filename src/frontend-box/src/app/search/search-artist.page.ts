import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
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
import type { PoolAlbum, PoolEntry } from './search-flow.service'

// (fork "wishes") An artist of the search pool: its albums not on the start page yet - laid out as the start page's
// album list (same header, same covers, same theme), a tap opens the album's page. "Alles holen" in the header puts the
// whole artist on the start page. Only what the search handed over (no request to the backend or to Spotify); the
// back arrow goes to the search as it was.
@Component({
  selector: 'app-search-artist',
  templateUrl: 'search-artist.page.html',
  styleUrls: ['search-artist.page.scss'],
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
export class SearchArtistPage extends SwiperIonicEventsHelper {
  private readonly router = inject(Router)
  private readonly navController = inject(NavController)
  private readonly spotifyBlock = inject(SpotifyBlockService)
  protected readonly texts = inject(DisplayTextsService)
  protected readonly r2 = inject(KmThemeService).roundTwo

  protected readonly entry = signal<PoolEntry | null>(null)
  private readonly albums = signal<PoolAlbum[]>([])

  protected readonly swiperData = computed<SwiperData<PoolAlbum>[]>(() =>
    this.albums().map((a) => ({
      name: a.name,
      imgSrc: of(localizeCoverUrl(a.cover || undefined)),
      data: a,
      kind: 'album' as const,
      dim: this.spotifyBlock.player(),
    })),
  )

  constructor() {
    super()
    addIcons({ arrowBackOutline })
    const state = this.router.currentNavigation()?.extras.state as
      | { entry?: PoolEntry; albums?: PoolAlbum[] }
      | undefined
    this.entry.set(state?.entry ?? null)
    this.albums.set(state?.albums ?? [])
  }

  override ionViewWillEnter(): void {
    // (opened afresh without the search behind it - a reload of the display: nothing to show)
    if (!this.entry()) void this.navController.navigateRoot(['/search'])
    super.ionViewWillEnter()
  }

  // (no covers - all of the artist on the start page already: no swiper to tell)
  override ionViewDidEnter(): void {
    if (this.swiperComponent()) super.ionViewDidEnter()
  }

  override ionViewWillLeave(): void {
    if (this.swiperComponent()) super.ionViewWillLeave()
  }

  protected goBack(): void {
    void this.navController.pop()
  }

  protected albumClicked(album: PoolAlbum): void {
    if (this.spotifyBlock.player()) {
      this.spotifyBlock.tell()
      return
    }
    void this.navController.navigateForward(['/search-album'], { state: { entry: this.entry(), album } })
  }

  /** "Alles von … holen": the whole artist - its page asks for the tab */
  protected getAll(): void {
    void this.navController.navigateForward(['/search-album'], { state: { entry: this.entry(), whole: true } })
  }
}
