import { ServiceUnavailableException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { TpdbAdapter } from '../providers/tpdb/tpdb.adapter';
import { WhisparrMetadataService } from './whisparr-metadata.service';

describe('WhisparrMetadataService', () => {
  const findOneMock = jest.fn();
  const getSceneByIdMock = jest.fn();
  const getScenesBySortMock = jest.fn();
  const getPerformerByIdMock = jest.fn();
  const getPerformersFeedMock = jest.fn();
  const getStudioByIdMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const tpdbAdapter = {
    getSceneById: getSceneByIdMock,
    getScenesBySort: getScenesBySortMock,
    getPerformerById: getPerformerByIdMock,
    getPerformersFeed: getPerformersFeedMock,
    getStudioById: getStudioByIdMock,
  } as unknown as TpdbAdapter;

  let service: WhisparrMetadataService;

  const tpdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'https://api.theporndb.net',
    apiKey: 'tpdb-token',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WhisparrMetadataService(integrationsService, tpdbAdapter);
    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.TPDB) {
        return tpdbIntegration;
      }
      throw new Error('Unexpected integration type');
    });
  });

  it('throws ServiceUnavailableException when TPDB is not configured', async () => {
    findOneMock.mockResolvedValue({
      enabled: false,
      status: IntegrationStatus.NOT_CONFIGURED,
      baseUrl: null,
      apiKey: null,
    });

    await expect(service.searchScenes('test')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('places the TPDB scene id in both the stashId and tpdbId slots when mapping a scene', async () => {
    getSceneByIdMock.mockResolvedValue({
      id: 'tpdb-scene-uuid',
      title: 'A Scene',
      details: 'desc',
      imageUrl: 'http://cdn.local/poster.jpg',
      studioId: 'tpdb-studio-uuid',
      studioName: 'Studio Name',
      studioImageUrl: 'http://cdn.local/logo.png',
      releaseDate: '2026-03-01',
      duration: 600,
      images: [{ id: 'poster', url: 'http://cdn.local/poster.jpg', width: null, height: null }],
      studioIsFavorite: false,
      tags: [{ id: 't1', name: 'Tag', description: null }],
      performers: [
        {
          id: 'tpdb-performer-uuid',
          name: 'Performer One',
          gender: 'FEMALE',
          isFavorite: false,
          imageUrl: 'http://cdn.local/performer.jpg',
        },
      ],
      sourceUrls: [{ url: 'https://theporndb.net/scenes/tpdb-scene-uuid', type: null }],
    });

    const resource = (await service.getScene('tpdb-scene-uuid')) as {
      foreignIds: { stashId: string; tpdbId: string; tmdbId: number };
      itemType: string;
      studio: { foreignIds: { stashId: string; tpdbId: string } } | null;
      credits: Array<{ performer: { foreignIds: { stashId: string; tpdbId: string } } }>;
    };

    expect(resource.foreignIds).toEqual({
      stashId: 'tpdb-scene-uuid',
      tpdbId: 'tpdb-scene-uuid',
      tmdbId: 0,
    });
    expect(resource.itemType).toBe('scene');
    expect(resource.studio?.foreignIds).toEqual({
      stashId: 'tpdb-studio-uuid',
      tpdbId: 'tpdb-studio-uuid',
      tmdbId: 0,
    });
    expect(resource.credits[0].performer.foreignIds).toEqual({
      stashId: 'tpdb-performer-uuid',
      tpdbId: 'tpdb-performer-uuid',
      tmdbId: 0,
    });

    expect(getSceneByIdMock).toHaveBeenCalledWith('tpdb-scene-uuid', {
      baseUrl: tpdbIntegration.baseUrl,
      apiKey: tpdbIntegration.apiKey,
    });
  });

  it('omits the studio when a scene has no studio metadata, rather than failing the lookup', async () => {
    getSceneByIdMock.mockResolvedValue({
      id: 'tpdb-scene-uuid',
      title: 'A Scene',
      details: null,
      imageUrl: null,
      studioId: null,
      studioName: null,
      studioImageUrl: null,
      releaseDate: null,
      duration: null,
      images: [],
      studioIsFavorite: false,
      tags: [],
      performers: [],
      sourceUrls: [],
    });

    const resource = (await service.getScene('tpdb-scene-uuid')) as { studio: unknown };

    expect(resource.studio).toBeNull();
  });

  it('reports no changes for the changed-since routes', async () => {
    await expect(service.getScenesChanged()).resolves.toEqual([]);
    await expect(service.getPerformersChanged()).resolves.toEqual([]);
    await expect(service.getSitesChanged()).resolves.toEqual([]);
  });
});
