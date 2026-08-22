import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsDto, UpdateAppSettingsDto } from './dto/app-settings.dto';

@Injectable()
export class AppSettingsService {
  private static readonly SINGLETON_KEY = 1;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AppSettingsDto> {
    const settings = await this.prisma.appSettings.upsert({
      where: { singletonKey: AppSettingsService.SINGLETON_KEY },
      create: { singletonKey: AppSettingsService.SINGLETON_KEY },
      update: {},
    });

    return { hideAmateurNetworkResults: settings.hideAmateurNetworkResults };
  }

  async update(patch: UpdateAppSettingsDto): Promise<AppSettingsDto> {
    const settings = await this.prisma.appSettings.upsert({
      where: { singletonKey: AppSettingsService.SINGLETON_KEY },
      create: {
        singletonKey: AppSettingsService.SINGLETON_KEY,
        ...(patch.hideAmateurNetworkResults !== undefined
          ? { hideAmateurNetworkResults: patch.hideAmateurNetworkResults }
          : {}),
      },
      update: {
        ...(patch.hideAmateurNetworkResults !== undefined
          ? { hideAmateurNetworkResults: patch.hideAmateurNetworkResults }
          : {}),
      },
    });

    return { hideAmateurNetworkResults: settings.hideAmateurNetworkResults };
  }
}
