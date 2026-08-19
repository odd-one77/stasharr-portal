import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Subscription, catchError, finalize, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import {
  SceneExplorerItem,
  SceneRequestContext,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { HomeService } from '../../core/api/home.service';
import { HomeRailContentResponse, HomeRailItem } from '../../core/api/home.types';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SceneCardComponent } from '../../shared/scene-card/scene-card.component';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import {
  buildReadinessPageAlert,
  firstUseEmptyStateCopy,
  initialIndexingGuidance,
} from '../../shared/readiness/first-run-readiness.utils';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, ProgressSpinner, SceneCardComponent, SceneRequestModalComponent],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent implements OnInit, OnDestroy {
  private readonly discoverService = inject(DiscoverService);
  private readonly homeService = inject(HomeService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly router = inject(Router);

  private continueWatchingSubscription: Subscription | null = null;
  private recentlyAddedSubscription: Subscription | null = null;
  private favoriteReleasesSubscription: Subscription | null = null;

  @ViewChildren('railViewport')
  private railViewports?: QueryList<ElementRef<HTMLDivElement>>;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly continueWatchingItems = signal<HomeRailItem[]>([]);
  protected readonly recentlyAddedItems = signal<HomeRailItem[]>([]);
  protected readonly favoriteReleaseItems = signal<SceneExplorerItem[]>([]);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly pageAlert = computed(() =>
    buildReadinessPageAlert(
      'home',
      this.setupStatusStore.status(),
      this.runtimeHealthService.status(),
    ),
  );

  ngOnInit(): void {
    this.runtimeHealthService.ensureStarted();
    this.loadContinueWatching();
    this.loadRecentlyAdded();
    this.loadFavoriteReleases();
  }

  ngOnDestroy(): void {
    this.continueWatchingSubscription?.unsubscribe();
    this.recentlyAddedSubscription?.unsubscribe();
    this.favoriteReleasesSubscription?.unsubscribe();
  }

  protected loadContinueWatching(): void {
    this.continueWatchingSubscription?.unsubscribe();
    this.continueWatchingSubscription = this.homeService
      .getContinueWatching()
      .pipe(catchError(() => of<HomeRailContentResponse>({ items: [], message: null })))
      .subscribe((response) => {
        this.continueWatchingItems.set(response.items);
      });
  }

  protected loadRecentlyAdded(): void {
    this.recentlyAddedSubscription?.unsubscribe();
    this.recentlyAddedSubscription = this.homeService
      .getRecentlyAdded()
      .pipe(catchError(() => of<HomeRailContentResponse>({ items: [], message: null })))
      .subscribe((response) => {
        this.recentlyAddedItems.set(response.items);
      });
  }

  protected loadFavoriteReleases(): void {
    this.favoriteReleasesSubscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);

    this.favoriteReleasesSubscription = this.discoverService
      .getScenesFeed(1, 16, 'DATE', 'DESC', [], undefined, 'ALL', [])
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => {
          this.favoriteReleaseItems.set(response.items);
        },
        error: () => {
          this.error.set('Unable to load recently released favorites right now.');
        },
      });
  }

  protected retryFavoriteReleases(): void {
    this.loadFavoriteReleases();
  }

  protected isPageEmptyState(): boolean {
    if (this.loading() || this.error()) {
      return false;
    }

    return (
      this.continueWatchingItems().length === 0 &&
      this.recentlyAddedItems().length === 0 &&
      this.favoriteReleaseItems().length === 0
    );
  }

  protected emptyStateTitle(): string {
    return firstUseEmptyStateCopy('home').title;
  }

  protected emptyStateMessage(): string {
    if (this.pageAlert()) {
      return 'Home may be empty because required integrations are degraded. Repair integrations, then refresh Home to reload.';
    }

    return firstUseEmptyStateCopy('home').message;
  }

  protected indexingGuidance(): string {
    return initialIndexingGuidance();
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  protected isRequestable(item: SceneExplorerItem): boolean {
    return item.requestable && isSceneStatusRequestable(item.status);
  }

  protected playScene(localSceneId: string): void {
    window.open(
      `/api/media/stash/scenes/${encodeURIComponent(localSceneId)}/stream`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  protected openRequestModal(item: SceneRequestContext): void {
    this.requestContext.set(item);
    this.requestModalOpen.set(true);
  }

  protected onRequestModalClosed(): void {
    this.requestModalOpen.set(false);
  }

  protected onRequestSubmitted(stashId: string): void {
    this.favoriteReleaseItems.update((items) =>
      items.map((item) =>
        item.id === stashId
          ? { ...item, requestable: false, status: { state: 'REQUESTED' } }
          : item,
      ),
    );
  }

  protected scrollRail(railId: string, direction: 'prev' | 'next'): void {
    const viewport = this.findRailViewport(railId);
    if (!viewport) {
      return;
    }

    const delta = Math.max(viewport.clientWidth * 0.82, 320);
    viewport.scrollBy({
      left: direction === 'next' ? delta : -delta,
      behavior: 'smooth',
    });
  }

  private findRailViewport(railId: string): HTMLDivElement | null {
    return (
      this.railViewports?.find(
        (elementRef) => elementRef.nativeElement.dataset['railId'] === railId,
      )?.nativeElement ?? null
    );
  }
}
