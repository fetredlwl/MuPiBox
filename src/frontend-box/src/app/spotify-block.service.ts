import { HttpClient } from '@angular/common/http'
import { Injectable, inject, signal } from '@angular/core'
import { environment } from '../environments/environment'
import type { Media } from './media'

// (fork "wishes") Spotify's block of the box, for the display: catalog - nothing new from Spotify (the search's lists,
// albums not loaded yet), but what is on the start page plays; player - Spotify does not play either (its tiles grey,
// a tap tells why). Asked every minute from the backend (GET /api/spotify-block, no request to Spotify), and at once
// when the player refused a start.
@Injectable({ providedIn: 'root' })
export class SpotifyBlockService {
  private readonly http = inject(HttpClient)
  readonly catalog = signal(false)
  readonly player = signal(false)
  /** a tap on something of Spotify while it does not play: the note is shown for a moment (SpotifyPauseComponent) */
  readonly told = signal(false)
  /** what the note says: Spotify does not play, or (a search on Spotify) it answers nothing new now */
  readonly toldWhat = signal<'player' | 'catalog'>('player')
  private toldTimer?: number

  constructor() {
    this.refresh()
    window.setInterval(() => this.refresh(), 60_000)
  }

  refresh(): Promise<void> {
    return new Promise((resolve) =>
      this.http.get<{ catalog?: boolean; player?: boolean }>(`${environment.backend.apiUrl}/spotify-block`).subscribe({
        next: (b) => {
          this.catalog.set(b?.catalog === true)
          this.player.set(b?.player === true)
          resolve()
        },
        // (the backend not reachable: as it was)
        error: () => resolve(),
      }),
    )
  }

  /** asked anew, and the note shown when Spotify does not play now (the search, as it opens) */
  tellIfBlocked(): void {
    void this.refresh().then(() => {
      if (this.player()) this.tell()
    })
  }

  /** whether this does not play now (Spotify blocks the player too) */
  blocks(media: Pick<Media, 'type'> | undefined | null): boolean {
    return this.player() && media?.type === 'spotify'
  }

  /** the note "Spotify geht gerade nicht – Radio und Podcasts gehen" for a few seconds */
  tell(what: 'player' | 'catalog' = 'player'): void {
    this.toldWhat.set(what)
    this.told.set(true)
    window.clearTimeout(this.toldTimer)
    this.toldTimer = window.setTimeout(() => this.told.set(false), 6000)
  }
}
