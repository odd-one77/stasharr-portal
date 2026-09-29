// Scroll-driven "collapsing hero" pages (scene/performer/studio) drive
// their --hero-collapse CSS variable off a fixed pixel scroll distance.
// That breaks on a tall/desktop viewport with comparatively little page
// content: if the page can't actually be scrolled that far, the hero gets
// stuck permanently half-collapsed instead of ever reaching a clean rest
// or fully-collapsed state. Capping the distance to however far the page
// can actually scroll means reaching the bottom always means "fully
// collapsed", regardless of how short that range is.
export function computeHeroCollapseProgress(baseDistance: number): number {
  const maxScrollable = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const effectiveDistance = maxScrollable > 0 ? Math.min(baseDistance, maxScrollable) : baseDistance;

  return Math.min(1, Math.max(0, window.scrollY / effectiveDistance));
}
