import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
} from '@angular/core';
import { ButtonDirective } from 'primeng/button';
import { ProgressSpinner } from 'primeng/progressspinner';
import { PlayerService } from '../../core/player/player.service';

@Component({
  selector: 'app-video-player-overlay',
  imports: [ButtonDirective, ProgressSpinner],
  templateUrl: './video-player-overlay.component.html',
  styleUrl: './video-player-overlay.component.scss',
})
export class VideoPlayerOverlayComponent {
  private readonly playerService = inject(PlayerService);

  private static readonly PROGRESS_SAVE_INTERVAL_MS = 20_000;
  private progressSaveInterval: ReturnType<typeof setInterval> | null = null;

  @ViewChild('videoEl') private videoElRef?: ElementRef<HTMLVideoElement>;

  protected readonly state = this.playerService.state;

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.state()) {
      this.closePlayer();
    }
  }

  protected onVideoLoadedMetadata(): void {
    const current = this.state();
    const video = this.videoElRef?.nativeElement;
    if (current?.status !== 'ready' || !video) {
      return;
    }

    const resumeSeconds = current.source.resumeSeconds;
    if (resumeSeconds > 0 && resumeSeconds < video.duration) {
      video.currentTime = resumeSeconds;
    }

    video.play().catch(() => {
      // Autoplay can be blocked by the browser; the user can press play.
    });

    this.updateMediaSessionMetadata(current.title, current.imageUrl);
    this.startProgressSaveInterval();
  }

  protected onVideoPlay(): void {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  }

  protected onVideoPause(): void {
    this.saveCurrentProgress();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }

  protected closePlayer(): void {
    this.saveCurrentProgress();
    this.stopProgressSaveInterval();
    this.playerService.close();
    this.clearMediaSessionMetadata();
  }

  // Sizes iOS/Android/desktop commonly probe for when picking a "now
  // playing" artwork entry. The real thumbnail is rarely any of these
  // exact dimensions (scene screenshots are landscape, arbitrary sizes),
  // but declaring the same URL under several common square hints is the
  // standard workaround -- the OS still just fetches and scales the image,
  // this only affects which array entry it decides to request.
  private static readonly ARTWORK_SIZES = ['96x96', '192x192', '256x256', '384x384', '512x512'];

  // Drives the OS/browser "now playing" surface (iOS Control Center/lock
  // screen, AirPlay's now-playing overlay, Android notification, desktop
  // media keys, etc.) so it shows the actual scene title and thumbnail
  // instead of just the page title.
  private updateMediaSessionMetadata(title: string, imageUrl: string | null): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artwork: imageUrl
        ? VideoPlayerOverlayComponent.ARTWORK_SIZES.map((sizes) => ({ src: imageUrl, sizes }))
        : [],
    });
    navigator.mediaSession.playbackState = 'playing';
    this.registerMediaSessionActionHandlers();
  }

  // WebKit/iOS only treats a page as a fully integrated media session --
  // showing our custom title/artwork on the lock screen, Control Center,
  // and AirPlay's now-playing overlay -- once play/pause/seek handlers are
  // registered. Without these it can fall back to a generic identity (the
  // browser engine's own name) instead of the metadata set above.
  private registerMediaSessionActionHandlers(): void {
    const session = navigator.mediaSession;

    session.setActionHandler('play', () => {
      this.videoElRef?.nativeElement.play().catch(() => undefined);
    });
    session.setActionHandler('pause', () => {
      this.videoElRef?.nativeElement.pause();
    });
    session.setActionHandler('seekto', (details) => {
      const video = this.videoElRef?.nativeElement;
      if (video && typeof details.seekTime === 'number') {
        video.currentTime = details.seekTime;
      }
    });
    session.setActionHandler('seekbackward', (details) => {
      const video = this.videoElRef?.nativeElement;
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - (details.seekOffset ?? 10));
      }
    });
    session.setActionHandler('seekforward', (details) => {
      const video = this.videoElRef?.nativeElement;
      if (video) {
        video.currentTime = Math.min(
          video.duration || Infinity,
          video.currentTime + (details.seekOffset ?? 10),
        );
      }
    });
  }

  private clearMediaSessionMetadata(): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    const session = navigator.mediaSession;
    session.metadata = null;
    session.playbackState = 'none';
    session.setActionHandler('play', null);
    session.setActionHandler('pause', null);
    session.setActionHandler('seekto', null);
    session.setActionHandler('seekbackward', null);
    session.setActionHandler('seekforward', null);
  }

  private startProgressSaveInterval(): void {
    this.stopProgressSaveInterval();
    this.progressSaveInterval = setInterval(() => {
      this.saveCurrentProgress();
    }, VideoPlayerOverlayComponent.PROGRESS_SAVE_INTERVAL_MS);
  }

  private stopProgressSaveInterval(): void {
    if (this.progressSaveInterval !== null) {
      clearInterval(this.progressSaveInterval);
      this.progressSaveInterval = null;
    }
  }

  private saveCurrentProgress(): void {
    const current = this.state();
    const video = this.videoElRef?.nativeElement;
    if (current?.status !== 'ready' || !video) {
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : null;
    this.playerService.saveProgress(
      current.source.stashSceneId,
      video.currentTime,
      duration,
    );
  }
}
