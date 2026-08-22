export interface AppSettings {
  hideAmateurNetworkResults: boolean;
}

export type UpdateAppSettingsPayload = Partial<AppSettings>;
