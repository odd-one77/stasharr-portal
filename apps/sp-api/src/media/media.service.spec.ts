import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { MediaService } from './media.service';

describe('MediaService', () => {
  const integrationFindUniqueMock = jest.fn();
  const openSceneScreenshotMock = jest.fn();
  const openStudioLogoMock = jest.fn();
  const getSceneStreamUrlMock = jest.fn();
  const getScenePlaybackInfoMock = jest.fn();
  const saveSceneProgressMock = jest.fn();
  let originalFetch: typeof fetch;
  const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();

  const prismaService = {
    integrationConfig: {
      findUnique: integrationFindUniqueMock,
    },
  } as unknown as PrismaService;

  const stashAdapter = {
    openSceneScreenshot: openSceneScreenshotMock,
    openStudioLogo: openStudioLogoMock,
    getSceneStreamUrl: getSceneStreamUrlMock,
    getScenePlaybackInfo: getScenePlaybackInfoMock,
    saveSceneProgress: saveSceneProgressMock,
  } as unknown as StashAdapter;

  let service: MediaService;

  beforeAll(() => {
    originalFetch = global.fetch;
    Object.assign(global, { fetch: fetchMock });
  });

  afterAll(() => {
    Object.assign(global, { fetch: originalFetch });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MediaService(prismaService, stashAdapter);
  });

  it('returns a proxied scene screenshot using stash integration credentials', async () => {
    const body = Buffer.from([1, 2, 3]);

    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openSceneScreenshotMock.mockResolvedValue({
      body,
      contentType: 'image/jpeg',
      contentLength: '128',
      cacheControl: 'public, max-age=300',
    });

    const result = await service.getStashSceneScreenshot('411');

    expect(integrationFindUniqueMock).toHaveBeenCalledWith({
      where: { type: 'STASH' },
    });
    expect(openSceneScreenshotMock).toHaveBeenCalledWith('411', {
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    expect(result).toEqual({
      body,
      contentType: 'image/jpeg',
      contentLength: '128',
      cacheControl: 'public, max-age=300',
    });
  });

  it('returns a proxied studio logo using stash integration credentials', async () => {
    const body = Buffer.from([4, 5, 6]);

    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local/base',
      apiKey: null,
    });
    openStudioLogoMock.mockResolvedValue({
      body,
      contentType: 'image/png',
      contentLength: null,
      cacheControl: null,
    });

    const result = await service.getStashStudioLogo('studio-1');

    expect(openStudioLogoMock).toHaveBeenCalledWith('studio-1', {
      baseUrl: 'http://stash.local/base',
      apiKey: null,
    });
    expect(result.contentType).toBe('image/png');
  });

  it('throws not found when stash returns no matching media asset', async () => {
    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openSceneScreenshotMock.mockResolvedValue(null);

    await expect(service.getStashSceneScreenshot('411')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws service unavailable when stash is not configured', async () => {
    integrationFindUniqueMock.mockResolvedValue(null);

    await expect(service.getStashStudioLogo('studio-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(openStudioLogoMock).not.toHaveBeenCalled();
  });

  describe('streamStashScene', () => {
    beforeEach(() => {
      integrationFindUniqueMock.mockResolvedValue({
        type: 'STASH',
        enabled: true,
        status: 'CONFIGURED',
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
      getSceneStreamUrlMock.mockResolvedValue(
        'http://stash.local/scene/411/stream?apikey=secret',
      );
    });

    it('proxies a full response and forwards content headers', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-length': '1000',
          'accept-ranges': 'bytes',
        }),
        body: null,
      } as Response);

      const result = await service.streamStashScene('411');

      expect(getSceneStreamUrlMock).toHaveBeenCalledWith('411', {
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://stash.local/scene/411/stream?apikey=secret',
        expect.objectContaining({ headers: {} }),
      );
      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
        'Content-Length': '1000',
      });
    });

    it('forwards the Range header and returns a partial-content response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 206,
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-99/1000',
          'accept-ranges': 'bytes',
        }),
        body: null,
      } as Response);

      const result = await service.streamStashScene('411', 'bytes=0-99');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://stash.local/scene/411/stream?apikey=secret',
        expect.objectContaining({ headers: { Range: 'bytes=0-99' } }),
      );
      expect(result.status).toBe(206);
      expect(result.headers['Content-Range']).toBe('bytes 0-99/1000');
    });

    it('throws not found when stash has no stream url for the scene', async () => {
      getSceneStreamUrlMock.mockResolvedValue(null);

      await expect(service.streamStashScene('411')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws bad gateway when stash returns an error status', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        body: null,
      } as Response);

      await expect(service.streamStashScene('411')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('throws bad gateway when the upstream request fails', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network down'));

      await expect(service.streamStashScene('411')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  describe('getScenePlaybackInfo', () => {
    beforeEach(() => {
      integrationFindUniqueMock.mockResolvedValue({
        type: 'STASH',
        enabled: true,
        status: 'CONFIGURED',
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
    });

    it('returns resume position and duration for the scene', async () => {
      getScenePlaybackInfoMock.mockResolvedValue({
        resumeSeconds: 245.6,
        duration: 1800,
      });

      await expect(service.getScenePlaybackInfo('411')).resolves.toEqual({
        resumeSeconds: 245.6,
        duration: 1800,
      });
      expect(getScenePlaybackInfoMock).toHaveBeenCalledWith('411', {
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
    });

    it('throws not found when stash has no matching scene', async () => {
      getScenePlaybackInfoMock.mockResolvedValue(null);

      await expect(service.getScenePlaybackInfo('411')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('saveScenePlaybackProgress', () => {
    it('forwards resume position and play duration to the adapter', async () => {
      integrationFindUniqueMock.mockResolvedValue({
        type: 'STASH',
        enabled: true,
        status: 'CONFIGURED',
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });

      await service.saveScenePlaybackProgress('411', 245.6, 1800);

      expect(saveSceneProgressMock).toHaveBeenCalledWith(
        '411',
        245.6,
        1800,
        { baseUrl: 'http://stash.local', apiKey: 'secret' },
      );
    });
  });
});
