import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { RuntimeHealthService } from '../../runtime-health/runtime-health.service';
import { TpdbAdapter } from './tpdb.adapter';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('TpdbAdapter', () => {
  let adapter: TpdbAdapter;
  let runtimeHealthService: {
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
  };
  let originalFetch: typeof fetch;
  const fetchMock = jest.fn();
  const config = { baseUrl: 'https://api.theporndb.net', apiKey: 'tpdb-token' };

  beforeAll(() => {
    originalFetch = global.fetch;
    Object.assign(global, { fetch: fetchMock });
  });

  afterAll(() => {
    Object.assign(global, { fetch: originalFetch });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    runtimeHealthService = {
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    adapter = new TpdbAdapter(runtimeHealthService as unknown as RuntimeHealthService);
  });

  it('sends a Bearer token and records runtime health on a successful connection check', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

    await adapter.testConnection(config);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.theporndb.net/scenes?per_page=1'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tpdb-token' }),
      }),
    );
    expect(runtimeHealthService.recordSuccess).toHaveBeenCalled();
  });

  it('rejects an invalid token with a BadGatewayException', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthenticated.' }));

    await expect(adapter.probeConnection(config)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('retries once on a 429 before succeeding', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

    await adapter.testConnection(config);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a scenes feed page into the shared StashdbTrendingScenesResult shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: 'scene-uuid-1',
            title: 'A Scene',
            description: 'desc',
            date: '2026-03-01',
            duration: 600,
            poster: 'http://cdn.local/poster.jpg',
            site_id: 42,
          },
        ],
        meta: { current_page: 1, last_page: 3, total: 55 },
      }),
    );

    const result = await adapter.getScenesBySort({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: 20,
      sort: 'DATE',
      titleQuery: 'test',
    });

    expect(result.total).toBe(55);
    expect(result.scenes).toEqual([
      {
        id: 'scene-uuid-1',
        title: 'A Scene',
        details: 'desc',
        imageUrl: 'http://cdn.local/poster.jpg',
        studioId: '42',
        studioName: null,
        studioImageUrl: null,
        releaseDate: '2026-03-01',
        duration: 600,
      },
    ]);

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain('/scenes?');
    expect(requestedUrl).toContain('q=test');
    expect(requestedUrl).toContain('sort=date');
  });

  it('maps a single scene, placing the TPDB id in both stashId and tpdbId slots', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'scene-uuid-1',
          title: 'A Scene',
          description: 'desc',
          date: '2026-03-01',
          duration: 600,
          poster: 'http://cdn.local/poster.jpg',
          site: { id: 42, name: 'Studio Name', logo: 'http://cdn.local/logo.png' },
          performers: [
            {
              id: 'performer-uuid-1',
              name: 'Performer One',
              extra: { gender: 'Female' },
              image: 'http://cdn.local/performer.jpg',
            },
          ],
          tags: [{ id: 5, name: 'Tag One' }],
          url: 'https://example.com/scene',
        },
      }),
    );

    const scene = await adapter.getSceneById('scene-uuid-1', config);

    expect(scene.id).toBe('scene-uuid-1');
    expect(scene.studioId).toBe('42');
    expect(scene.studioName).toBe('Studio Name');
    expect(scene.tags).toEqual([{ id: '5', name: 'Tag One', description: null }]);
    expect(scene.performers).toEqual([
      {
        id: 'performer-uuid-1',
        name: 'Performer One',
        gender: 'Female',
        isFavorite: false,
        imageUrl: 'http://cdn.local/performer.jpg',
      },
    ]);
    expect(scene.sourceUrls).toEqual([{ url: 'https://example.com/scene', type: null }]);
  });

  it('throws NotFoundException when a scene does not exist', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'Not Found' }));

    await expect(adapter.getSceneById('missing', config)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps performer details from TPDB extras', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'performer-uuid-1',
          name: 'Performer One',
          aliases: ['Alias'],
          extras: {
            gender: 'Female',
            birthday: '1995-01-01',
            ethnicity: 'Caucasian',
            nationality: 'US',
            eye_colour: 'Blue',
            hair_colour: 'Blonde',
            cupsize: 'C',
            waist: 26,
            hips: 36,
            fake_boobs: false,
            career_start_year: 2015,
          },
          image: 'http://cdn.local/performer.jpg',
        },
      }),
    );

    const performer = await adapter.getPerformerById('performer-uuid-1', config);

    expect(performer).toMatchObject({
      id: 'performer-uuid-1',
      name: 'Performer One',
      gender: 'FEMALE',
      ethnicity: 'Caucasian',
      country: 'US',
      eyeColor: 'Blue',
      hairColor: 'Blonde',
      cupSize: 'C',
      waistSize: 26,
      hipSize: 36,
      breastType: 'Natural',
      careerStartYear: 2015,
      isFavorite: false,
      deleted: false,
    });
  });

  it('resolves a performer scenes feed via the numeric performer id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { id: 'performer-uuid-1', _id: 999 } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              id: 'scene-uuid-2',
              title: 'Scene Two',
              date: null,
              duration: null,
            },
          ],
          meta: { current_page: 1, last_page: 1, total: 1 },
        }),
      );

    const result = await adapter.getScenesForPerformer({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      performerId: 'performer-uuid-1',
      page: 1,
      perPage: 20,
      sort: 'DATE',
    });

    expect(result.total).toBe(1);
    expect(result.scenes[0].id).toBe('scene-uuid-2');

    const scenesUrl = fetchMock.mock.calls[1][0] as string;
    expect(scenesUrl).toContain('performer_id=999');
  });

  it('does not implement favoriting', () => {
    expect((adapter as unknown as { favoritePerformer?: unknown }).favoritePerformer).toBeUndefined();
    expect((adapter as unknown as { favoriteStudio?: unknown }).favoriteStudio).toBeUndefined();
  });
});
