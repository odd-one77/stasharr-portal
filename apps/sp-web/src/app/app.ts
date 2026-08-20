import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Toast } from 'primeng/toast';
import { ImageObscurationToggleComponent } from './shared/image-obscuration-toggle/image-obscuration-toggle.component';
import { ThemeToggleComponent } from './shared/theme-toggle/theme-toggle.component';
import { VideoPlayerOverlayComponent } from './shared/video-player-overlay/video-player-overlay.component';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    ThemeToggleComponent,
    ImageObscurationToggleComponent,
    Toast,
    ConfirmDialog,
    VideoPlayerOverlayComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
