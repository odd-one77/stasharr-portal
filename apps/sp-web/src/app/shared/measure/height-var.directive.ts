import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject, input } from '@angular/core';

// Publishes the host element's rendered height (px) as a CSS custom property
// on its parent, so siblings can size themselves from it in pure CSS (e.g.
// sticky offsets) without any per-scroll script work -- it only updates when
// the host actually resizes.
@Directive({
  selector: '[appHeightVar]',
})
export class HeightVarDirective implements OnInit, OnDestroy {
  readonly appHeightVar = input.required<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private observer: ResizeObserver | null = null;

  ngOnInit(): void {
    const element = this.host.nativeElement;
    const target = element.parentElement;
    if (!target || typeof ResizeObserver === 'undefined') {
      return;
    }

    const publish = (): void => {
      target.style.setProperty(this.appHeightVar(), `${element.offsetHeight}px`);
    };

    this.zone.runOutsideAngular(() => {
      this.observer = new ResizeObserver(publish);
      this.observer.observe(element);
    });
    publish();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
