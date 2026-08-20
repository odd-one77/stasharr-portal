import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SceneRequestContext } from '../../core/api/discover.types';
import { SceneCardComponent, SceneCardItem } from './scene-card.component';

function buildSceneCardItem(overrides: Partial<SceneCardItem> = {}): SceneCardItem {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    imageUrl: 'http://cdn.local/image.jpg',
    cardImageUrl: 'http://cdn.local/card.jpg',
    studioId: 'studio-1',
    studio: 'Studio One',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-28',
    status: { state: 'NOT_REQUESTED' },
    ...overrides,
  };
}

describe('SceneCardComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderCard() {
    await TestBed.configureTestingModule({
      imports: [SceneCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(SceneCardComponent);

    return { fixture, component: fixture.componentInstance };
  }

  it('renders the canonical discovery card with an internal scene link, studio filter badge, and request event', async () => {
    const { fixture, component } = await renderCard();
    const emitted: SceneRequestContext[] = [];
    component.item = buildSceneCardItem();
    component.requestable = true;
    component.sceneQueryParams = { returnTo: '/scenes' };
    component.studioBadgeRoute = 'scenes';
    component.request.subscribe((item) => emitted.push(item));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sceneLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const studioBadgeLink = fixture.nativeElement.querySelector(
      '.studio-badge-link',
    ) as HTMLAnchorElement | null;
    const requestButton = fixture.nativeElement.querySelector(
      '.request-cta',
    ) as HTMLButtonElement | null;

    expect(sceneLink?.getAttribute('href')).toContain('/scene/scene-1');
    expect(sceneLink?.getAttribute('href')).toContain('returnTo=%2Fscenes');
    expect(studioBadgeLink?.getAttribute('href')).toContain('/scenes');
    expect(studioBadgeLink?.getAttribute('href')).toContain('studios=studio-1');
    expect(studioBadgeLink?.getAttribute('href')).toContain('studioNames=Studio%20One');
    expect(requestButton?.textContent?.trim()).toBe('Request');

    requestButton?.click();

    expect(emitted).toEqual([
      {
        id: 'scene-1',
        title: 'Scene Title',
        imageUrl: 'http://cdn.local/image.jpg',
      },
    ]);
  });

  it('renders status-driven external cards without the request CTA', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({
      status: { state: 'AVAILABLE' },
      studioImageUrl: null,
    });
    component.requestable = false;
    component.variant = 'rail';
    component.primaryLinkMode = 'external';
    component.externalHref = 'http://stash.local/scenes/scene-1';

    fixture.detectChanges();

    const sceneLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const requestButton = fixture.nativeElement.querySelector('.request-cta');
    const footerStatusBadge = fixture.nativeElement.querySelector('.footer-status-badge');
    const statusIcon = fixture.nativeElement.querySelector('.status-icon');
    const host = fixture.nativeElement as HTMLElement;

    expect(host.classList.contains('scene-card-variant-rail')).toBe(true);
    expect(sceneLink?.getAttribute('href')).toBe('http://stash.local/scenes/scene-1');
    expect(requestButton).toBeNull();
    expect(footerStatusBadge).toBeTruthy();
    expect(statusIcon).toBeTruthy();
  });

  it('shows a play CTA instead of the status badge for playable available scenes', async () => {
    const { fixture, component } = await renderCard();
    const emitted: string[] = [];
    component.item = buildSceneCardItem({ status: { state: 'AVAILABLE' } });
    component.requestable = false;
    component.playable = true;
    component.play.subscribe((id) => emitted.push(id));

    fixture.detectChanges();

    const playButton = fixture.nativeElement.querySelector(
      '.play-cta',
    ) as HTMLButtonElement | null;
    const footerStatusBadge = fixture.nativeElement.querySelector('.footer-status-badge');

    expect(playButton?.textContent?.trim()).toContain('Play');
    expect(footerStatusBadge).toBeNull();

    playButton?.click();

    expect(emitted).toEqual(['scene-1']);
  });

  it('makes the whole card the play trigger when playSize is large, with a decorative icon and no compact CTA', async () => {
    const { fixture, component } = await renderCard();
    const emitted: string[] = [];
    component.item = buildSceneCardItem({ status: { state: 'AVAILABLE' } });
    component.requestable = false;
    component.playable = true;
    component.playSize = 'large';
    component.play.subscribe((id) => emitted.push(id));

    fixture.detectChanges();

    const cardButton = fixture.nativeElement.querySelector(
      'button.media-link-stretch',
    ) as HTMLButtonElement | null;
    const decorativeIcon = fixture.nativeElement.querySelector('.play-center-icon');
    const compactButton = fixture.nativeElement.querySelector('.play-cta');

    expect(cardButton).toBeTruthy();
    expect(decorativeIcon).toBeTruthy();
    expect(compactButton).toBeNull();

    cardButton?.click();

    expect(emitted).toEqual(['scene-1']);
  });

  it('shows a secondary info link to scene details when playSize is large', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({ status: { state: 'AVAILABLE' } });
    component.requestable = false;
    component.playable = true;
    component.playSize = 'large';

    fixture.detectChanges();

    const infoLink = fixture.nativeElement.querySelector(
      '.info-link',
    ) as HTMLAnchorElement | null;

    expect(infoLink?.getAttribute('href')).toContain('/scene/scene-1');
  });

  it('does not show a play CTA for playable non-available scenes', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({ status: { state: 'DOWNLOADING' } });
    component.requestable = false;
    component.playable = true;

    fixture.detectChanges();

    const playButton = fixture.nativeElement.querySelector('.play-cta');
    const footerStatusBadge = fixture.nativeElement.querySelector('.footer-status-badge');

    expect(playButton).toBeNull();
    expect(footerStatusBadge).toBeTruthy();
  });

  it('supports compact library cards with a scene-details primary link and stash footer action', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({
      id: 'local-scene-411',
      status: null,
    });
    component.primaryLinkMode = 'scene';
    component.sceneRouteId = 'catalog-scene-411';
    component.sceneQueryParams = { returnTo: '/library' };
    component.studioBadgeRoute = 'library';
    component.topBadges = [{ label: 'Local' }];
    component.footerLinkLabel = 'View in Stash';
    component.footerLink = {
      kind: 'external',
      href: 'http://stash.local/scenes/411',
      ariaLabel: 'View Scene Title in Stash',
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sceneLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const studioBadgeLink = fixture.nativeElement.querySelector(
      '.studio-badge-link',
    ) as HTMLAnchorElement | null;
    const topBadge = fixture.nativeElement.querySelector('.top-badge') as HTMLElement | null;
    const footerLink = fixture.nativeElement.querySelector(
      '.footer-link',
    ) as HTMLAnchorElement | null;

    expect(sceneLink?.getAttribute('href')).toContain('/scene/catalog-scene-411');
    expect(sceneLink?.getAttribute('href')).toContain('returnTo=%2Flibrary');
    expect(studioBadgeLink?.getAttribute('href')).toContain('/library');
    expect(topBadge?.textContent?.trim()).toBe('Local');
    expect(footerLink?.getAttribute('href')).toBe('http://stash.local/scenes/411');
  });

  it('renders a compact footer badge for local-only library cards', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({
      id: 'local-only-512',
      status: null,
      studioImageUrl: null,
    });
    component.primaryLinkMode = 'external';
    component.externalHref = 'http://stash.local/scenes/512';
    component.topBadges = [{ label: 'Local' }];
    component.footerBadgeLabel = 'Local only';

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sceneLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const footerBadge = fixture.nativeElement.querySelector('.footer-pill') as HTMLElement | null;
    const footerStatusBadge = fixture.nativeElement.querySelector('.footer-status-badge');

    expect(sceneLink?.getAttribute('href')).toBe('http://stash.local/scenes/512');
    expect(footerBadge?.textContent?.trim()).toBe('Local only');
    expect(footerStatusBadge).toBeNull();
  });

  it('shows a compact play icon alongside the stash footer link for playable library cards', async () => {
    const { fixture, component } = await renderCard();
    const emitted: string[] = [];
    component.item = buildSceneCardItem({ id: 'local-scene-411', status: null });
    component.footerLinkLabel = 'View in Stash';
    component.footerLink = {
      kind: 'external',
      href: 'http://stash.local/scenes/411',
      ariaLabel: 'View Scene Title in Stash',
    };
    component.playable = true;
    component.play.subscribe((id) => emitted.push(id));

    fixture.detectChanges();

    const playButton = fixture.nativeElement.querySelector(
      '.play-cta',
    ) as HTMLButtonElement | null;
    const footerLink = fixture.nativeElement.querySelector('.footer-link');

    expect(playButton).toBeTruthy();
    expect(playButton?.classList.contains('play-cta-icon-only')).toBe(true);
    expect(footerLink).toBeTruthy();

    playButton?.click();

    expect(emitted).toEqual(['local-scene-411']);
  });

  it('shows a compact play icon alongside the local-only badge for playable library cards', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({ id: 'local-only-512', status: null });
    component.footerBadgeLabel = 'Local only';
    component.playable = true;

    fixture.detectChanges();

    const playButton = fixture.nativeElement.querySelector(
      '.play-cta',
    ) as HTMLButtonElement | null;
    const footerBadge = fixture.nativeElement.querySelector('.footer-pill');

    expect(playButton).toBeTruthy();
    expect(playButton?.classList.contains('play-cta-icon-only')).toBe(true);
    expect(footerBadge?.textContent?.trim()).toBe('Local only');
  });
});
