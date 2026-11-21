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
import { arrowBackOutline, closeOutline } from 'ionicons/icons'
import { catchError, forkJoin, type Observable, of, take } from 'rxjs'
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

// One hit: an artist (opens its albums, as on the start page) or an album / episode (plays, as in the album list)
interface Hit {
  key: string
  name: string
  sub: string
  imgSrc: Observable<string>
  category: CategoryType
  artist?: Artist
  media?: Media
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

  protected readonly r2 = inject(KmThemeService).roundTwo
  private readonly keyboardHost = viewChild<ElementRef<HTMLElement>>('keyboard')
  private keyboard?: Keyboard

  protected readonly query = signal('')
  protected readonly keyboardShown = signal(true)
  protected readonly loading = signal(true)
  private readonly artists = signal<{ category: CategoryType; artist: Artist }[]>([])
  private readonly media = signal<{ category: CategoryType; media: Media }[]>([])

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
        rank,
      })
    }
    for (const { category, media } of this.media()) {
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
        rank: rank + 0.5,
      })
    }
    return hits
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'de', { numeric: true }))
      .slice(0, MAX_HITS)
  })

  // "nothing found" only once something was typed and the library is there
  protected readonly nothingFound = computed(
    () => !this.loading() && this.query().trim().length >= 2 && this.hits().length === 0,
  )

  constructor() {
    addIcons({ arrowBackOutline, closeOutline })
    // the library of the shown tabs (the lists the start page keeps: no new lookups at Spotify)
    this.http
      .get<MupiboxConfig>(`${environment.backend.apiUrl}/config`)
      .pipe(
        catchError(() => of(undefined)),
        takeUntilDestroyed(),
      )
      .subscribe((config) => {
        const hidden = config?.mupibox?.hiddenCategories ?? []
        const categories = SEARCHED.filter((c) => !hidden.includes(c))
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
        if (!categories.length) this.loading.set(false)
      })
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
    if (hit.artist) {
      this.openArtist(hit.artist, hit.category)
    } else if (hit.media) {
      this.openMedia(hit.media)
    }
  }

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
