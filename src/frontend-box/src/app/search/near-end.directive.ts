import { Directive, ElementRef, inject, type OnDestroy, output } from '@angular/core'

// (fork "wishes") Put on an empty element at the end of a list: tells when it comes into view - the child scrolled to
// the end of the hits - so the next page is asked only then (search › wishes from Spotify).
@Directive({ selector: '[mupiNearEnd]' })
export class NearEndDirective implements OnDestroy {
  readonly mupiNearEnd = output<void>()
  private readonly observer: IntersectionObserver

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement
    // (a little before it is in view: the next covers are there when the child gets to the end)
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) this.mupiNearEnd.emit()
      },
      { rootMargin: '0px 160px 160px 0px' },
    )
    this.observer.observe(el)
  }

  ngOnDestroy(): void {
    this.observer.disconnect()
  }
}
