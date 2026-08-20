import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import {
  StashdbAdapter,
  StashdbSceneDetails,
} from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { ScenesService } from './scenes.service';

describe('ScenesService', () => {
  const integrationsService = {
    findOne: jest.fn(),
  } as unknown as IntegrationsService;
  const catalogProviderService = {
    getConfiguredCatalogProvider: jest.fn(),
    getConfiguredCatalogAdapter: jest.fn(),
  } as unknown as CatalogProviderService;

  const stashdbAdapter = {
    getSceneById: jest.fn(),
    getScenesBySort: jest.fn(),
    searchTags: jest.fn(),
    favoriteStudio: jest.fn(),
  } as unknown as StashdbAdapter;

  const sceneStatusService = {
    resolveForScene: jest.fn(),
  } as unknown as SceneStatusService;

  const stashAdapter = {
    findScenesByStashId: jest.fn(),
    getSceneStreamUrl: jest.fn(),
  } as unknown as StashAdapter;

  const whisparrAdapter = {
    findMovieByStashId: jest.fn(),
    buildSceneViewUrl: jest.fn(),
  } as unknown as WhisparrAdapter;

  const stashdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stashdb.local',
    apiKey: 'stashdb-key',
  };

  const stashIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stash.local',
    apiKey: 'stash-key',
  };

  const whisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'whisparr-key',
  };

  const sceneDetails: StashdbSceneDetails = {
    id: 'stashdb-scene-1',
    title: 'Scene',
    details: 'Description',
    imageUrl: 'http://cdn.local/image.jpg',
    images: [],
    studioId: 'studio-1',
    studioIsFavorite: false,
    studioName: 'Studio',
    studioImageUrl: 'http://studio-image',
    releaseDate: '2026-01-01',
    duration: 300,
    tags: [],
    performers: [],
    sourceUrls: [],
  };

  let service: ScenesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScenesService(
      integrationsService,
      catalogProviderService,
      stashdbAdapter,
      sceneStatusService,
      stashAdapter,
      whisparrAdapter,
    );

    integrationsService.findOne = jest
      .fn()
      .mockImplementation((type: IntegrationType) => {
        if (type === IntegrationType.STASH) {
          return stashIntegration;
        }

        if (type === IntegrationType.WHISPARR) {
          return whisparrIntegration;
        }

        throw new Error('Unexpected integration type');
      });
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'STASHDB',
        providerKey: 'STASHDB',
        label: 'StashDB',
        baseUrl: stashdbIntegration.baseUrl,
        apiKey: stashdbIntegration.apiKey,
      });
    catalogProviderService.getConfiguredCatalogAdapter = jest
      .fn()
      .mockResolvedValue(stashdbAdapter);

    stashdbAdapter.getSceneById = jest.fn().mockResolvedValue(sceneDetails);
    stashdbAdapter.getScenesBySort = jest.fn().mockResolvedValue({
      total: 1,
      scenes: [
        {
          id: 'stashdb-scene-1',
          title: 'Scene',
          details: 'Description',
          imageUrl: 'http://cdn.local/image.jpg',
          studioId: 'studio-1',
          studioName: 'Studio',
          studioImageUrl: 'http://studio-image',
          date: '2026-01-01',
          releaseDate: '2026-01-02',
          productionDate: '2026-01-03',
          duration: 300,
        },
      ],
    });
    stashdbAdapter.searchTags = jest.fn().mockResolvedValue([]);
    stashdbAdapter.favoriteStudio = jest.fn().mockResolvedValue({
      favorited: true,
      alreadyFavorited: false,
    });
    sceneStatusService.resolveForScene = jest
      .fn()
      .mockResolvedValue({ state: 'AVAILABLE' });
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(
        new Map([['stashdb-scene-1', { state: 'AVAILABLE' }]]),
      );
    stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([]);
    whisparrAdapter.findMovieByStashId = jest.fn().mockResolvedValue(null);
    whisparrAdapter.buildSceneViewUrl = jest
      .fn()
      .mockReturnValue('http://whisparr.local/movie/stashdb-scene-1');
  });

  it('enriches scene details with stash availability when stash copies exist', async () => {
    stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([
      {
        id: '3027',
        width: 3840,
        height: 2160,
        viewUrl: 'http://stash.local/scene/3027',
        label: '2160p',
      },
      {
        id: '3030',
        width: 1920,
        height: 1080,
        viewUrl: 'http://stash.local/scene/3030',
        label: '1080p',
      },
    ]);

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: {
        exists: true,
        hasMultipleCopies: true,
        copies: [
          { id: '3027', label: '2160p' },
          { id: '3030', label: '1080p' },
        ],
      },
      whisparr: null,
    });
    expect(stashAdapter.findScenesByStashId).toHaveBeenCalledWith(
      'stashdb-scene-1',
      {
        baseUrl: stashIntegration.baseUrl,
        apiKey: stashIntegration.apiKey,
      },
      {
        providerKey: 'STASHDB',
      },
    );
  });

  it('defaults to TRENDING sort for scenes feed and returns statuses', async () => {
    await expect(service.getScenesFeed()).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 24,
      hasMore: false,
      items: [
        {
          id: 'stashdb-scene-1',
          title: 'Scene',
          description: 'Description',
          imageUrl: 'http://cdn.local/image.jpg',
          cardImageUrl: 'http://cdn.local/image.jpg?size=600',
          studioId: 'studio-1',
          studio: 'Studio',
          studioImageUrl: 'http://studio-image',
          releaseDate: '2026-01-02',
          duration: 300,
          type: 'SCENE',
          source: 'STASHDB',
          status: { state: 'AVAILABLE' },
          requestable: false,
        },
      ],
    });

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 24,
      sort: 'TRENDING',
      direction: 'DESC',
      favorites: undefined,
      tagFilter: undefined,
      studioIds: [],
    });
    expect(stashAdapter.findScenesByStashId).not.toHaveBeenCalled();
  });

  it('uses the active FANSDB provider for discovery feed and scene detail source', async () => {
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'FANSDB',
        providerKey: 'FANSDB',
        label: 'FansDB',
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      });

    await expect(service.getScenesFeed()).resolves.toMatchObject({
      items: [expect.objectContaining({ source: 'FANSDB' })],
    });
    await expect(service.getSceneById('stashdb-scene-1')).resolves.toMatchObject({
      source: 'FANSDB',
    });

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      }),
    );
    expect(stashdbAdapter.getSceneById).toHaveBeenCalledWith(
      'stashdb-scene-1',
      {
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      },
    );
    expect(stashAdapter.findScenesByStashId).toHaveBeenCalledWith(
      'stashdb-scene-1',
      {
        baseUrl: stashIntegration.baseUrl,
        apiKey: stashIntegration.apiKey,
      },
      {
        providerKey: 'FANSDB',
      },
    );
  });

  it('dispatches to the TPDB catalog adapter when TPDB is the active provider', async () => {
    const tpdbAdapter = {
      getScenesBySort: jest.fn().mockResolvedValue({
        total: 1,
        scenes: [
          {
            id: 'tpdb-scene-1',
            title: 'TPDB Scene',
            details: null,
            imageUrl: null,
            studioId: null,
            studioName: null,
            studioImageUrl: null,
            releaseDate: null,
            duration: null,
          },
        ],
      }),
    };

    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'TPDB',
        providerKey: 'TPDB',
        label: 'ThePornDB',
        baseUrl: 'https://api.theporndb.net',
        apiKey: 'tpdb-token',
      });
    catalogProviderService.getConfiguredCatalogAdapter = jest
      .fn()
      .mockResolvedValue(tpdbAdapter);

    await expect(service.getScenesFeed()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'tpdb-scene-1', source: 'TPDB' })],
    });

    expect(tpdbAdapter.getScenesBySort).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.theporndb.net',
        apiKey: 'tpdb-token',
      }),
    );
    expect(stashdbAdapter.getScenesBySort).not.toHaveBeenCalled();
  });

  it('forwards non-default sort to stashdb adapter', async () => {
    await service.getScenesFeed(2, 10, 'TITLE');

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 2,
      perPage: 10,
      sort: 'TITLE',
      direction: 'DESC',
      favorites: undefined,
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('forwards ALL favorites filter to stashdb adapter', async () => {
    await service.getScenesFeed(1, 25, 'DATE', undefined, [], 'OR', 'ALL');

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'ALL',
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('forwards PERFORMER favorites filter to stashdb adapter', async () => {
    await service.getScenesFeed(
      1,
      25,
      'DATE',
      undefined,
      [],
      'OR',
      'PERFORMER',
    );

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'PERFORMER',
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('marks NOT_REQUESTED discovery scenes as requestable from status resolution', async () => {
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(
        new Map([['stashdb-scene-1', { state: 'NOT_REQUESTED' }]]),
      );

    await expect(service.getScenesFeed(1, 25, 'DATE')).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 25,
      hasMore: false,
      items: [
        expect.objectContaining({
          id: 'stashdb-scene-1',
          status: { state: 'NOT_REQUESTED' },
          requestable: true,
        }),
      ],
    });

    expect(stashAdapter.findScenesByStashId).not.toHaveBeenCalled();
  });

  it('forwards STUDIO favorites filter to stashdb adapter', async () => {
    await service.getScenesFeed(1, 25, 'DATE', undefined, [], 'OR', 'STUDIO');

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'STUDIO',
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('forwards selected tags and AND mode to stashdb adapter', async () => {
    await service.getScenesFeed(
      1,
      25,
      'DATE',
      undefined,
      ['t-1', 't-2', 't-1'],
      'AND',
      'PERFORMER',
    );

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'PERFORMER',
      tagFilter: {
        tagIds: ['t-1', 't-2'],
        mode: 'AND',
      },
      studioIds: [],
    });
  });

  it('forwards normalized studioIds to stashdb adapter', async () => {
    await service.getScenesFeed(1, 25, 'DATE', undefined, [], 'OR', undefined, [
      'studio-1',
      'studio-1',
      'studio-2',
    ]);

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: undefined,
      tagFilter: undefined,
      studioIds: ['studio-1', 'studio-2'],
    });
  });

  it('forwards explicit sort direction to stashdb adapter', async () => {
    await service.getScenesFeed(1, 25, 'DATE', 'ASC');

    expect(stashdbAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'ASC',
      favorites: undefined,
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('returns scene tag options from stashdb', async () => {
    stashdbAdapter.searchTags = jest.fn().mockResolvedValue([
      {
        id: 'tag-1',
        name: 'Tag One',
        description: null,
        aliases: ['Alias 1'],
      },
    ]);

    await expect(service.searchSceneTags('tag')).resolves.toEqual([
      {
        id: 'tag-1',
        name: 'Tag One',
        description: null,
        aliases: ['Alias 1'],
      },
    ]);

    expect(stashdbAdapter.searchTags).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      query: 'tag',
    });
  });

  it('returns stash null when stash integration is unavailable', async () => {
    integrationsService.findOne = jest
      .fn()
      .mockImplementation((type: IntegrationType) => {
        if (type === IntegrationType.WHISPARR) {
          return whisparrIntegration;
        }

        throw new Error('stash unavailable');
      });

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: null,
      whisparr: null,
    });
  });

  it('returns stash null when stash provider fails', async () => {
    stashAdapter.findScenesByStashId = jest
      .fn()
      .mockRejectedValue(new Error('provider failed'));

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: null,
      whisparr: null,
    });
  });

  it('enriches scene details with whisparr view link when scene exists in whisparr', async () => {
    whisparrAdapter.findMovieByStashId = jest.fn().mockResolvedValue({
      movieId: 44,
      stashId: 'stashdb-scene-1',
      hasFile: false,
    });

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      whisparr: {
        exists: true,
        viewUrl: 'http://whisparr.local/movie/stashdb-scene-1',
      },
    });
  });

  it('returns whisparr null when whisparr provider fails', async () => {
    whisparrAdapter.findMovieByStashId = jest
      .fn()
      .mockRejectedValue(new Error('provider failed'));

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      whisparr: null,
    });
  });

  it('favorites studio by id', async () => {
    await expect(service.favoriteStudio('studio-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });

    expect(stashdbAdapter.favoriteStudio).toHaveBeenCalledWith(
      'studio-1',
      true,
      {
        baseUrl: stashdbIntegration.baseUrl,
        apiKey: stashdbIntegration.apiKey,
      },
    );
  });

  it('rejects favoriting a studio when TPDB is the active provider', async () => {
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'TPDB',
        providerKey: 'TPDB',
        label: 'ThePornDB',
        baseUrl: 'https://api.theporndb.net',
        apiKey: 'tpdb-token',
      });

    await expect(service.favoriteStudio('studio-1', true)).rejects.toThrow(
      'Favoriting is not supported for TPDB.',
    );
    expect(stashdbAdapter.favoriteStudio).not.toHaveBeenCalled();
  });

  describe('getSceneStreamUrl', () => {
    const copies = [
      {
        id: '3027',
        width: 3840,
        height: 2160,
        viewUrl: 'http://stash.local/scene/3027',
        label: '2160p',
      },
      {
        id: '3030',
        width: 1920,
        height: 1080,
        viewUrl: 'http://stash.local/scene/3030',
        label: '1080p',
      },
    ];

    beforeEach(() => {
      stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue(copies);
    });

    it('resolves the best available copy when no copyId is given', async () => {
      await expect(
        service.getSceneStreamUrl('stashdb-scene-1'),
      ).resolves.toBe('/api/media/stash/scenes/3027/stream');

      expect(stashAdapter.findScenesByStashId).toHaveBeenCalledWith(
        'stashdb-scene-1',
        { baseUrl: stashIntegration.baseUrl, apiKey: stashIntegration.apiKey },
        { providerKey: 'STASHDB' },
      );
      expect(stashAdapter.getSceneStreamUrl).not.toHaveBeenCalled();
    });

    it('resolves a specific copy when copyId is given', async () => {
      await expect(
        service.getSceneStreamUrl('stashdb-scene-1', '3030'),
      ).resolves.toBe('/api/media/stash/scenes/3030/stream');
    });

    it('throws not found when no stash copy matches', async () => {
      stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([]);

      await expect(
        service.getSceneStreamUrl('stashdb-scene-1'),
      ).rejects.toThrow('No linked Stash scene found for playback.');
    });

    it('throws not found when the requested copyId does not match any copy', async () => {
      await expect(
        service.getSceneStreamUrl('stashdb-scene-1', 'missing'),
      ).rejects.toThrow('No linked Stash scene found for playback.');
    });

    it('throws not found when stash is not configured', async () => {
      integrationsService.findOne = jest.fn().mockResolvedValue({
        enabled: false,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://stash.local',
        apiKey: 'stash-key',
      });

      await expect(
        service.getSceneStreamUrl('stashdb-scene-1'),
      ).rejects.toThrow('Stash integration is not configured.');
    });
  });
});
