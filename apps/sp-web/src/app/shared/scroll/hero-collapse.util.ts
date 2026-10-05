// Scroll-driven "collapsing hero" pages (scene/performer/studio) drive a
// --hero-collapse CSS variable (0..1) from how far the page has scrolled
// past the point where the sticky header pins to the top.
//
// While the header collapses, the page content must stay attached to the
// header's bottom edge instead of sliding up underneath it, and only start
// scrolling under the (finished) bar afterwards. The collapse itself shrinks
// the header's layout height, and scrolling moves the content up as well --
// so without correction the content moves at both rates at once and ends up
// under the bar. `offsetPx` is exactly how far the page has scrolled during
// the collapse; the content wrapper is pushed back down by that amount
// (position: relative; top: offsetPx), which cancels the scroll movement and
// leaves only the header's own shrink moving the content.
//
// If the page can't actually scroll that far (short content), the distance
// is capped to what's available so reaching the bottom still always means
// "fully collapsed".
export interface HeroCollapseState {
  progress: number;
  offsetPx: number;
}

export function measureHeroStartOffset(host: HTMLElement): number {
  const sentinel = host.querySelector('.hero-sentinel');
  if (!sentinel) {
    return 0;
  }

  return sentinel.getBoundingClientRect().top + window.scrollY;
}

export function computeHeroCollapse(baseDistance: number, startOffset: number): HeroCollapseState {
  const maxScrollable = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const available = maxScrollable - startOffset;
  const distance = available > 0 ? Math.min(baseDistance, available) : baseDistance;
  const offsetPx = Math.min(Math.max(0, window.scrollY - startOffset), distance);

  return { progress: distance > 0 ? offsetPx / distance : 0, offsetPx };
}
