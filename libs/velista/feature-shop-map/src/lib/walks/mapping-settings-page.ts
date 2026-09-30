import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { MappingSettingsStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  locationIdOf,
  PageNavigation,
  shopWalksPath,
} from '@portfolio/velista/platform';
import { ChevronLeftIcon } from '@portfolio/velista/ui';

/**
 * The settings for every walk (velista `0122`, target 6; the `MapSettings`
 * board): "Walking across a shelf makes it a path", on by default, kept on this
 * device under one key and read by recording (velista `0126`).
 *
 * `shops/:locationId/walks/settings`: reached from a shop's walks, and about
 * every walk in every shop.
 */
@Component({
  selector: 'lib-mapping-settings-page',
  imports: [ChevronLeftIcon, RokuTranslatorPipe],
  templateUrl: './mapping-settings-page.html',
  styleUrl: './walk-settings-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MappingSettingsPage {
  private readonly _settings = inject(MappingSettingsStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly locationId = locationIdOf(this._route);
  protected readonly settings = this._settings.settings;

  protected setWalkingAcross(event: Event): void {
    this._settings.setWalkingAcrossMakesPath(
      (event.target as HTMLInputElement).checked
    );
  }

  protected back(): Promise<void> {
    return this._pages.back(
      shopWalksPath(this._locale(), this._basePath, this.locationId())
    );
  }
}
