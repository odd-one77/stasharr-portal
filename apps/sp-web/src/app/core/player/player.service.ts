import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';
import { DiscoverService } from '../api/discover.service';
import { ScenePlaybackSource } from '../api/discover.types';

export type PlayerState =
  | { status: 'loading'; title: string; imageUrl: string | null }
  | { status: 'error'; title: string; imageUrl: string | null; message: string }
  | {
      status: 'ready';
      title: string;
      imageUrl: string | null;
      source: ScenePlaybackSource;
    };

interface ScenePlaybackInfo {
  resumeSeconds: number;
  duration: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class PlayerService {
  private readonly http = inject(HttpClient);
  private readonly discoverService = inject(DiscoverService);

  // Guards against a slow/late response from a previous open() overwriting
  // state after the player was closed or a different scene was opened.
  private requestToken = 0;

  readonly state = signal<PlayerState | null>(null);

  openByCatalogSceneId(params: {
    title: string;
    catalogStashId: string;
    copyId?: string;
    imageUrl?: string | null;
  }): void {
    const imageUrl = params.imageUrl ?? null;
    const token = this.beginLoad(params.title, imageUrl);

    this.discoverService
      .getSceneStreamUrl(params.catalogStashId, params.copyId)
      .subscribe({
        next: (source) => this.applySource(token, params.title, imageUrl, source),
        error: () =>
          this.applyError(
            token,
            params.title,
            imageUrl,
            'Failed to load stream from Stash.',
          ),
      });
  }

  openByLocalSceneId(params: {
    title: string;
    localSceneId: string;
    imageUrl?: string | null;
  }): void {
    const imageUrl = params.imageUrl ?? null;
    const token = this.beginLoad(params.title, imageUrl);
    const streamUrl = `/api/media/stash/scenes/${encodeURIComponent(params.localSceneId)}/stream`;

    this.getScenePlaybackInfo(params.localSceneId)
      .pipe(
        catchError(() => of<ScenePlaybackInfo>({ resumeSeconds: 0, duration: null })),
      )
      .subscribe((info) => {
        this.applySource(token, params.title, imageUrl, {
          streamUrl,
          stashSceneId: params.localSceneId,
          resumeSeconds: info.resumeSeconds,
          duration: info.duration,
        });
      });
  }

  close(): void {
    this.requestToken += 1;
    this.state.set(null);
  }

  saveProgress(
    stashSceneId: string,
    resumeSeconds: number,
    playDuration: number | null,
  ): void {
    if (!Number.isFinite(resumeSeconds) || resumeSeconds < 0) {
      return;
    }

    this.http
      .post<void>(
        `/api/media/stash/scenes/${encodeURIComponent(stashSceneId)}/progress`,
        {
          resumeSeconds,
          ...(playDuration !== null ? { playDuration } : {}),
        },
      )
      .pipe(catchError(() => of(undefined)))
      .subscribe();
  }

  private getScenePlaybackInfo(
    localSceneId: string,
  ): Observable<ScenePlaybackInfo> {
    return this.http.get<ScenePlaybackInfo>(
      `/api/media/stash/scenes/${encodeURIComponent(localSceneId)}/playback-info`,
    );
  }

  private beginLoad(title: string, imageUrl: string | null): number {
    this.requestToken += 1;
    const token = this.requestToken;
    this.state.set({ status: 'loading', title, imageUrl });
    return token;
  }

  private applySource(
    token: number,
    title: string,
    imageUrl: string | null,
    source: ScenePlaybackSource,
  ): void {
    if (token !== this.requestToken) {
      return;
    }

    this.state.set({ status: 'ready', title, imageUrl, source });
  }

  private applyError(
    token: number,
    title: string,
    imageUrl: string | null,
    message: string,
  ): void {
    if (token !== this.requestToken) {
      return;
    }

    this.state.set({ status: 'error', title, imageUrl, message });
  }
}
