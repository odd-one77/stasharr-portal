import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsService } from '../../core/api/app-settings.service';
import { SettingsContentPageComponent } from './settings-content-page.component';

describe('SettingsContentPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads and displays the current preference', async () => {
    const appSettingsService = {
      getPreferences: vi.fn().mockReturnValue(of({ hideAmateurNetworkResults: true })),
      updatePreferences: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsContentPageComponent],
      providers: [{ provide: AppSettingsService, useValue: appSettingsService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(appSettingsService.getPreferences).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Enabled');
  });

  it('saves the toggle change and reflects the server response', async () => {
    const appSettingsService = {
      getPreferences: vi.fn().mockReturnValue(of({ hideAmateurNetworkResults: false })),
      updatePreferences: vi.fn().mockReturnValue(of({ hideAmateurNetworkResults: true })),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsContentPageComponent],
      providers: [{ provide: AppSettingsService, useValue: appSettingsService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      onHideAmateurNetworkResultsChanged(value: boolean): void;
      hideAmateurNetworkResults: () => boolean;
    };
    component.onHideAmateurNetworkResultsChanged(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(appSettingsService.updatePreferences).toHaveBeenCalledWith({
      hideAmateurNetworkResults: true,
    });
    expect(component.hideAmateurNetworkResults()).toBe(true);
  });

  it('reverts the toggle and shows an error when saving fails', async () => {
    const appSettingsService = {
      getPreferences: vi.fn().mockReturnValue(of({ hideAmateurNetworkResults: false })),
      updatePreferences: vi.fn().mockReturnValue(throwError(() => new Error('network error'))),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsContentPageComponent],
      providers: [{ provide: AppSettingsService, useValue: appSettingsService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      onHideAmateurNetworkResultsChanged(value: boolean): void;
      hideAmateurNetworkResults: () => boolean;
    };
    component.onHideAmateurNetworkResultsChanged(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.hideAmateurNetworkResults()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Failed to save');
  });
});
