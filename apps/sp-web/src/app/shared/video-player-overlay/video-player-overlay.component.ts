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

    this.startProgressSaveInterval();
  }

  protected onVideoPause(): void {
    this.saveCurrentProgress();
  }

  protected closePlayer(): void {
    this.saveCurrentProgress();
    this.stopProgressSaveInterval();
    this.playerService.close();
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
