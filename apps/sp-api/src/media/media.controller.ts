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

  @Get('stash/performers/:performerId/photo')
  async getStashPerformerPhoto(
    @Param('performerId') performerId: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.mediaService.getStashPerformerPhoto(performerId);
    this.writeAssetResponse(asset, response);
  }

  @Get('stash/galleries/:galleryId/cover')
  async getStashGalleryCover(
    @Param('galleryId') galleryId: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.mediaService.getStashGalleryCover(galleryId);
    this.writeAssetResponse(asset, response);
  }

  @Get('stash/images/:imageId/thumbnail')
  async getStashImageThumbnail(
    @Param('imageId') imageId: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.mediaService.getStashImageThumbnail(imageId);
    this.writeAssetResponse(asset, response);
  }

  @Get('stash/images/:imageId/full')
  async getStashImageFull(
    @Param('imageId') imageId: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.mediaService.getStashImageFull(imageId);
    this.writeAssetResponse(asset, response);
  }

  @Get('stash/scenes/:sceneId/stream')
  async streamStashScene(
    @Param('sceneId') sceneId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // AirPlay/Cast receivers commonly probe with a HEAD request before
    // committing to playback, expecting just headers back quickly. Express
    // routes HEAD through this same @Get handler, so without this check
    // we'd still fetch and pipe the *entire* video from Stash before the
    // (bodyless) HEAD response could complete -- for a large file that can
    // take long enough that the receiver's probe times out and the
    // "connected but stuck loading" spinner never resolves.
    const isHeadRequest = request.method === 'HEAD';

    const result = await this.mediaService.streamStashScene(
      sceneId,
      request.headers.range,
      isHeadRequest,
    );

    response.status(result.status);
    for (const [header, value] of Object.entries(result.headers)) {
      response.setHeader(header, value);
    }

    if (!result.body || isHeadRequest) {
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
