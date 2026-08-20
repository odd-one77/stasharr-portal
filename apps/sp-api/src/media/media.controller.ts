import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { MediaService } from './media.service';
import { SaveScenePlaybackProgressDto } from './dto/save-scene-playback-progress.dto';

@Controller('api/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get('stash/scenes/:sceneId/screenshot')
  async getStashSceneScreenshot(
    @Param('sceneId') sceneId: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.mediaService.getStashSceneScreenshot(sceneId);
    this.writeAssetResponse(asset, response);
  }

  @Get('stash/studios/:studioId/logo')
  async getStashStudioLogo(
    @Param('studioId') studioId: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.mediaService.getStashStudioLogo(studioId);
    this.writeAssetResponse(asset, response);
  }

  @Get('stash/scenes/:sceneId/stream')
  async streamStashScene(
    @Param('sceneId') sceneId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.mediaService.streamStashScene(
      sceneId,
      request.headers.range,
    );

    response.status(result.status);
    for (const [header, value] of Object.entries(result.headers)) {
      response.setHeader(header, value);
    }

    if (!result.body) {
      response.end();
      return;
    }

    const upstream = Readable.fromWeb(
      result.body as unknown as NodeWebReadableStream<Uint8Array>,
    );
    response.on('close', () => {
      upstream.destroy();
    });
    upstream.on('error', () => {
      response.destroy();
    });
    upstream.pipe(response);
  }

  @Get('stash/scenes/:sceneId/playback-info')
  getScenePlaybackInfo(
    @Param('sceneId') sceneId: string,
  ): Promise<{ resumeSeconds: number; duration: number | null }> {
    return this.mediaService.getScenePlaybackInfo(sceneId);
  }

  @Post('stash/scenes/:sceneId/progress')
  saveScenePlaybackProgress(
    @Param('sceneId') sceneId: string,
    @Body() body: SaveScenePlaybackProgressDto,
  ): Promise<void> {
    return this.mediaService.saveScenePlaybackProgress(
      sceneId,
      body.resumeSeconds,
      body.playDuration ?? null,
    );
  }

  private writeAssetResponse(
    asset: Awaited<ReturnType<MediaService['getStashSceneScreenshot']>>,
    response: Response,
  ): void {
    response.setHeader('Content-Type', asset.contentType ?? 'application/octet-stream');
    response.setHeader('Content-Length', asset.contentLength ?? String(asset.body.byteLength));
    if (asset.cacheControl) {
      response.setHeader('Cache-Control', asset.cacheControl);
    }
    response.status(200).end(asset.body);
  }
}
