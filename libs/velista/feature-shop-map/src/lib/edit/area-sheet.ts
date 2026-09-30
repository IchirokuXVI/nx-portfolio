import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  AreaColour,
  MapArea,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  areaIdOf,
  SheetNavigation,
  ThemeStore,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import {
  AREA_COLOURS,
  areaKindKey,
  areaName,
  MAP_EDIT_SESSION,
  metresText,
  renamedArea,
  sameColour,
  swatchStyle,
  takesSection,
  type SwatchStyle,
} from './map-edits';

/** The query parameter that opens the sheet with its name field (Change its section). */
export const AREA_SHEET_RENAME_PARAM = 'rename';

/** The longest name an area takes, like a section mark's text. */
export const AREA_NAME_MAX_LENGTH = 80;

interface ColourChoice {
  readonly key: string;
  readonly colour: AreaColour;
  readonly style: SwatchStyle;
}

/**
 * One area of the map (velista `0123`, target 3; the `EditArea` board): its name
 * with Rename, its kind and size ("Section · 1.4 m × 11 m"), the category colour
 * box (disabled until categories have colours, backend backlog `0018`), the row
 * of colours with Default first, and Delete with a confirmation.
 *
 * `…/edit/sheet/areas/:areaId`. It reads and writes the map only through
 * `MAP_EDIT_SESSION`, so the recording screen of velista `0126` offers the same
 * sheet by providing that token. A change applies at once; the page saves it.
 */
@Component({
  selector: 'lib-area-sheet',
  imports: [FormsModule, RokuTranslatorPipe, SheetShell],
  templateUrl: './area-sheet.html',
  styleUrl: './area-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AreaSheet {
  private readonly _session = inject(MAP_EDIT_SESSION);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _theme = inject(ThemeStore).theme;
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly areaId = areaIdOf(this._route);

  protected readonly area = computed<MapArea | null>(
    () =>
      this._session
        .document()
        ?.areas.find((area) => area.id === this.areaId()) ?? null
  );

  protected readonly name = computed(() => {
    const area = this.area();
    return area === null ? null : areaName(area);
  });

  protected readonly kindKey = computed(() => {
    const area = this.area();
    return area === null ? '' : areaKindKey(area);
  });

  protected readonly size = computed(() => {
    const area = this.area();
    const locale = this._locale();
    return area === null
      ? { w: '', h: '' }
      : { w: metresText(area.w, locale), h: metresText(area.h, locale) };
  });

  /** On for an area drawn on this page, and for one already set to its category's. */
  protected readonly categoryColour = computed(() => {
    const area = this.area();
    return (
      area !== null &&
      (area.colour.mode === 'category' ||
        (area.colour.mode === 'default' && this._session.isNew(area.id)))
    );
  });

  protected readonly colours = computed<ColourChoice[]>(() => {
    const area = this.area();
    const theme = this._theme();
    if (area === null) {
      return [];
    }
    const choices: { key: string; colour: AreaColour }[] = [
      { key: 'default', colour: { mode: 'default' } },
      ...AREA_COLOURS.map((one) => ({
        key: one.key,
        colour: { mode: 'custom', value: one.value } as AreaColour,
      })),
    ];
    return choices.map((choice) => ({
      ...choice,
      style: swatchStyle(choice.colour, area.kind, theme),
    }));
  });

  protected readonly renaming = signal(
    this._route.snapshot.queryParamMap.get(AREA_SHEET_RENAME_PARAM) !== null
  );
  protected readonly draft = signal('');
  protected readonly confirming = signal(false);
  protected readonly nameMax = AREA_NAME_MAX_LENGTH;

  constructor() {
    effect(() => {
      const id = this.areaId();
      const present = this.area() !== null;
      untracked(() => {
        if (present) {
          this._session.select(id);
        }
      });
    });
    effect(() => {
      const renaming = this.renaming();
      const name = untracked(this.name);
      if (renaming) {
        untracked(() => this.draft.set(name ?? ''));
      }
    });
  }

  protected isChosen(colour: AreaColour): boolean {
    const area = this.area();
    if (area === null) {
      return false;
    }
    // The category colour is not drawn yet, so such an area shows as Default.
    const shown: AreaColour =
      area.colour.mode === 'category' ? { mode: 'default' } : area.colour;
    return sameColour(shown, colour);
  }

  protected renameLabelKey(): string {
    const area = this.area();
    return area !== null && takesSection(area.kind)
      ? 'shopMapEdit.area.sectionName'
      : 'shopMapEdit.area.name';
  }

  protected startRename(): void {
    this.renaming.set(true);
  }

  protected cancelRename(): void {
    this.renaming.set(false);
  }

  protected saveName(): void {
    const area = this.area();
    if (area === null) {
      return;
    }
    const next = renamedArea(area, this.draft());
    if (next.section !== area.section || next.label !== area.label) {
      this._session.apply([{ type: 'area-put', area: next }]);
    }
    this.renaming.set(false);
  }

  protected choose(colour: AreaColour): void {
    const area = this.area();
    if (area === null || this.isChosen(colour)) {
      return;
    }
    this._session.apply([{ type: 'area-put', area: { ...area, colour } }]);
  }

  protected askDelete(): void {
    this.confirming.set(true);
  }

  protected keep(): void {
    this.confirming.set(false);
  }

  protected async remove(): Promise<void> {
    const area = this.area();
    if (area === null) {
      return;
    }
    this._session.select(null);
    this._session.apply([{ type: 'area-removed', id: area.id }]);
    await this._sheet.leaveTo(this._session.pageUrl());
  }

  dismiss(): Promise<void> {
    return this._sheet.dismiss(this._session.pageUrl());
  }
}
