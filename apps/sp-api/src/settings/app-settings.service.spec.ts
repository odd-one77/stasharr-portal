import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from './app-settings.service';

describe('AppSettingsService', () => {
  let row: { singletonKey: number; hideAmateurNetworkResults: boolean } | null;

  const prisma = {
    appSettings: {
      upsert: jest.fn(
        async ({
          create,
          update,
        }: {
          where: { singletonKey: number };
          create: { singletonKey: number; hideAmateurNetworkResults?: boolean };
          update: { hideAmateurNetworkResults?: boolean };
        }) => {
          if (!row) {
            row = {
              singletonKey: create.singletonKey,
              hideAmateurNetworkResults: create.hideAmateurNetworkResults ?? false,
            };
          } else {
            row = { ...row, ...update };
          }

          return row;
        },
      ),
    },
  } as unknown as PrismaService;

  let service: AppSettingsService;

  beforeEach(() => {
    row = null;
    jest.clearAllMocks();
    service = new AppSettingsService(prisma);
  });

  it('defaults hideAmateurNetworkResults to false on first read', async () => {
    const settings = await service.get();

    expect(settings).toEqual({ hideAmateurNetworkResults: false });
  });

  it('persists an update and reflects it on subsequent reads', async () => {
    await service.update({ hideAmateurNetworkResults: true });

    const settings = await service.get();

    expect(settings).toEqual({ hideAmateurNetworkResults: true });
  });

  it('leaves the stored value untouched when the patch omits the field', async () => {
    await service.update({ hideAmateurNetworkResults: true });

    const settings = await service.update({});

    expect(settings).toEqual({ hideAmateurNetworkResults: true });
  });
});
