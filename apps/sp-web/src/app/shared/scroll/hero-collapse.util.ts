import { NgZone } from '@angular/core';

// Scroll-driven "collapsing hero" pages (scene/performer/studio) drive a
// --hero-collapse CSS variable (0..1) from how far the page has scrolled
// past the point where the sticky header pins to the top.
//
// The header shrinks by a known amount (the "shrink distance", resolved from
// CSS via the .hero-shrink-probe element so rem values and breakpoints are
// honoured), and the page scrolls 1:1 with that shrink: scrolling N px
// shrinks the header by N px. A spacer (margin-bottom on the sticky header,
// growing by the same amount the header shrinks) keeps the total flow height
// constant, so the content below scrolls natively -- attached to the bar's
// bottom edge during the collapse, and under the finished bar afterwards --
// with no script-driven content movement to jitter against the scroll.
export function measureHeroCollapse(host: HTMLElement): number {
  const sentinel = host.querySelector('.hero-sentinel');
  const probe = host.querySelector<HTMLElement>('.hero-shrink-probe');
  if (!sentinel || !probe) {
    return 0;
  }

  const shrinkPx = probe.offsetHeight;
  if (shrinkPx <= 0) {
    return 0;
  }

  const startOffset = sentinel.getBoundingClientRect().top + window.scrollY;
  return Math.min(1, Math.max(0, (window.scrollY - startOffset) / shrinkPx));
}

// Listens for scroll/resize/host-size changes outside Angular, coalesces them
// to one measurement per animation frame, and only re-enters Angular (once)
// when the progress value actually changed. Returns a teardown function.
export function observeHeroCollapse(
  host: HTMLElement,
  zone: NgZone,
  onChange: (progress: number) => void,
): () => void {
  let frame = 0;
  let last = Number.NaN;

  const update = (): void => {
    frame = 0;
    const next = measureHeroCollapse(host);
    if (next === last) {
      return;
    }

    last = next;
    zone.run(() => onChange(next));
  };

  const schedule = (): void => {
    if (frame === 0) {
      frame = requestAnimationFrame(update);
    }
  };

  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);

  zone.runOutsideAngular(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    resizeObserver?.observe(host);
  });
  schedule();

  return () => {
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    resizeObserver?.disconnect();
    if (frame !== 0) {
      cancelAnimationFrame(frame);
    }
  };
}
