import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { SceneRequestContext, SceneStatus } from '../../core/api/discover.types';
import {
  SceneCardCenterActionDirective,
  SceneCardMediaFooterDirective,
  SceneCardShellComponent,
  SceneCardShellItem,
  SceneCardShellLink,
  SceneCardTopRightDirective,
} from './scene-card-shell.component';
import { SceneStatusBadgeComponent } from '../scene-status-badge/scene-status-badge.component';

export interface SceneCardItem extends SceneCardShellItem {
  id: string;
  releaseDate: string | null;
  status?: SceneStatus | null;
}

export type SceneCardVariant = 'default' | 'rail';
export type SceneCardTone = 'media' | 'surface';
export type SceneCardPrimaryLinkMode = 'scene' | 'external';
export type SceneCardStudioBadgeRoute = 'none' | 'scenes' | 'library';
export type SceneCardPlaySize = 'compact' | 'large';

export interface SceneCardBadge {
  label: string;
}

@Component({
  selector: 'app-scene-card',
  imports: [
    RouterLink,
    SceneCardShellComponent,
    SceneCardTopRightDirective,
    SceneCardMediaFooterDirective,
    SceneCardCenterActionDirective,
    SceneStatusBadgeComponent,
  ],
  templateUrl: './scene-card.component.html',
  styleUrl: './scene-card.component.scss',
  host: {
    '[class.scene-card-variant-rail]': "variant === 'rail'",
    '[class.scene-card-variant-default]': "variant !== 'rail'",
    '[class.scene-card-tone-media]': "tone !== 'surface'",
    '[class.scene-card-tone-surface]': "tone === 'surface'",
  },
})
export class SceneCardComponent {
  @Input({ required: true }) item!: SceneCardItem;
  @Input() requestable = false;
  @Input() variant: SceneCardVariant = 'default';
  @Input() tone: SceneCardTone = 'media';
  @Input() primaryLinkMode: SceneCardPrimaryLinkMode = 'scene';
  @Input() sceneRouteId: string | null = null;
  @Input() sceneQueryParams: Params | null = null;
  @Input() externalHref: string | null = null;
  @Input() studioBadgeRoute: SceneCardStudioBadgeRoute = 'none';
  @Input() topBadges: readonly SceneCardBadge[] = [];
  @Input() footerLink: SceneCardShellLink | null = null;
  @Input() footerLinkLabel: string | null = null;
  @Input() footerBadgeLabel: string | null = null;
  @Input() playable = false;
  @Input() playSize: SceneCardPlaySize = 'compact';
  @Input() progressPercent: number | null = null;

  @Output() request = new EventEmitter<SceneRequestContext>();
  @Output() play = new EventEmitter<string>();

  protected shellVariant(): 'default' | 'rail' {
    return this.variant === 'rail' ? 'rail' : 'default';
  }

  protected statusIcon(): SceneStatus | null {
    const status = this.item.status;
    return status && status.state !== 'NOT_REQUESTED' ? status : null;
  }

  protected primaryLink(): SceneCardShellLink {
    if (this.primaryLinkMode === 'external') {
      return {
        kind: 'external',
        href: this.externalHref ?? '',
        ariaLabel: this.item.title,
      };
    }

    return {
      kind: 'router',
      commands: ['/scene', this.sceneRouteIdValue()],
      queryParams: this.sceneQueryParams,
      ariaLabel: this.item.title,
    };
  }

  protected studioBadgeLink(): SceneCardShellLink | null {
    if (
      this.studioBadgeRoute === 'none' ||
      !this.item.studioId ||
      !this.item.studio
    ) {
      return null;
    }

    return {
      kind: 'router',
      commands: [this.studioBadgeRoute === 'library' ? '/library' : '/scenes'],
      queryParams: {
        studios: this.item.studioId,
        studioNames: this.item.studio,
      },
      ariaLabel: `Filter ${this.studioBadgeRoute} by studio ${this.item.studio}`,
    };
  }

  protected footerLinkText(): string | null {
    if (!this.footerLink) {
      return null;
    }

    const label = this.footerLinkLabel?.trim() ?? '';
    return label.length > 0 ? label : null;
  }

  protected footerBadgeText(): string | null {
    const label = this.footerBadgeLabel?.trim() ?? '';
    return label.length > 0 ? label : null;
  }

  protected footerLinkIsExternal(): boolean {
    return this.footerLink?.kind === 'external';
  }

  protected footerLinkRouterCommands(): string | readonly unknown[] | null {
    return this.footerLink?.kind === 'router' ? this.footerLink.commands : null;
  }

  protected footerLinkQueryParams(): Params | null {
    return this.footerLink?.kind === 'router' ? (this.footerLink.queryParams ?? null) : null;
  }

  protected footerExternalHref(): string | null {
    if (this.footerLink?.kind !== 'external') {
      return null;
    }

    const href = this.footerLink.href.trim();
    return href.length > 0 ? href : null;
  }

  protected footerStatus(): SceneStatus | null {
    if (
      this.requestable ||
      this.footerLinkText() ||
      this.footerBadgeText() ||
      this.showPlayAction()
    ) {
      return null;
    }

    return this.item.status ?? null;
  }

  protected showPlayAction(): boolean {
    if (!this.playable || this.requestable) {
      return false;
    }

    const status = this.item.status;
    if (!status) {
      // No lifecycle status is tracked for this item (e.g. Library cards) — its
      // presence in the list already means it's a real Stash-backed scene.
      return true;
    }

    return status.state === 'AVAILABLE';
  }

  protected hasSecondaryFooterAction(): boolean {
    return this.requestable || !!this.footerLinkText() || !!this.footerBadgeText();
  }

  protected showLargePlayAction(): boolean {
    return this.showPlayAction() && this.playSize === 'large';
  }

  protected showCompactPlayAction(): boolean {
    return this.showPlayAction() && this.playSize !== 'large';
  }

  protected requestScene(event: MouseEvent): void {
    event.stopPropagation();
    this.request.emit({
      id: this.item.id,
      title: this.item.title,
      imageUrl: this.item.imageUrl,
    });
  }

  protected playScene(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.play.emit(this.item.id);
  }

  private sceneRouteIdValue(): string {
    const sceneRouteId = this.sceneRouteId?.trim() ?? '';
    return sceneRouteId.length > 0 ? sceneRouteId : this.item.id;
  }
}
