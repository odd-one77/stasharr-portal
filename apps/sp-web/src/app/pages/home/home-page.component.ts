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
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  forkJoin,
  of,
  switchMap,
} from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import {
  PerformerFeedItem,
  SceneExplorerItem,
  SceneRequestContext,
  StudioFeedItem,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { HomeService } from '../../core/api/home.service';
import { HomeRailContentResponse, HomeRailItem } from '../../core/api/home.types';
import { PlayerService } from '../../core/player/player.service';
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
  imports: [
    RouterLink,
    FormsModule,
    ProgressSpinner,
    SceneCardComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent implements OnInit, OnDestroy {
  private readonly discoverService = inject(DiscoverService);
  private readonly homeService = inject(HomeService);
  private readonly playerService = inject(PlayerService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly router = inject(Router);

  private continueWatchingSubscription: Subscription | null = null;
  private recentlyAddedSubscription: Subscription | null = null;
  private favoriteReleasesSubscription: Subscription | null = null;
  private searchSubscription: Subscription | null = null;
  private readonly searchTerms = new Subject<string>();

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
  protected readonly favoritingSupported = computed(
    () => this.setupStatusStore.status()?.catalogProvider !== 'TPDB',
  );
  protected readonly favoriteReleasesKicker = computed(() =>
    this.favoritingSupported() ? 'Favorites' : 'Recently added',
  );
  protected readonly favoriteReleasesTitle = computed(() =>
    this.favoritingSupported()
      ? 'Recently released from your favorites'
      : 'Recently released scenes',
  );

  protected readonly searchTerm = signal('');
  protected readonly searchOpen = signal(false);
  protected readonly searchLoading = signal(false);
  protected readonly searchSceneResults = signal<SceneExplorerItem[]>([]);
  protected readonly searchPerformerResults = signal<PerformerFeedItem[]>([]);
  protected readonly searchStudioResults = signal<StudioFeedItem[]>([]);

  ngOnInit(): void {
    this.runtimeHealthService.ensureStarted();
    this.setupSearch();
    this.loadContinueWatching();
    this.loadRecentlyAdded();
    this.loadFavoriteReleases();
  }

  ngOnDestroy(): void {
    this.continueWatchingSubscription?.unsubscribe();
    this.recentlyAddedSubscription?.unsubscribe();
    this.favoriteReleasesSubscription?.unsubscribe();
    this.searchSubscription?.unsubscribe();
  }

  protected onSearchInput(value: string): void {
    const nextValue = value;
    this.searchTerm.set(nextValue);
    this.searchOpen.set(nextValue.trim().length > 0);
    this.searchTerms.next(nextValue);
  }

  protected closeSearch(): void {
    this.searchOpen.set(false);
  }

  protected submitSearch(): void {
    const query = this.searchTerm().trim();
    if (!query) {
      return;
    }

    this.closeSearch();
    void this.router.navigate(['/search'], { queryParams: { q: query } });
  }

  protected onSearchFocus(): void {
    if (this.searchTerm().trim().length > 0) {
      this.searchOpen.set(true);
    }
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
    this.searchOpen.set(false);
    this.searchSceneResults.set([]);
    this.searchPerformerResults.set([]);
    this.searchStudioResults.set([]);
    this.searchTerms.next('');
  }

  protected hasSearchResults(): boolean {
    return (
      this.searchSceneResults().length > 0 ||
      this.searchPerformerResults().length > 0 ||
      this.searchStudioResults().length > 0
    );
  }

  private setupSearch(): void {
    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          const query = term.trim();
          if (!query) {
            this.searchLoading.set(false);
            return of(null);
          }

          this.searchLoading.set(true);
          return forkJoin({
            scenes: this.discoverService
              .getScenesFeed(1, 5, 'TITLE', 'ASC', [], undefined, undefined, [], query)
              .pipe(catchError(() => of({ items: [] as SceneExplorerItem[] }))),
            performers: this.discoverService
              .getPerformersFeed(1, 5, { name: query })
              .pipe(catchError(() => of({ items: [] as PerformerFeedItem[] }))),
            studios: this.discoverService
              .getStudiosFeed(1, 5, { name: query })
              .pipe(catchError(() => of({ items: [] as StudioFeedItem[] }))),
          }).pipe(finalize(() => this.searchLoading.set(false)));
        }),
      )
      .subscribe((result) => {
        if (!result) {
          this.searchSceneResults.set([]);
          this.searchPerformerResults.set([]);
          this.searchStudioResults.set([]);
          return;
        }

        this.searchSceneResults.set(result.scenes.items);
        this.searchPerformerResults.set(result.performers.items);
        this.searchStudioResults.set(result.studios.items);
      });
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
      .getScenesFeed(
        1,
        16,
        'DATE',
        'DESC',
        [],
        undefined,
        this.favoritingSupported() ? 'ALL' : undefined,
        [],
      )
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
    const title =
      this.continueWatchingItems().find((item) => item.id === localSceneId)?.title ??
      this.recentlyAddedItems().find((item) => item.id === localSceneId)?.title ??
      'Scene';
    this.playerService.openByLocalSceneId({ title, localSceneId });
  }

  protected markWatched(localSceneId: string): void {
    this.homeService.resetContinueWatchingProgress(localSceneId).subscribe({
      next: () => {
        this.continueWatchingItems.update((items) =>
          items.filter((item) => item.id !== localSceneId),
        );
      },
    });
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
