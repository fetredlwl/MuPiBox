import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core'
import { DisplayTextsService } from '../display-texts.service'
import { SpotifyBlockService } from '../spotify-block.service'

// (fork "wishes") The note when Spotify does not play now (it blocks the player too - with "Kontingente trennen" on,
// a quota block of the catalog does not: the box plays on and the child sees nothing). Never for a block that changes
// nothing for the child.
//   toast - once in the app (AppComponent), a popup for a few seconds: after a tap on something of Spotify, and when
//           the search opens - the pages keep their room
//   float - small at the bottom of the player while something of Spotify is open there
@Component({
  selector: 'mupi-spotify-pause',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div class="mupi-spotify-pause" [class.mupi-spotify-pause-toast]="mode() === 'toast'" role="status">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></svg>
        <span>{{ text() }}</span>
      </div>
    }
  `,
  styles: `
    .mupi-spotify-pause {
      position: fixed;
      left: 50%;
      bottom: 14px;
      transform: translateX(-50%);
      z-index: 500;
      max-width: min(86vw, 720px);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border-radius: 18px;
      background: var(--km-night, rgba(20, 20, 30, 0.96));
      color: var(--km-on-btn, #fff);
      font-size: 16px;
      font-weight: 600;
      line-height: 1.3;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      pointer-events: none;
    }
    svg {
      flex: 0 0 28px;
      width: 28px;
      height: 28px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
    }
    .mupi-spotify-pause-toast {
      top: 50%;
      bottom: auto;
      transform: translate(-50%, -50%);
      z-index: 1000;
      max-width: min(80vw, 640px);
      padding: 22px 28px;
      border-radius: 28px;
      font-size: 24px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
    }
    .mupi-spotify-pause-toast svg {
      flex-basis: 40px;
      width: 40px;
      height: 40px;
    }
  `,
})
export class SpotifyPauseComponent {
  private readonly block = inject(SpotifyBlockService)
  private readonly texts = inject(DisplayTextsService)
  readonly mode = input<'float' | 'toast'>('toast')

  protected readonly shown = computed(() => (this.mode() === 'toast' ? this.block.told() : this.block.player()))
  protected readonly text = computed(() => this.texts.text('spotifyPausePlayer'))
}
