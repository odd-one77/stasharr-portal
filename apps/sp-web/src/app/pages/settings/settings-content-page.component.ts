import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { AppSettingsService } from '../../core/api/app-settings.service';

@Component({
  selector: 'app-settings-content-page',
  imports: [FormsModule, ButtonDirective, Message, ProgressSpinner, ToggleSwitch],
  templateUrl: './settings-content-page.component.html',
  styleUrl: './settings-content-page.component.scss',
})
export class SettingsContentPageComponent implements OnInit {
  private readonly appSettingsService = inject(AppSettingsService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly hideAmateurNetworkResults = signal(false);

  ngOnInit(): void {
    this.loadPreferences();
  }

  protected retryLoad(): void {
    this.loadPreferences();
  }

  protected onHideAmateurNetworkResultsChanged(nextValue: boolean): void {
    const previousValue = this.hideAmateurNetworkResults();
    this.hideAmateurNetworkResults.set(nextValue);
    this.saving.set(true);
    this.saveError.set(null);

    this.appSettingsService
      .updatePreferences({ hideAmateurNetworkResults: nextValue })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (settings) => {
          this.hideAmateurNetworkResults.set(settings.hideAmateurNetworkResults);
        },
        error: () => {
          this.hideAmateurNetworkResults.set(previousValue);
          this.saveError.set('Failed to save. Please try again.');
        },
      });
  }

  private loadPreferences(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.appSettingsService
      .getPreferences()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (settings) => {
          this.hideAmateurNetworkResults.set(settings.hideAmateurNetworkResults);
        },
        error: () => {
          this.loadError.set('Failed to load content preferences.');
        },
      });
  }
}
