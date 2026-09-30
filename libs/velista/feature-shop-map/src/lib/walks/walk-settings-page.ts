import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { ShopWalksStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  SHOP_WALK_NAME_MAX_LENGTH,
} from '@portfolio/velista/models';
import {
  locationIdOf,
  PageNavigation,
  sheetSegments,
  SHOP_PATHS,
  shopWalkPath,
  walkIdOf,
} from '@portfolio/velista/platform';
import { ChevronLeftIcon } from '@portfolio/velista/ui';

/** What the page last said about a write, for its live region. */
export type WalkSettingsNotice =
  | 'renamed'
  | 'renameFailed'
  | 'shown'
  | 'hidden'
  | 'showFailed'
  | null;

/**
 * A walk's settings (velista `0122`, target 5; the `WalkOptions` board): its
 * name, "Show this walk to shoppers" with the sentence that says what it does,
 * and "Delete this walk", which asks in a sheet.
 *
 * The name is saved when the field is left or Go is pressed, and only when it
 * changed: there is no Save button to forget.
 *
 * `shops/:locationId/walks/:walkId/settings`, only with `shopMap.record`.
 */
@Component({
  selector: 'lib-walk-settings-page',
  imports: [ChevronLeftIcon, RokuTranslatorPipe, RouterOutlet],
  templateUrl: './walk-settings-page.html',
  styleUrl: './walk-settings-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalkSettingsPage {
  private readonly _walks = inject(ShopWalksStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly maxLength = SHOP_WALK_NAME_MAX_LENGTH;
  protected readonly locationId = locationIdOf(this._route);
  protected readonly walkId = walkIdOf(this._route);

  protected readonly read = computed(() => this._walks.walk(this.walkId()));
  protected readonly walk = computed(() => this._walks.summary(this.walkId()));

  /** What is in the field. Null until somebody types, so it follows the walk until then. */
  private readonly _typed = signal<string | null>(null);
  protected readonly typed = computed(
    () => this._typed() ?? this.walk()?.name ?? ''
  );

  protected readonly busy = signal(false);
  protected readonly notice = signal<WalkSettingsNotice>(null);

  constructor() {
    effect(() => {
      const walkId = this.walkId();
      if (walkId !== '') {
        untracked(() => void this._walks.loadWalk(walkId));
      }
    });
  }

  protected onTyped(event: Event): void {
    this._typed.set((event.target as HTMLInputElement).value);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    (event.target as HTMLFormElement)
      .querySelector<HTMLInputElement>('input')
      ?.blur();
  }

  /** The field was left: save the name when it changed and is a name. */
  async saveName(): Promise<void> {
    const walk = this.walk();
    const name = this.typed().trim();
    if (walk === null || name === '' || name === walk.name) {
      this._typed.set(null);
      return;
    }
    const outcome = await this._walks.rename(walk.id, name);
    if (outcome.state === 'failed') {
      this.notice.set('renameFailed');
      return;
    }
    this._typed.set(null);
    this.notice.set('renamed');
  }

  async setShown(event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const walk = this.walk();
    if (walk === null || this.busy()) {
      box.checked = walk?.shown ?? false;
      return;
    }
    const shown = box.checked;
    this.busy.set(true);
    try {
      const outcome = await this._walks.setShown(walk.id, shown);
      if (outcome.state === 'failed') {
        // A controlled checkbox does not move back by itself.
        box.checked = walk.shown;
        this.notice.set('showFailed');
        return;
      }
      this.notice.set(shown ? 'shown' : 'hidden');
    } finally {
      this.busy.set(false);
    }
  }

  protected askDelete(): void {
    void this._router.navigate(sheetSegments(SHOP_PATHS.deleteWalk), {
      relativeTo: this._route,
    });
  }

  protected back(): Promise<void> {
    return this._pages.back(
      shopWalkPath(
        this._locale(),
        this._basePath,
        this.locationId(),
        this.walkId()
      )
    );
  }
}
