import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PerformerFavoritesService } from '../performers/performer-favorites.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { type CatalogProviderKey } from '../providers/catalog/catalog-provider.util';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { StashdbScene } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import {
  SceneStatusDto,
  isSceneStatusRequestable,
} from '../scene-status/dto/scene-status.dto';
import { filterExcludedNetworkScenes } from '../scene-status/exclude-network-scenes.util';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { AppSettingsService } from '../settings/app-settings.service';
import { SceneTagOptionDto } from './dto/scene-tag-option.dto';
import {
  SceneDetailsDto,
  SceneStashAvailabilityDto,
  SceneWhisparrAvailabilityDto,
} from './dto/scene-details.dto';
import { ScenesFeedResponseDto } from './dto/scenes-feed.dto';
import {
  SceneFavoritesFilter,
  SceneFeedSort,
  SortDirection,
  SceneTagMatchMode,
} from './dto/scenes-query.dto';

@Injectable()
export class ScenesService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;

  // Bounded by favorited-performer count, not catalog size -- see
  // getFavoritePerformerScenesFeed.
  private static readonly FAVORITE_PERFORMER_SCENES_PER_PERFORMER_CAP = 60;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly sceneStatusService: SceneStatusService,
    private readonly stashAdapter: StashAdapter,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly appSettingsService: AppSettingsService,
    private readonly performerFavoritesService: PerformerFavoritesService,
  ) {}

  async getScenesFeed(
    page = ScenesService.DEFAULT_PAGE,
    perPage = ScenesService.DEFAULT_PER_PAGE,
    sort: SceneFeedSort = 'TRENDING',
    direction: SortDirection = 'DESC',
    tagIds: string[] = [],
    tagMode: SceneTagMatchMode = 'OR',
    favorites?: SceneFavoritesFilter,
    studioIds: string[] = [],
    titleQuery?: string,
  ): Promise<ScenesFeedResponseDto> {
    const normalizedStudioIds = this.normalizeStudioIds(studioIds);

    // TPDB has no server-side "favorite performer" filter at all (confirmed
    // live: the field never appears on any scene/performer response), so
    // asking it for favorites: PERFORMER silently returns the unfiltered
    // feed. Since favorites are tracked locally and expected to be a small
    // curated list, build this from each favorited performer's own scenes
    // instead of relying on the provider.
    if (favorites === 'PERFORMER') {
      return this.getFavoritePerformerScenesFeed(
        page,
        perPage,
        sort,
        direction,
        normalizedStudioIds,
        titleQuery,
      );
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const normalizedTagIds = this.normalizeTagIds(tagIds);
    const [scenes, appSettings] = await Promise.all([
      catalogAdapter.getScenesBySort({
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
        page,
        perPage,
        sort,
        direction,
        favorites,
        studioIds: normalizedStudioIds,
        titleQuery,
        tagFilter:
          normalizedTagIds.length > 0
            ? {
                tagIds: normalizedTagIds,
                mode: tagMode,
              }
            : undefined,
      }),
      this.appSettingsService.get(),
    ]);
    const statuses = await this.sceneStatusService.resolveForScenes(
      scenes.scenes.map((scene) => scene.id),
    );
    const visibleScenes = filterExcludedNetworkScenes(
      scenes.scenes,
      statuses,
      appSettings.hideAmateurNetworkResults,
    );

    return {
      // total/hasMore still reflect the catalog provider's raw, unfiltered
      // count -- there's no way to know "is this scene already in my
      // library" without resolving status locally, so an excluded-network
      // scene can't be excluded from the provider's own pagination math.
      // Worst case this slightly overstates the count and infinite-scroll
      // makes one extra (empty) request at the very end of a feed.
      total: scenes.total,
      page,
      perPage,
      hasMore: page * perPage < scenes.total,
      items: visibleScenes.map((scene) => {
        const status = statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
        return this.toScenesFeedItem(
          scene,
          catalogProvider.integrationType,
          status,
          isSceneStatusRequestable(status),
        );
      }),
    };
  }

  // Favorites live entirely in our own DB and a favorited list is expected
  // to be small (a curated shortlist, not the full catalog), so rather than
  // ask the provider for a "favorite performers" page it can't produce
  // (TPDB has no such filter at all), fetch each favorited performer's own
  // scenes directly and merge/sort/paginate locally. Bounded by favorited
  // performer count x a per-performer cap, not total catalog size.
  private async getFavoritePerformerScenesFeed(
    page: number,
    perPage: number,
    sort: SceneFeedSort,
    direction: SortDirection,
    studioIds: string[],
    titleQuery: string | undefined,
  ): Promise<ScenesFeedResponseDto> {
    const favoriteIds = await this.performerFavoritesService.listAllFavoriteIds();
    if (favoriteIds.length === 0) {
      return { total: 0, page, perPage, hasMore: false, items: [] };
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const appSettings = await this.appSettingsService.get();

    const perPerformerScenes = await Promise.all(
      favoriteIds.map(async (performerId): Promise<StashdbScene[]> => {
        try {
          const result = await catalogAdapter.getScenesForPerformer({
            baseUrl: catalogProvider.baseUrl,
            apiKey: catalogProvider.apiKey,
            performerId,
            page: 1,
            perPage: ScenesService.FAVORITE_PERFORMER_SCENES_PER_PERFORMER_CAP,
            sort: 'DATE',
            direction: 'DESC',
          });
          return result.scenes;
        } catch {
          // Deleted/merged upstream, or this performer has no scenes --
          // drop it rather than fail the whole feed.
          return [];
        }
      }),
    );

    const dedupedScenes = new Map<string, StashdbScene>();
    for (const scene of perPerformerScenes.flat()) {
      if (!dedupedScenes.has(scene.id)) {
        dedupedScenes.set(scene.id, scene);
      }
    }
    let scenes = Array.from(dedupedScenes.values());

    if (studioIds.length > 0) {
      const studioIdSet = new Set(studioIds);
      scenes = scenes.filter(
        (scene) => scene.studioId !== null && studioIdSet.has(scene.studioId),
      );
    }

    const normalizedTitleQuery = titleQuery?.trim().toLowerCase();
    if (normalizedTitleQuery) {
      scenes = scenes.filter((scene) =>
        scene.title.toLowerCase().includes(normalizedTitleQuery),
      );
    }

    const sorted = this.sortScenesLocally(scenes, sort, direction);
    const statuses = await this.sceneStatusService.resolveForScenes(
      sorted.map((scene) => scene.id),
    );
    const visibleScenes = filterExcludedNetworkScenes(
      sorted,
      statuses,
      appSettings.hideAmateurNetworkResults,
    );

    const total = visibleScenes.length;
    const start = (page - 1) * perPage;
    const pageItems = visibleScenes.slice(start, start + perPage);

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: pageItems.map((scene) => {
        const status = statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
        return this.toScenesFeedItem(
          scene,
          catalogProvider.integrationType,
          status,
          isSceneStatusRequestable(status),
        );
      }),
    };
  }

  private sortScenesLocally(
    scenes: StashdbScene[],
    sort: SceneFeedSort,
    direction: SortDirection,
  ): StashdbScene[] {
    const directionFactor = direction === 'DESC' ? -1 : 1;

    return [...scenes].sort((a, b) => {
      if (sort === 'TITLE') {
        return a.title.localeCompare(b.title) * directionFactor;
      }

      // TRENDING/CREATED_AT/UPDATED_AT all collapse to date here, matching
      // TPDB's own live behavior (its list endpoints only ever honor
      // sort=date server-side too -- see tpdb.adapter.ts).
      const aDate = a.releaseDate ?? a.date;
      const bDate = b.releaseDate ?? b.date;
      if (!aDate && !bDate) {
        return 0;
      }
      if (!aDate) {
        return 1;
      }
      if (!bDate) {
        return -1;
      }
      return aDate.localeCompare(bDate) * directionFactor;
    });
  }

  async searchSceneTags(query?: string): Promise<SceneTagOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    return catalogAdapter.searchTags({
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
      query: normalizedQuery,
    });
  }

  async getSceneById(stashId: string): Promise<SceneDetailsDto> {
    const sceneId = stashId.trim();
    if (!sceneId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    const scene = await catalogAdapter.getSceneById(sceneId, {
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    });
    const status = await this.sceneStatusService.resolveForScene(scene.id);
    const stash = await this.resolveStashAvailability(
      scene.id,
      catalogProvider.providerKey,
    );
    const whisparr = await this.resolveWhisparrAvailability(scene.id);

    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      images: scene.images,
      studioId: scene.studioId,
      studioIsFavorite: scene.studioIsFavorite,
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      studioUrl: this.resolveStudioUrl(scene.sourceUrls),
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      tags: scene.tags,
      performers: scene.performers.map((performer) => ({
        ...performer,
        cardImageUrl: withStashImageSize(performer.imageUrl, 300),
      })),
      sourceUrls: scene.sourceUrls,
      source: catalogProvider.integrationType,
      status,
      stash,
      whisparr,
    };
  }

  async getSceneStreamUrl(
    stashId: string,
    copyId?: string,
  ): Promise<{
    streamUrl: string;
    stashSceneId: string;
    resumeSeconds: number;
    duration: number | null;
  }> {
    const copy = await this.resolveStashCopy(stashId, copyId);

    return {
      streamUrl: `/api/media/stash/scenes/${encodeURIComponent(copy.id)}/stream`,
      stashSceneId: copy.id,
      resumeSeconds: copy.resumeSeconds,
      duration: copy.duration,
    };
  }

  private async resolveStashCopy(
    stashId: string,
    copyId?: string,
  ): Promise<{ id: string; resumeSeconds: number; duration: number | null }> {
    const sceneId = stashId.trim();
    if (!sceneId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    // Throws if no catalog provider is configured for this instance at all
    // — unrelated to the id-matching change below, just a normal setup
    // precondition for playback.
    await this.catalogProviderService.getConfiguredCatalogProvider();
    const integration = await this.integrationsService.findOne(
      IntegrationType.STASH,
    );

    if (
      !integration.enabled ||
      integration.status !== IntegrationStatus.CONFIGURED
    ) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    const config = { baseUrl, apiKey: integration.apiKey };
    // No providerKey overlay here on purpose: a scene tagged in Stash under
    // a previously-configured catalog provider is still genuinely playable,
    // not just copies tagged under whichever provider happens to be active
    // right now.
    const copies = await this.stashAdapter.findScenesByStashId(sceneId, config);

    const normalizedCopyId = copyId?.trim();
    const targetCopy = normalizedCopyId
      ? copies.find((copy) => copy.id === normalizedCopyId)
      : copies[0];

    if (!targetCopy) {
      throw new NotFoundException('No linked Stash scene found for playback.');
    }

    return targetCopy;
  }

  async favoriteStudio(
    studioId: string,
    favorite: boolean,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    const normalizedStudioId = studioId.trim();
    if (!normalizedStudioId) {
      throw new BadRequestException('Studio id is required.');
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    return catalogAdapter.favoriteStudio(normalizedStudioId, favorite, {
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    });
  }

  private async resolveStashAvailability(
    stashId: string,
    activeCatalogProviderKey: CatalogProviderKey | null,
  ): Promise<SceneStashAvailabilityDto | null> {
    try {
      if (!activeCatalogProviderKey) {
        return null;
      }

      const integration = await this.integrationsService.findOne(
        IntegrationType.STASH,
      );

      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      // No providerKey overlay here on purpose: a scene tagged in Stash
      // under a previously-configured catalog provider is still genuinely
      // in the library, not just copies tagged under whichever provider
      // happens to be active right now.
      const copies = await this.stashAdapter.findScenesByStashId(stashId, {
        baseUrl,
        apiKey: integration.apiKey,
      });

      return {
        exists: copies.length > 0,
        hasMultipleCopies: copies.length > 1,
        copies,
      };
    } catch {
      return null;
    }
  }

  private toScenesFeedItem(
    scene: {
      id: string;
      title: string;
      details: string | null;
      imageUrl: string | null;
      studioId: string | null;
      studioName: string | null;
      studioImageUrl: string | null;
      releaseDate: string | null;
      productionDate: string | null;
      date: string | null;
      duration: number | null;
    },
    source: CatalogProviderKey,
    status: SceneStatusDto,
    requestable: boolean,
  ) {
    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      cardImageUrl: withStashImageSize(scene.imageUrl, 600),
      studioId: scene.studioId,
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate ?? scene.productionDate ?? scene.date,
      duration: scene.duration,
      type: 'SCENE' as const,
      source,
      status,
      requestable,
    };
  }

  private normalizeTagIds(tagIds: string[]): string[] {
    return [...new Set(tagIds.map((tagId) => tagId.trim()).filter(Boolean))];
  }

  private normalizeStudioIds(studioIds: string[]): string[] {
    return [
      ...new Set(studioIds.map((studioId) => studioId.trim()).filter(Boolean)),
    ];
  }

  private resolveStudioUrl(
    sourceUrls: Array<{ url: string; type: string | null }>,
  ): string | null {
    const studioEntry = sourceUrls.find((entry) => {
      const normalizedType = entry.type?.trim().toLowerCase() ?? '';
      return normalizedType.includes('studio');
    });

    return studioEntry?.url ?? null;
  }

  private async resolveWhisparrAvailability(
    stashId: string,
  ): Promise<SceneWhisparrAvailabilityDto | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.WHISPARR,
      );

      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      const movie = await this.whisparrAdapter.findMovieByStashId(stashId, {
        baseUrl,
        apiKey: integration.apiKey,
      });

      if (!movie) {
        return null;
      }

      return {
        exists: true,
        viewUrl: this.whisparrAdapter.buildSceneViewUrl(baseUrl, movie.movieId),
      };
    } catch {
      return null;
    }
  }
}
