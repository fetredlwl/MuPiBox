// (fork "wishes") Sorting a start page (the start page, the search's start): a bar over the header - back to the usual
// order ("A–Z", asked once more) and "Fertig". The page moves the covers (mupi-swiper sortable / sorting).
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core'
import { DisplayTextsService } from '../display-texts.service'

@Component({
  selector: 'mupi-sort-bar',
  templateUrl: './sort-bar.component.html',
  styleUrls: ['./sort-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SortBarComponent {
  protected readonly texts = inject(DisplayTextsService)
  /** "Fertig" */
  readonly done = output<void>()
  /** "A–Z", said yes to */
  readonly reset = output<void>()
  protected readonly asking = signal(false)

  protected yes(): void {
    this.asking.set(false)
    this.reset.emit()
  }
}
