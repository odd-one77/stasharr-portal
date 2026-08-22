import { IsBoolean, IsOptional } from 'class-validator';

export class AppSettingsDto {
  hideAmateurNetworkResults!: boolean;
}

export class UpdateAppSettingsDto {
  @IsOptional()
  @IsBoolean()
  hideAmateurNetworkResults?: boolean;
}
