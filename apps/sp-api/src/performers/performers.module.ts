import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashModule } from '../providers/stash/stash.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { SettingsModule } from '../settings/settings.module';
import { PerformerFavoritesService } from './performer-favorites.service';
import { PerformersController } from './performers.controller';
import { PerformersService } from './performers.service';

@Module({
  imports: [
    IntegrationsModule,
    StashModule,
    StashdbModule,
    SceneStatusModule,
    SettingsModule,
  ],
  controllers: [PerformersController],
  providers: [PerformersService, PerformerFavoritesService],
})
export class PerformersModule {}
