import {
  BadGatewayException,
  Injectable,
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
    } catch {
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }

    if (!response.ok && response.status !== 206) {
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
