import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlayerService, PlayerState } from '../../core/player/player.service';
import { VideoPlayerOverlayComponent } from './video-player-overlay.component';

describe('VideoPlayerOverlayComponent', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  let mediaSessionStub: { metadata: unknown; playbackState: string };
  let originalMediaSession: PropertyDescriptor | undefined;
  let originalMediaMetadata: typeof globalThis.MediaMetadata | undefined;

  beforeEach(() => {
    playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    // jsdom implements neither the Media Session API nor MediaMetadata --
    // stub both so the component's real code path (not just the feature
    // guard) is actually exercised.
    mediaSessionStub = { metadata: null, playbackState: 'none' };
    originalMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
    Object.defineProperty(navigator, 'mediaSession', {
      value: mediaSessionStub,
      configurable: true,
    });
    originalMediaMetadata = globalThis.MediaMetadata;
    globalThis.MediaMetadata = class {
      title?: string;
      artwork?: unknown;
      constructor(init: { title?: string; artwork?: unknown }) {
        this.title = init.title;
        this.artwork = init.artwork;
      }
    } as unknown as typeof globalThis.MediaMetadata;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    if (originalMediaSession) {
      Object.defineProperty(navigator, 'mediaSession', originalMediaSession);
    } else {
      delete (navigator as { mediaSession?: unknown }).mediaSession;
    }
    globalThis.MediaMetadata = originalMediaMetadata as typeof globalThis.MediaMetadata;
  });

  async function renderOverlay(initialState: PlayerState | null = null) {
    const state = signal<PlayerState | null>(initialState);
    const playerService = {
      state,
      close: vi.fn(),
      saveProgress: vi.fn(),
      openByCatalogSceneId: vi.fn(),
      openByLocalSceneId: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [VideoPlayerOverlayComponent],
      providers: [{ provide: PlayerService, useValue: playerService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(VideoPlayerOverlayComponent);
    fixture.detectChanges();

    return { fixture, playerService, state };
  }

  it('renders nothing when no scene is open', async () => {
    const { fixture } = await renderOverlay(null);

    expect(fixture.nativeElement.querySelector('.player-backdrop')).toBeNull();
  });

  it('shows a loading spinner with the scene title while resolving', async () => {
    const { fixture } = await renderOverlay({
      status: 'loading',
      title: 'A Scene',
      imageUrl: null,
    });

    expect(fixture.nativeElement.textContent).toContain('A Scene');
    expect(fixture.nativeElement.textContent).toContain('Loading stream');
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
  });

  it('shows the error message when the source failed to load', async () => {
    const { fixture } = await renderOverlay({
      status: 'error',
      title: 'A Scene',
      imageUrl: null,
      message: 'Failed to load stream from Stash.',
    });

    expect(fixture.nativeElement.textContent).toContain('Failed to load stream from Stash.');
  });

  it('renders the video element with the resolved stream once ready', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 30,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video?.src).toBe('http://stash.local/stream');
  });

  it('seeks to the saved resume position once the video metadata loads', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 30,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });

    video.dispatchEvent(new Event('loadedmetadata'));

    expect(video.currentTime).toBe(30);
    expect(playSpy).toHaveBeenCalled();
  });

  it('sets the OS/browser now-playing info to the scene title and thumbnail once metadata loads', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: 'http://cdn.local/a-scene.jpg',
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));

    const metadata = mediaSessionStub.metadata as {
      title: string;
      artwork: Array<{ src: string; sizes: string }>;
    };
    expect(metadata.title).toBe('A Scene');
    expect(metadata.artwork.length).toBeGreaterThan(1);
    expect(metadata.artwork.every((entry) => entry.src === 'http://cdn.local/a-scene.jpg')).toBe(
      true,
    );
    expect(new Set(metadata.artwork.map((entry) => entry.sizes)).size).toBe(
      metadata.artwork.length,
    );
    expect(mediaSessionStub.playbackState).toBe('playing');
  });

  it('omits artwork when the scene has no thumbnail', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(mediaSessionStub.metadata).toMatchObject({ title: 'A Scene', artwork: [] });
  });

  it('reflects pause/resume in the OS playback state', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: 'http://cdn.local/a-scene.jpg',
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 5, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));

    video.dispatchEvent(new Event('pause'));
    expect(mediaSessionStub.playbackState).toBe('paused');

    video.dispatchEvent(new Event('play'));
    expect(mediaSessionStub.playbackState).toBe('playing');
  });

  it('clears the now-playing info when the player is closed', async () => {
    const { fixture, playerService } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: 'http://cdn.local/a-scene.jpg',
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(mediaSessionStub.metadata).not.toBeNull();

    const closeButton = fixture.nativeElement.querySelector(
      '.close-player',
    ) as HTMLButtonElement;
    closeButton.click();

    expect(mediaSessionStub.metadata).toBeNull();
    expect(mediaSessionStub.playbackState).toBe('none');
    expect(playerService.close).toHaveBeenCalled();
  });

  it('does not seek when there is no saved resume position', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });

    video.dispatchEvent(new Event('loadedmetadata'));

    expect(video.currentTime).toBe(0);
  });

  it('saves progress when the video is paused', async () => {
    const { fixture, playerService } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 42, configurable: true });

    video.dispatchEvent(new Event('pause'));

    expect(playerService.saveProgress).toHaveBeenCalledWith('411', 42, 600);
  });

  it('saves progress and closes the player when the close button is clicked', async () => {
    const { fixture, playerService } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 15, configurable: true });

    const closeButton = fixture.nativeElement.querySelector(
      '.close-player',
    ) as HTMLButtonElement;
    closeButton.click();

    expect(playerService.saveProgress).toHaveBeenCalledWith('411', 15, 600);
    expect(playerService.close).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked but not when the player content is clicked', async () => {
    const { fixture, playerService } = await renderOverlay({
      status: 'loading',
      title: 'A Scene',
      imageUrl: null,
    });

    const shell = fixture.nativeElement.querySelector('.player-shell') as HTMLElement;
    shell.click();
    expect(playerService.close).not.toHaveBeenCalled();

    const backdrop = fixture.nativeElement.querySelector('.player-backdrop') as HTMLElement;
    backdrop.click();
    expect(playerService.close).toHaveBeenCalled();
  });
});
