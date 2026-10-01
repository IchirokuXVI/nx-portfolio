import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import type { AreaKind } from '@portfolio/luna-shopper/shop-map/model';
import { ShopMapStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  areaIdOf,
  locationIdOf,
  noteIdOf,
  SheetNavigation,
  SHOP_PATHS,
  shopMapPath,
} from '@portfolio/velista/platform';
import { CloseIcon, SheetShell } from '@portfolio/velista/ui';

/** What the sheet is about, once the map has been read. */
export type Place =
  | {
      readonly kind: 'area';
      /** The name the mapper gave it, or null for one with none. */
      readonly name: string | null;
      readonly areaKind: AreaKind;
    }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'missing' };

/**
 * A place on the map that is not a section the shop knows (velista `0129`,
 * target 6): a checkout, the entrance, a counter or a shelf whose section the
 * shop does not list, or a note. It says what the place is and nothing it
 * cannot fill: an area shows its name with the word for its kind under it, or
 * the word alone, and a note shows its text.
 *
 * `shops/:locationId/map/sheet/areas/:areaId` and `.../sheet/notes/:noteId`,
 * over the map. It reads the map the page already opened, like the section
 * sheet.
 */
@Component({
  selector: 'lib-shop-place-sheet',
  imports: [CloseIcon, RokuTranslatorPipe, SheetShell],
  templateUrl: './place-sheet.html',
  // The section sheet's head and note, which this sheet draws the same.
  styleUrl: '../section-sheet/section-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceSheet {
  private readonly _maps = inject(ShopMapStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _locationId = locationIdOf(this._route);
  private readonly _areaId = areaIdOf(this._route);
  private readonly _noteId = noteIdOf(this._route);

  /** Null while the map is still being read. */
  protected readonly place = computed<Place | null>(() => {
    const map = this._maps.map();
    if (map === null) {
      // The page opens the map: until that read answers, there is nothing to say.
      const status = this._maps.status();
      return status === 'none' || status === 'failed'
        ? { kind: 'missing' }
        : null;
    }
    const noteId = this._noteId();
    if (noteId !== '') {
      const note = map.notes.find((one) => one.id === noteId);
      return note === undefined
        ? { kind: 'missing' }
        : { kind: 'note', text: note.text };
    }
    const area = map.document.areas.find((one) => one.id === this._areaId());
    if (area === undefined) {
      return { kind: 'missing' };
    }
    const name = (area.label ?? area.section ?? '').trim();
    return {
      kind: 'area',
      name: name === '' ? null : name,
      areaKind: area.kind,
    };
  });

  // One signal per case, because a template does not narrow a union.
  protected readonly area = computed(() => {
    const place = this.place();
    return place?.kind === 'area' ? place : null;
  });

  protected readonly note = computed(() => {
    const place = this.place();
    return place?.kind === 'note' ? place : null;
  });

  protected readonly missing = computed(() => this.place()?.kind === 'missing');

  /** Cancel, the scrim and Escape. On a cold load, the map it covers. */
  async dismiss(): Promise<void> {
    const basket = this._route.snapshot.queryParamMap.get(
      SHOP_PATHS.basketParam
    );
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
