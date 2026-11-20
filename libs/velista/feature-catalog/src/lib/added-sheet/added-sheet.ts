import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { CatalogAddStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, visitSections } from '@portfolio/velista/models';
import { appPath, SheetNavigation } from '@portfolio/velista/platform';
import {
  SheetShell,
  VisitAdded,
  type VisitAddedSection,
  type VisitAddedStep,
} from '@portfolio/velista/ui';
import { coveredPageUrl } from '../row-adds';

/**
 * What this visit to the catalog added (velista `0134`, section 4.4).
 *
 * Opened by the count on the line above the tab bar. One row for each line the
 * person added to since they came to the catalog, with a stepper. The minus at the
 * floor takes the product back, one quiet button takes back all of a list, and a
 * link opens the list.
 *
 * **Taking back undoes what the visit did, and no more.** The rule is the store's
 * and the model's (`visitTakeBack`). This draws the record and passes presses on.
 *
 * When the last product is taken back the sheet closes by itself: an empty sheet
 * has nothing left to offer but its Close button.
 */
@Component({
  selector: 'lib-added-sheet',
  imports: [RokuTranslatorPipe, SheetShell, VisitAdded],
  template: `
    <lib-sheet-shell (dismiss)="dismiss()" #shell labelledBy="added-title">
      <h2 class="title" id="added-title">
        @if (sections().length === 1) {
          {{ 'catalog.added.title' | rokuT: { list: sections()[0].name } }}
        } @else {
          {{ 'catalog.added.titleMany' | rokuT }}
        }
      </h2>

      @if (sections().length > 0) {
        <p class="note">{{ 'catalog.added.note' | rokuT }}</p>
        <lib-visit-added
          (allTakenBack)="takeAllBack($event)"
          (listOpened)="openList($event)"
          (stepped)="step($event)"
          [sections]="sections()"
          class="added"
        />
      } @else {
        <p class="note">{{ 'catalog.added.none' | rokuT }}</p>
      }

      <button (click)="shell.requestDismiss()" class="close" type="button">
        {{ 'catalog.sheet.close' | rokuT }}
      </button>
    </lib-sheet-shell>
  `,
  styleUrl: './added-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddedSheet {
  private readonly _adds = inject(CatalogAddStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _shell = viewChild.required(SheetShell);

  /** The record, one section for each list, the chosen list first. */
  protected readonly sections = computed<readonly VisitAddedSection[]>(() => {
    const lists = this._adds.lists();
    const held = new Map(this._adds.held().map((line) => [line.lineId, line]));
    return visitSections(
      this._adds.visit(),
      this._adds.target()?.listId ?? null
    ).map((section) => ({
      listId: section.listId,
      name: lists.find((list) => list.listId === section.listId)?.name ?? '',
      rows: section.entries.map((entry) => ({
        lineId: entry.lineId,
        itemId: entry.itemId,
        name: entry.name,
        detail: entry.detail,
        imageUrl: entry.imageUrl,
        // The amount drawn, off the store's held line: a run a stepper opened is
        // in it at once, and the record has it only once the run is written
        // (velista 0188 S12). A sheet opened inside that wait drew the record's
        // older amount, and its minus at 1 took a line at 2 back.
        quantity: held.get(entry.lineId)?.quantity ?? entry.quantity,
        // What it counts (velista `0182`) and its product's step (`0186`).
        unit: held.get(entry.lineId)?.unit ?? 'UNIT',
        step: held.get(entry.lineId)?.step ?? null,
        // A line the visit made goes to 0 and is taken back there, a weight as a
        // count (velista 0188 S14); one that was there before stops at what it held.
        min: entry.created ? 0 : entry.before,
        pending: entry.pending,
      })),
    }));
  });

  constructor() {
    // Close once the last product is taken back. Only after there was one: a cold
    // load of this URL starts empty, and says so rather than closing on arrival.
    let held = this.sections().length > 0;
    effect(() => {
      const has = this.sections().length > 0;
      if (held && !has) {
        untracked(() => this._shell().requestDismiss());
      }
      held = has;
    });
  }

  protected step(step: VisitAddedStep): void {
    this._adds.step(
      {
        listId: step.listId,
        itemId: step.itemId,
        detail: step.detail,
        imageUrl: step.imageUrl,
      },
      step.lineId,
      step.step
    );
  }

  protected takeAllBack(listId: string): void {
    void this._adds.takeAllBack(listId);
  }

  /**
   * Open the list. It replaces this sheet's entry, so back from the list lands on
   * the catalog and not on a sheet whose record is gone by then.
   */
  protected openList(listId: string): void {
    const list = this._adds.lists().find((held) => held.listId === listId);
    if (list === undefined) {
      return;
    }
    void this._sheet.leaveTo(
      appPath(
        this._locale(),
        this._basePath,
        'zones',
        list.zoneId,
        'lists',
        list.listId
      )
    );
  }

  /** Close, the scrim and Escape. The fallback is the catalog it covers. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(coveredPageUrl(this._route.snapshot));
  }
}
