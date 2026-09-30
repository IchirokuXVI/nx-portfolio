import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ShopDetailStore, ShopMapStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  isSettledMapLine,
  shopMapLinesIn,
  shopMapSectionNote,
  shopMapSectionPosition,
  type ShopMapLine,
} from '@portfolio/velista/models';
import {
  locationIdOf,
  sectionIdOf,
  SheetNavigation,
  SHOP_PATHS,
  shopMapPath,
} from '@portfolio/velista/platform';
import { CheckIcon, CloseIcon, SheetShell } from '@portfolio/velista/ui';

/**
 * One section of the map (velista `0121`, target 4; the `SectionSheet` board):
 * its name, where it falls on the way round and how many things there are still
 * to get, its lines with the settle circle and the quantity, and the note the
 * mapper left beside it.
 *
 * `shops/:locationId/map/sheet/sections/:sectionId`, over the map. It reads the
 * map and the lines the map page opened, so it draws in the frame it opens. The
 * settle circle says where a line stands and is not a control: settling is the
 * basket's, and a second way to do it here would be a second place for it to go
 * wrong.
 */
@Component({
  selector: 'lib-shop-section-sheet',
  imports: [CheckIcon, CloseIcon, RokuTranslatorPipe, SheetShell],
  templateUrl: './section-sheet.html',
  styleUrl: './section-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionSheet {
  private readonly _maps = inject(ShopMapStore);
  private readonly _shops = inject(ShopDetailStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _locationId = locationIdOf(this._route);
  private readonly _sectionId = sectionIdOf(this._route);
  private readonly _query = toSignal(this._route.queryParamMap, {
    initialValue: this._route.snapshot.queryParamMap,
  });

  /** The section as the map names it, or null for one the map does not name. */
  private readonly _section = computed(() => {
    const id = this._sectionId();
    return (
      this._maps.map()?.sections.find((one) => one.sectionId === id) ?? null
    );
  });

  /** The chain's own name for the section, else the name the mapper typed. */
  protected readonly name = computed(() => {
    const read = this._shops.read(this._locationId());
    const own =
      read.kind === 'shop'
        ? read.shop.sections.find((one) => one.id === this._sectionId())
        : undefined;
    if (own !== undefined) {
      return catalogName(own.name, this._locale());
    }
    return this._section()?.name.trim() ?? null;
  });

  /** The basket's lines in this section, or null when the map counts no basket. */
  protected readonly lines = computed<readonly ShopMapLine[] | null>(() => {
    const lines = this._maps.lines();
    return lines === null ? null : shopMapLinesIn(lines, this._sectionId());
  });

  protected readonly left = computed(
    () => this.lines()?.filter((line) => !isSettledMapLine(line)).length ?? 0
  );

  /** "Stop 4 of 17 · 2 things still to get", or its parts that apply. */
  protected readonly detail = computed(() => {
    const map = this._maps.map();
    this._translator.loaded();
    const locale = this._locale();
    const t = (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);

    const parts: string[] = [];
    const at =
      map === null ? null : shopMapSectionPosition(map, this._sectionId());
    if (at !== null) {
      parts.push(t('shopMap.section.position', { ...at }));
    }
    const lines = this.lines();
    if (lines !== null) {
      parts.push(
        lines.length === 0
          ? t('shopMap.section.nothing')
          : this.left() > 0
            ? t('shopMap.section.left', { count: this.left() })
            : t('shopMap.section.allGot')
      );
    }
    return parts.join(' · ');
  });

  /** The note the mapper left beside this section, or null. */
  protected readonly note = computed(() => {
    const map = this._maps.map();
    const section = this._section();
    return map === null || section === null
      ? null
      : shopMapSectionNote(map, section.name);
  });

  protected readonly known = computed(() => this._section() !== null);

  protected settled(line: ShopMapLine): boolean {
    return isSettledMapLine(line);
  }

  /** Cancel, the scrim and Escape. On a cold load, the map it covers. */
  async dismiss(): Promise<void> {
    const basket = this._query().get(SHOP_PATHS.basketParam);
    await this._sheet.dismiss(
      shopMapPath(
        this._locale(),
        this._basePath,
        this._locationId(),
        basket === null || basket === '' ? null : basket
      )
    );
  }
}
