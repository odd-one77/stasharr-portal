import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { PlayerService } from '../../core/player/player.service';
import { SceneDetails } from '../../core/api/discover.types';
import { ScenePageComponent } from './scene-page.component';

function buildScene(overrides: Partial<SceneDetails> = {}): SceneDetails {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/image.jpg',
    images: [],
    studioId: 'studio-1',
    studioIsFavorite: false,
    studio: 'Studio',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    studioUrl: 'http://studio.local',
    releaseDate: '2026-03-01',
    duration: 600,
    tags: [],
    performers: [],
    sourceUrls: [],
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    stash: null,
    whisparr: null,
    ...overrides,
  };
}

describe('ScenePageComponent', () => {
  async function renderScene(scene: SceneDetails) {
    const discoverService = {
      getSceneDetails: vi.fn().mockReturnValue(of(scene)),
      getSceneStreamUrl: vi.fn().mockReturnValue(
        of({
          streamUrl: 'http://stash.local/stream?apikey=secret',
          stashSceneId: 'stash-scene-1',
          resumeSeconds: 0,
          duration: 600,
        }),
      ),
    };
    const activatedRoute = {
      paramMap: of(convertToParamMap({ stashId: scene.id })),
      queryParamMap: of(convertToParamMap({})),
      snapshot: {
        paramMap: convertToParamMap({ stashId: scene.id }),
      },
    };

    const playerService = {
      openByCatalogSceneId: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ScenePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoverService,
          useValue: discoverService,
        },
        {
          provide: AppNotificationsService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          },
        },
        {
          provide: PlayerService,
          useValue: playerService,
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRoute,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ScenePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService, playerService };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows failed guidance, keeps the Whisparr link, and hides the request button for failed scenes', async () => {
    const scene = buildScene({
      status: { state: 'FAILED' },
      whisparr: {
        exists: true,
        viewUrl: 'http://whisparr.local/movie/scene-1',
      },
    });

    const { fixture, discoverService } = await renderScene(scene);
    const text = fixture.nativeElement.textContent;

    expect(discoverService.getSceneDetails).toHaveBeenCalledWith('scene-1');
    expect(text).toContain('Resolve or retry this download in Whisparr.');
    expect(text).not.toContain('Retry in Whisparr');
    expect(fixture.nativeElement.querySelector('.request-button')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('a[href="http://whisparr.local/movie/scene-1"]')
        ?.textContent,
    ).toContain('View in Whisparr');
  });

  it('keeps the normal request CTA for NOT_REQUESTED scenes', async () => {
    const { fixture } = await renderScene(buildScene());

    expect(fixture.nativeElement.textContent).toContain('Request in Whisparr');
  });

  it('opens the embedded player for the linked stash copy', async () => {
    const scene = buildScene({
      stash: {
        exists: true,
        hasMultipleCopies: false,
        copies: [
          {
            id: 'stash-scene-1',
            viewUrl: 'http://stash.local/scenes/stash-scene-1',
            width: 1920,
            height: 1080,
            label: '1080p',
          },
        ],
      },
    });

    const { fixture, playerService } = await renderScene(scene);

    const playButton = fixture.nativeElement.querySelector(
      'button.play-action',
    ) as HTMLButtonElement;
    expect(playButton).not.toBeNull();

    playButton.click();
    await fixture.whenStable();

    expect(playerService.openByCatalogSceneId).toHaveBeenCalledWith({
      title: 'Scene Title',
      catalogStashId: 'scene-1',
      copyId: 'stash-scene-1',
    });
  });
});
