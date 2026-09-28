import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { DiscoverItem, PerformerDetails } from '../../core/api/discover.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import { PerformerPageComponent } from './performer-page.component';

function buildPerformer(overrides: Partial<PerformerDetails> = {}): PerformerDetails {
  return {
    id: 'performer-1',
    name: 'Performer One',
    disambiguation: null,
    aliases: [],
    gender: 'FEMALE',
    birthDate: null,
    deathDate: null,
    age: 28,
    ethnicity: null,
    country: 'US',
    eyeColor: null,
    hairColor: null,
    height: null,
    cupSize: null,
    bandSize: null,
    waistSize: null,
    hipSize: null,
    breastType: null,
    careerStartYear: null,
    careerEndYear: null,
    deleted: false,
    mergedIds: [],
    mergedIntoId: null,
    isFavorite: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-03-01',
    imageUrl: 'http://cdn.local/performer.jpg',
    images: [],
    ...overrides,
  };
}

function buildScene(overrides: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: 'scene-1',
    title: 'Performer Scene',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/scene.jpg',
    cardImageUrl: 'http://cdn.local/scene-card.jpg',
    studioId: 'studio-1',
    studio: 'Studio One',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-20',
    duration: 1800,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    ...overrides,
  };
}

describe('PerformerPageComponent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function renderPage(options?: { items?: DiscoverItem[]; performer?: PerformerDetails }) {
    const items = options?.items ?? [buildScene()];
    const paramMap$ = new BehaviorSubject(convertToParamMap({ performerId: 'performer-1' }));
    const queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    const discoverService = {
      getPerformerDetails: options?.performer
        ? vi.fn().mockReturnValue(of(options.performer))
        : vi.fn().mockReturnValue(of(buildPerformer())),
      getPerformerScenesFeed: vi.fn().mockReturnValue(
        of({
          total: items.length,
          page: 1,
          perPage: 24,
          hasMore: false,
          items,
        }),
      ),
      searchPerformerStudios: vi.fn().mockReturnValue(of([])),
      searchSceneTags: vi.fn().mockReturnValue(of([])),
      setPerformerMainImage: vi.fn(),
    };
    const notifications = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [PerformerPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoverService,
          useValue: discoverService,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParamMap: queryParamMap$.asObservable(),
          },
        },
        {
          provide: AppNotificationsService,
          useValue: notifications,
        },
        {
          provide: SceneQuickRequestService,
          useValue: { tryQuickRequest: vi.fn().mockReturnValue(of({ submitted: false })) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PerformerPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService, notifications };
  }

  it('renders performer scenes with the shared scene card and keeps request handling on the page', async () => {
    const { fixture } = await renderPage();
    const component = fixture.componentInstance as any;
    const cards = fixture.nativeElement.querySelectorAll('app-scene-card');
    const requestButton = fixture.nativeElement.querySelector('.request-cta') as
      | HTMLButtonElement
      | null;

    expect(cards).toHaveLength(1);
    expect(component.requestModalOpen()).toBe(false);

    requestButton?.click();

    expect(component.requestModalOpen()).toBe(true);
    expect(component.requestContext()).toEqual({
      id: 'scene-1',
      title: 'Performer Scene',
      imageUrl: 'http://cdn.local/scene.jpg',
    });
  });

  it('labels the picker button "Select main photo" when there are 4 or fewer images', async () => {
    const performer = buildPerformer({
      images: [
        { id: 'image', url: 'http://cdn.local/performer.jpg', width: null, height: null },
        { id: 'poster-1', url: 'http://cdn.local/poster-1.jpg', width: null, height: null },
      ],
    });
    const { fixture } = await renderPage({ performer });

    const button = fixture.nativeElement.querySelector('.set-main-image') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Select main photo');
  });

  it('caps the preview strip at 4 images and labels the button "View more" beyond that', async () => {
    const performer = buildPerformer({
      images: Array.from({ length: 6 }, (_, i) => ({
        id: `image-${i}`,
        url: `http://cdn.local/image-${i}.jpg`,
        width: null,
        height: null,
      })),
    });
    const { fixture } = await renderPage({ performer });

    const thumbs = fixture.nativeElement.querySelectorAll('.carousel-thumbs .thumb');
    const button = fixture.nativeElement.querySelector('.set-main-image') as HTMLButtonElement;
    expect(thumbs).toHaveLength(4);
    expect(button.textContent?.trim()).toBe('View more');
  });

  it('opens the picker popup when the button is clicked', async () => {
    const performer = buildPerformer({
      images: [
        { id: 'image', url: 'http://cdn.local/performer.jpg', width: null, height: null },
      ],
    });
    const { fixture } = await renderPage({ performer });
    const component = fixture.componentInstance as any;

    expect(component.mainImagePickerOpen()).toBe(false);
    (fixture.nativeElement.querySelector('.set-main-image') as HTMLButtonElement).click();

    expect(component.mainImagePickerOpen()).toBe(true);
  });

  it('sets the selected image as main and closes the popup', async () => {
    const performer = buildPerformer({
      images: [
        { id: 'image', url: 'http://cdn.local/performer.jpg', width: null, height: null },
        { id: 'poster-1', url: 'http://cdn.local/poster-1.jpg', width: null, height: null },
      ],
    });
    const { fixture, discoverService, notifications } = await renderPage({ performer });
    (discoverService.setPerformerMainImage as ReturnType<typeof vi.fn>).mockReturnValue(
      of({ ...performer, imageUrl: 'http://cdn.local/poster-1.jpg' }),
    );
    const component = fixture.componentInstance as any;
    component.openMainImagePicker();

    component.selectMainImage('http://cdn.local/poster-1.jpg');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(discoverService.setPerformerMainImage).toHaveBeenCalledWith(
      'performer-1',
      'http://cdn.local/poster-1.jpg',
    );
    expect(notifications.success).toHaveBeenCalled();
    expect(component.mainImagePickerOpen()).toBe(false);
  });

  it('does not resubmit when selecting the image that is already the main image', async () => {
    const performer = buildPerformer({
      imageUrl: 'http://cdn.local/performer.jpg',
      images: [
        { id: 'image', url: 'http://cdn.local/performer.jpg', width: null, height: null },
      ],
    });
    const { fixture, discoverService } = await renderPage({ performer });
    const component = fixture.componentInstance as any;

    component.selectMainImage('http://cdn.local/performer.jpg');

    expect(discoverService.setPerformerMainImage).not.toHaveBeenCalled();
  });

  it('filters to library-only scenes when the toggle is enabled', async () => {
    const { fixture } = await renderPage({
      items: [
        buildScene({ id: 'scene-library', status: { state: 'AVAILABLE' } }),
        buildScene({ id: 'scene-not-library', status: { state: 'NOT_REQUESTED' } }),
      ],
    });
    const component = fixture.componentInstance as any;

    expect(fixture.nativeElement.querySelectorAll('app-scene-card')).toHaveLength(2);

    component.onLibraryOnlyChanged(true);
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('app-scene-card');
    expect(cards).toHaveLength(1);
    expect(component.displayedScenes()).toEqual([
      expect.objectContaining({ id: 'scene-library' }),
    ]);

    component.onLibraryOnlyChanged(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('app-scene-card')).toHaveLength(2);
  });
});
