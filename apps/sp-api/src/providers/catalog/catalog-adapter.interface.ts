import {
  StashdbAdapterBaseConfig,
  StashdbAdapterSceneFeedConfig,
  StashdbAdapterTrendingConfig,
  StashdbPerformerDetails,
  StashdbPerformerFeedConfig,
  StashdbPerformerScenesConfig,
  StashdbPerformersFeedResult,
  StashdbSceneDetails,
  StashdbSceneMetadata,
  StashdbStudioDetails,
  StashdbStudioOption,
  StashdbStudiosFeedConfig,
  StashdbStudiosFeedResult,
  StashdbTagOption,
  StashdbTagSearchConfig,
  StashdbTrendingScenesResult,
} from '../stashdb/stashdb.adapter';

/**
 * Shared contract for catalog metadata providers (StashDB/FansDB via
 * StashdbAdapter, TPDB via TpdbAdapter). Favoriting is deliberately excluded —
 * TPDB has no favoriting API, so callers that need it must depend on
 * StashdbAdapter directly rather than going through this interface.
 */
export interface CatalogAdapter {
  testConnection(config: StashdbAdapterBaseConfig): Promise<void>;
  probeConnection(config: StashdbAdapterBaseConfig): Promise<void>;
  getScenesSortedByDate(
    config: StashdbAdapterTrendingConfig,
  ): Promise<StashdbTrendingScenesResult>;
  getScenesBySort(
    config: StashdbAdapterSceneFeedConfig,
  ): Promise<StashdbTrendingScenesResult>;
  searchTags(config: StashdbTagSearchConfig): Promise<StashdbTagOption[]>;
  getPerformersFeed(
    config: StashdbPerformerFeedConfig,
  ): Promise<StashdbPerformersFeedResult>;
  getStudiosFeed(
    config: StashdbStudiosFeedConfig,
  ): Promise<StashdbStudiosFeedResult>;
  getPerformerById(
    performerId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbPerformerDetails>;
  getStudioById(
    studioId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbStudioDetails>;
  searchStudios(
    queryText: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbStudioOption[]>;
  getScenesForPerformer(
    config: StashdbPerformerScenesConfig,
  ): Promise<StashdbTrendingScenesResult>;
  getSceneById(
    sceneId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbSceneDetails>;
  getSceneMetadataByIds(
    sceneIds: string[],
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbSceneMetadata[]>;
}
