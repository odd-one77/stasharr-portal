import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Toast } from 'primeng/toast';
import { ThemeToggleComponent } from './shared/theme-toggle/theme-toggle.component';
import { VideoPlayerOverlayComponent } from './shared/video-player-overlay/video-player-overlay.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ThemeToggleComponent, Toast, ConfirmDialog, VideoPlayerOverlayComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly router = inject(Router);

  protected readonly isHomeRoute = signal(this.router.url.startsWith('/home'));

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.isHomeRoute.set(this.router.url.startsWith('/home'));
    });
  }
}
