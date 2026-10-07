import {
  ChangeDetectionStrategy,
  Component,
  inject,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CatalogAddStore } from '@portfolio/velista/data-access';
import { SheetNavigation } from '@portfolio/velista/platform';
import { ListChoice, SheetShell } from '@portfolio/velista/ui';
import { coveredPageUrl } from '../row-adds';

/**
 * "Add to which list?" (velista `0134`, section 4.3)
 *
 * Opened by the name on the line above the tab bar, and by the heading of Similar
 * products on a product's page. It is one sheet and one value: the list chosen
 * here is the list the plus adds to on both pages.
 *
 * Addressed at `<the covered page>/sheet/add-list`, so back dismisses it. It knows
 * neither page by name: the page it closes onto is read from its own route.
 *
 * **A press chooses and closes.** The choice is written as the last used list, so
 * the catalog opens on it next time.
 */
@Component({
  selector: 'lib-add-list-sheet',
  imports: [ListChoice, RokuTranslatorPipe, SheetShell],
  template: `
    <lib-sheet-shell (dismiss)="dismiss()" #shell labelledBy="add-list-title">
      <h2 class="title" id="add-list-title">
        {{ 'catalog.lists.title' | rokuT }}
      </h2>

      @if (lists().length > 0) {
        <lib-list-choice
          (chosen)="choose($event)"
          [lists]="lists()"
          [selectedId]="target()?.listId ?? null"
          labelledBy="add-list-title"
        />
      } @else if (ready()) {
        <p class="note">{{ 'catalog.lists.none' | rokuT }}</p>
      } @else {
        <p class="note" role="status">{{ 'catalog.lists.loading' | rokuT }}</p>
      }

      <button (click)="shell.requestDismiss()" class="close" type="button">
        {{ 'catalog.sheet.close' | rokuT }}
      </button>
    </lib-sheet-shell>
  `,
  styleUrl: './add-list-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddListSheet {
  private readonly _adds = inject(CatalogAddStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _shell = viewChild.required(SheetShell);

  protected readonly lists = this._adds.lists;
  protected readonly target = this._adds.target;
  protected readonly ready = this._adds.ready;

  constructor() {
    // The page underneath has usually read them. A cold load of this URL has not.
    void this._adds.ensure();
  }

  /** A press chooses and closes, through the shell so the sheet falls. */
  protected choose(listId: string): void {
    this._adds.choose(listId);
    this._shell().requestDismiss();
  }

  /** Close, the scrim and Escape. The fallback is the page this sheet covers. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(coveredPageUrl(this._route.snapshot));
  }
}
