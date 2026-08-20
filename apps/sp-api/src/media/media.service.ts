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

  async streamStashScene(
    sceneId: string,
    rangeHeader?: string,
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

    let response: Response;
    try {
      response = await fetchWithTimeout(streamUrl, { headers: requestHeaders });
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
    };
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }
    if (contentRange) {
      headers['Content-Range'] = contentRange;
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
