import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ShopWalksStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  SHOP_WALK_NAME_MAX_LENGTH,
} from '@portfolio/velista/models';
import {
  locationIdOf,
  SheetNavigation,
  shopWalkPath,
  shopWalksPath,
} from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { dateText } from './walk-text';

/**
 * Naming a new walk (velista `0122`, target 2), over the walks list: one field,
 * already holding a name somebody can keep, and Start.
 *
 * The walk is created with an empty map and not shown to shoppers, and the sheet
 * leaves for its history, replacing itself so back returns to the list. Velista
 * `0126` makes Start lead to recording instead.
 */
@Component({
  selector: 'lib-new-walk-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon],
  templateUrl: './new-walk-sheet.html',
  styleUrl: './walk-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewWalkSheet {
  private readonly _walks = inject(ShopWalksStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);

  protected readonly maxLength = SHOP_WALK_NAME_MAX_LENGTH;
  protected readonly locationId = locationIdOf(this._route);

  /** Seeded once with today's date, so Start works with no typing at all. */
  protected readonly typed = signal(
    String(
      this._translator.t('shopWalks.new.defaultName', undefined, undefined, {
        date: dateText(new Date(), this._locale()),
      })
    )
  );

  protected readonly busy = signal(false);
  protected readonly failed = signal(false);

  protected readonly canStart = computed(() => {
    const length = this.typed().trim().length;
    return !this.busy() && length > 0 && length <= this.maxLength;
  });

  protected onTyped(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
    this.failed.set(false);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    void this.start();
  }

  async start(): Promise<void> {
    if (!this.canStart()) {
      return;
    }
    this.busy.set(true);
    this.failed.set(false);
    try {
      const outcome = await this._walks.create(this.locationId(), this.typed());
      if (outcome.state === 'failed') {
        this.failed.set(true);
        return;
      }
      await this._sheet.leaveTo(
        shopWalkPath(
          this._locale(),
          this._basePath,
          this.locationId(),
          outcome.value.id,
          'record'
        )
      );
    } finally {
      this.busy.set(false);
    }
  }

  dismiss(): Promise<void> {
    return this._sheet.dismiss(
      shopWalksPath(this._locale(), this._basePath, this.locationId())
    );
  }
}
