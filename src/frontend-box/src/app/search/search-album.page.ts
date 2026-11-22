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
import { arrowBackOutline, bookOutline, musicalNotesOutline, radioOutline } from 'ionicons/icons'
import { DisplayTextsService } from '../display-texts.service'
import { KmStatusGroupComponent } from '../km-header/km-status-group.component'
import type { CategoryType } from '../media'
import { SpotifyBlockService } from '../spotify-block.service'
import { StatusComponent } from '../status/status.component'
import { KmThemeService } from '../theme/km-theme.service'
import { localizeCoverUrl } from '../utils'
import { CATEGORY_LABEL, type PoolAlbum, type PoolEntry, SearchFlowService } from './search-flow.service'

// (fork "wishes") One thing of the search pool - an album (of a pool artist), a playlist, a podcast, or a whole artist
// ("Alles holen"): its cover big on the left, on the right "Abspielen" and "Auf die Startseite" - which asks for the
// tab in the same place. All of it on the display without scrolling (laid out as the player: cover and controls side
// by side). One way back: the arrow top left (from the tabs to the buttons, else to the page before).
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchAlbumPage {
  private readonly router = inject(Router)
  private readonly navController = inject(NavController)
  protected readonly flow = inject(SearchFlowService)
  protected readonly spotifyBlock = inject(SpotifyBlockService)
  protected readonly texts = inject(DisplayTextsService)
  protected readonly r2 = inject(KmThemeService).roundTwo
  protected readonly categoryLabel = CATEGORY_LABEL

  protected readonly entry = signal<PoolEntry | null>(null)
  protected readonly album = signal<PoolAlbum | undefined>(undefined)
  /** the whole artist ("Alles holen") */
  protected readonly whole = signal(false)
  /** "Auf die Startseite" tapped: the tabs are asked */
  protected readonly choosing = signal(false)
  protected readonly busy = signal(false)

  protected readonly title = computed(() => this.album()?.name ?? this.entry()?.name ?? '')
  protected readonly sub = computed(() => {
    const e = this.entry()
    if (!e) return ''
    if (this.album()) return e.name
    if (e.kind === 'artist') return this.texts.text('searchArtist')
    if (e.kind === 'podcast') return this.texts.text('searchPodcast')
    return e.artist
  })
  protected readonly cover = computed(() => localizeCoverUrl(this.album()?.cover || this.entry()?.cover || undefined))
  protected readonly round = computed(() => !this.album() && this.entry()?.kind === 'artist')
  protected readonly playable = computed(() => {
    const e = this.entry()
    return !!e && !this.whole() && this.flow.playable(e, this.album())
  })

  constructor() {
    addIcons({ arrowBackOutline, bookOutline, musicalNotesOutline, radioOutline })
    const state = this.router.currentNavigation()?.extras.state as
      | { entry?: PoolEntry; album?: PoolAlbum; whole?: boolean }
      | undefined
    this.entry.set(state?.entry ?? null)
    this.album.set(state?.album)
    this.whole.set(state?.whole === true)
  }

  ionViewWillEnter(): void {
    // (opened afresh without the search behind it - a reload of the display: nothing to show)
    if (!this.entry()) void this.navController.navigateRoot(['/search'])
  }

  protected goBack(): void {
    if (this.choosing()) {
      this.choosing.set(false)
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
    const e = this.entry()
    if (!e || this.busy()) return
    this.busy.set(true)
    await this.flow.addTo(e, category, this.whole() ? undefined : this.album())
  }
}
