import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StashAdapter, type StashProtectedAssetResponse } from '../providers/stash/stash.adapter';
import { fetchWithTimeout } from '../providers/fetch-with-timeout';
import { PrismaService } from '../prisma/prisma.service';

export interface StashSceneStreamResponse {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stashAdapter: StashAdapter,
  ) {}

  async getStashSceneScreenshot(sceneId: string): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openSceneScreenshot(sceneId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashStudioLogo(studioId: string): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openStudioLogo(studioId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashPerformerPhoto(performerId: string): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openPerformerPhoto(performerId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashGalleryCover(galleryId: string): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openGalleryCover(galleryId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashImageThumbnail(imageId: string): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openImageThumbnail(imageId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashImageFull(imageId: string): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openImageFull(imageId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async streamStashScene(
    sceneId: string,
    rangeHeader?: string,
    headOnly = false,
  ): Promise<StashSceneStreamResponse> {
    const config = await this.getStashConfig();
    const streamUrl = await this.stashAdapter.getSceneStreamUrl(sceneId, config);
    if (!streamUrl) {
      throw new NotFoundException('Stash media asset not found.');
    }

    const requestHeaders: Record<string, string> = {};
    if (rangeHeader) {
      requestHeaders.Range = rangeHeader;
    }

    // Temporary diagnostic logging for the AirPlay investigation -- the
    // error-only logging below stays silent on a normal 200/206, so without
    // this we can't tell "request never arrived" from "request succeeded
    // but playback still failed on the receiver". Remove once resolved.
    this.logger.log(
      `[airplay-debug] Incoming stream request for scene ${sceneId}, method=${
        headOnly ? 'HEAD' : 'GET'
      }, range=${rangeHeader ?? '<none>'}`,
    );

    let response: Response;
    try {
      // Always GET, never HEAD, to Stash -- confirmed AirPlaying the same
      // scene works when played directly from Stash's own player (a real
      // GET), but Stash's HEAD support on this endpoint is unverified, and
      // a HEAD probe that Stash mishandles (error/missing headers) would
      // fail the whole request rather than just being slow. For an
      // incoming HEAD, the body below is cancelled immediately instead of
      // piped, so we still avoid transferring the full video for a probe.
      response = await fetchWithTimeout(streamUrl, {
        method: 'GET',
        headers: requestHeaders,
      });
    } catch (error) {
      this.logger.error(
        `Failed to reach Stash for scene ${sceneId} stream: ${this.redactUrl(streamUrl)} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }

    if (!response.ok && response.status !== 206) {
      let bodySnippet = '<unreadable body>';
      try {
        bodySnippet = (await response.text()).slice(0, 500);
      } catch {
        // best-effort diagnostics only
      }
      this.logger.error(
        `Stash returned ${response.status} for scene ${sceneId} stream: ${this.redactUrl(
          streamUrl,
        )} — ${bodySnippet}`,
      );

      if (response.status === 404) {
        throw new NotFoundException('Stash media asset not found.');
      }

      throw new BadGatewayException(
        `Stash provider returned ${response.status} for stream request.`,
      );
    }

    const headers: Record<string, string> = {
      'Accept-Ranges': response.headers.get('accept-ranges') ?? 'bytes',
      // AirPlay/Cast receivers can be strict about needing an explicit,
      // recognized content type before they'll commit to playback; Stash
      // should always send one for a real video file, but fall back rather
      // than silently omitting the header if it ever doesn't.
      'Content-Type': response.headers.get('content-type') ?? 'video/mp4',
    };
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }
    if (contentRange) {
      headers['Content-Range'] = contentRange;
    }

    this.logger.log(
      `[airplay-debug] Responding for scene ${sceneId}: status=${response.status} headers=${JSON.stringify(
        headers,
      )}`,
    );

    if (headOnly) {
      // Release the upstream connection rather than let it sit there
      // downloading a body nobody will read.
      response.body?.cancel().catch(() => undefined);
      return { status: response.status, headers, body: null };
    }

    return {
      status: response.status,
      headers,
      body: response.body,
    };
  }

  async getScenePlaybackInfo(
    sceneId: string,
  ): Promise<{ resumeSeconds: number; duration: number | null }> {
    const config = await this.getStashConfig();
    const info = await this.stashAdapter.getScenePlaybackInfo(sceneId, config);
    if (!info) {
      throw new NotFoundException('Stash scene not found.');
    }

    return info;
  }

  async saveScenePlaybackProgress(
    sceneId: string,
    resumeSeconds: number,
    playDuration: number | null,
  ): Promise<void> {
    const config = await this.getStashConfig();
    await this.stashAdapter.saveSceneProgress(
      sceneId,
      resumeSeconds,
      playDuration,
      config,
    );
  }

  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('apikey')) {
        parsed.searchParams.set('apikey', '<redacted>');
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private async getStashConfig(): Promise<{ baseUrl: string; apiKey?: string | null }> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { type: 'STASH' },
    });
    const baseUrl = integration?.baseUrl?.trim();

    if (!integration || !integration.enabled || integration.status !== 'CONFIGURED' || !baseUrl) {
      throw new ServiceUnavailableException('Stash media is unavailable.');
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }
}
