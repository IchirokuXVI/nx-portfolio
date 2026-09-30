import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { ShopDetailStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  locationIdOf,
  SHEET_SEGMENT,
  SheetNavigation,
  SHOP_PATHS,
  shopWalkPath,
  shopWalksPath,
  walkIdOf,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { shopPageText } from '../shop-page/shop-page';

/**
 * The warning before resuming the walk shoppers see (velista `0122`, target 7;
 * the `ResumeLive` board), over the walk's history: every save while walking
 * changes the map shoppers use, so a half finished area shows until the walk
 * stops. "Resume anyway", "Start a new walk" and "Cancel".
 *
 * `shops/:locationId/walks/:walkId/sheet/resume`. Nothing opens it yet: Resume
 * walking is velista `0126`'s, which opens this sheet for the shown walk, and
 * "Resume anyway" leads to its route, `walks/:walkId/record`.
 */
@Component({
  selector: 'lib-resume-warning-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './resume-warning-sheet.html',
  styleUrl: './walk-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResumeWarningSheet {
  private readonly _shops = inject(ShopDetailStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly locationId = locationIdOf(this._route);
  protected readonly walkId = walkIdOf(this._route);

  /** The shop as the sentence names it: its chain, else its own name. */
  protected readonly shopName = computed(() => {
    const read = this._shops.read(this.locationId());
    if (read.kind !== 'shop') {
      return null;
    }
    const text = shopPageText(read.shop, this._locale());
    return text.chain ?? text.title;
  });

  constructor() {
    effect(() => {
      const locationId = this.locationId();
      if (locationId !== '') {
        untracked(() => void this._shops.ensure(locationId));
      }
    });
  }

  protected resume(): Promise<void> {
    return this._sheet.leaveTo(this._walkPath('record'));
  }

  protected startNew(): Promise<void> {
    return this._sheet.leaveTo(
      `${shopWalksPath(this._locale(), this._basePath, this.locationId())}/${SHEET_SEGMENT}/${SHOP_PATHS.newWalk}`
    );
  }

  dismiss(): Promise<void> {
    return this._sheet.dismiss(this._walkPath(null));
  }

  private _walkPath(page: 'record' | null): string {
    return shopWalkPath(
      this._locale(),
      this._basePath,
      this.locationId(),
      this.walkId(),
      page
    );
  }
}
