import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Subject, Subscription, catchError, debounceTime, distinctUntilChanged, finalize, forkJoin, of, switchMap } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import {
  PerformerFeedItem,
  PerformerFeedResponse,
  SceneExplorerItem,
  SceneRequestContext,
  ScenesFeedResponse,
  StudioFeedItem,
  StudioFeedResponse,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneCardComponent } from '../../shared/scene-card/scene-card.component';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';

@Component({
  selector: 'app-search-page',
  imports: [
    FormsModule,
    RouterLink,
    ProgressSpinner,
    SceneCardComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss',
})
export class SearchPageComponent implements OnInit, OnDestroy {
  private static readonly RESULTS_PER_SOURCE = 24;

  private readonly discoverService = inject(DiscoverService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly searchTerms = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  private queryParamSubscription: Subscription | null = null;

  protected readonly queryInput = signal('');
  protected readonly loading = signal(false);
  protected readonly searched = signal(false);
  protected readonly sceneResults = signal<SceneExplorerItem[]>([]);
  protected readonly performerResults = signal<PerformerFeedItem[]>([]);
  protected readonly studioResults = signal<StudioFeedItem[]>([]);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly playingStashIds = signal<ReadonlySet<string>>(new Set());

  ngOnInit(): void {
    this.setupSearch();
    this.queryParamSubscription = this.route.queryParamMap.subscribe((params) => {
      const query = params.get('q')?.trim() ?? '';
      if (query === this.queryInput()) {
        return;
      }

      this.queryInput.set(query);
      this.searchTerms.next(query);
    });
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    this.queryParamSubscription?.unsubscribe();
  }

  protected onQueryInput(value: string): void {
    this.queryInput.set(value);
    this.searchTerms.next(value);
  }

  protected onQuerySubmit(): void {
    this.syncUrl(this.queryInput().trim());
  }

  protected hasResults(): boolean {
    return (
      this.sceneResults().length > 0 ||
      this.performerResults().length > 0 ||
      this.studioResults().length > 0
    );
  }

  protected isRequestable(item: SceneExplorerItem): boolean {
    return item.requestable && isSceneStatusRequestable(item.status);
  }

  protected playScene(stashId: string): void {
    if (this.playingStashIds().has(stashId)) {
      return;
    }

    this.playingStashIds.update((current) => new Set(current).add(stashId));
    this.discoverService
      .getSceneStreamUrl(stashId)
      .pipe(
        finalize(() => {
          this.playingStashIds.update((current) => {
            const next = new Set(current);
            next.delete(stashId);
            return next;
          });
        }),
      )
      .subscribe({
        next: (result) => {
          window.open(result.streamUrl, '_blank', 'noopener,noreferrer');
        },
        error: () => {
          this.notifications.error('Failed to load stream from Stash');
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
    this.sceneResults.update((items) =>
      items.map((item) =>
        item.id === stashId
          ? { ...item, requestable: false, status: { state: 'REQUESTED' } }
          : item,
      ),
    );
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  private syncUrl(query: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: query.length > 0 ? query : null },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  }

  private setupSearch(): void {
    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          const query = term.trim();
          this.searched.set(query.length > 0);
          if (!query) {
            return of(null);
          }

          const emptyScenes: ScenesFeedResponse = {
            total: 0,
            page: 1,
            perPage: SearchPageComponent.RESULTS_PER_SOURCE,
            hasMore: false,
            items: [] as SceneExplorerItem[],
          };
          const emptyPerformers: PerformerFeedResponse = {
            total: 0,
            page: 1,
            perPage: SearchPageComponent.RESULTS_PER_SOURCE,
            hasMore: false,
            items: [] as PerformerFeedItem[],
          };
          const emptyStudios: StudioFeedResponse = {
            total: 0,
            page: 1,
            perPage: SearchPageComponent.RESULTS_PER_SOURCE,
            hasMore: false,
            items: [] as StudioFeedItem[],
          };

          this.loading.set(true);
          return forkJoin({
            scenes: this.discoverService
              .getScenesFeed(
                1,
                SearchPageComponent.RESULTS_PER_SOURCE,
                'TITLE',
                'ASC',
                [],
                undefined,
                undefined,
                [],
                query,
              )
              .pipe(catchError(() => of(emptyScenes))),
            performers: this.discoverService
              .getPerformersFeed(1, SearchPageComponent.RESULTS_PER_SOURCE, { name: query })
              .pipe(catchError(() => of(emptyPerformers))),
            studios: this.discoverService
              .getStudiosFeed(1, SearchPageComponent.RESULTS_PER_SOURCE, { name: query })
              .pipe(catchError(() => of(emptyStudios))),
          }).pipe(finalize(() => this.loading.set(false)));
        }),
      )
      .subscribe((result) => {
        if (!result) {
          this.sceneResults.set([]);
          this.performerResults.set([]);
          this.studioResults.set([]);
          return;
        }

        this.sceneResults.set(result.scenes.items);
        this.performerResults.set(result.performers.items);
        this.studioResults.set(result.studios.items);
      });
  }
}
