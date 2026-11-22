import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core'
import { DisplayTextsService } from '../display-texts.service'
import { SpotifyBlockService } from '../spotify-block.service'

// (fork "wishes") The note while Spotify blocks the box:
//   banner - on a page (search, player) as long as the block lasts: nothing new from Spotify, or Spotify does not play
//            at all; radio and podcasts always go on
//   float  - the same, small at the bottom of the player (over its controls' area only while there is a block)
//   toast  - once in the app (AppComponent): after a tap on something of Spotify that does not play now
@Component({
  selector: 'mupi-spotify-pause',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div class="mupi-spotify-pause" [class.mupi-spotify-pause-toast]="mode() === 'toast'" [class.mupi-spotify-pause-float]="mode() === 'float'" role="status">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></svg>
        <span>{{ text() }}</span>
      </div>
    }
  `,
  styles: `
    .mupi-spotify-pause {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 8px 14px;
      padding: 10px 16px;
      border-radius: 18px;
      background: var(--km-btn, rgba(255, 255, 255, 0.15));
      color: var(--km-on-btn, #fff);
      font-size: 17px;
      font-weight: 600;
      line-height: 1.3;
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
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 1000;
      max-width: min(80vw, 640px);
      margin: 0;
      padding: 22px 28px;
      border-radius: 28px;
      background: var(--km-night, rgba(20, 20, 30, 0.96));
      font-size: 24px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
    }
    .mupi-spotify-pause-float {
      position: fixed;
      left: 50%;
      bottom: 14px;
      transform: translateX(-50%);
      z-index: 500;
      max-width: min(86vw, 720px);
      margin: 0;
      font-size: 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
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
  readonly mode = input<'banner' | 'float' | 'toast'>('banner')

  protected readonly shown = computed(() =>
    this.mode() === 'toast' ? this.block.told() : this.block.catalog() || this.block.player(),
  )
  protected readonly text = computed(() =>
    this.texts.text(this.mode() === 'toast' || this.block.player() ? 'spotifyPausePlayer' : 'spotifyPauseCatalog'),
  )
}
