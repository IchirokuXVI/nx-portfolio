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
} from '@portfolio/localization/rokutranslator-angular';
import { ShopWalksStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  locationIdOf,
  SheetNavigation,
  shopWalkPath,
  shopWalksPath,
  walkIdOf,
} from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon } from '@portfolio/velista/ui';

/**
 * Deleting a walk (velista `0122`, target 5), over its settings. The walk leaves
 * every list and shoppers stop seeing it if it was shown; its entries are kept on
 * the server, and the sheet says only what somebody sees.
 */
@Component({
  selector: 'lib-delete-walk-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon],
  templateUrl: './delete-walk-sheet.html',
  styleUrl: './walk-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteWalkSheet {
  private readonly _walks = inject(ShopWalksStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly locationId = locationIdOf(this._route);
  protected readonly walkId = walkIdOf(this._route);

  protected readonly walk = computed(() => this._walks.summary(this.walkId()));
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);

  async confirm(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.failed.set(false);
    try {
      const outcome = await this._walks.remove(this.walkId());
      if (outcome.state === 'failed') {
        this.failed.set(true);
        return;
      }
      await this._sheet.leaveTo(
        shopWalksPath(this._locale(), this._basePath, this.locationId())
      );
    } finally {
      this.busy.set(false);
    }
  }

  dismiss(): Promise<void> {
    return this._sheet.dismiss(
      shopWalkPath(
        this._locale(),
        this._basePath,
        this.locationId(),
        this.walkId(),
        'settings'
      )
    );
  }
}
