import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { LineStore, ListStore } from '@portfolio/velista/data-access';
import { SheetNavigation, sheetSegments } from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { LineGoneNotice, watchLineGone } from '../line-gone/line-gone';
import { watchLineName } from '../line-page/line-name';
import { lineUrls } from '../line-page/line-urls';
import {
  actionsFor,
  editScopeFor,
  selectAbilities,
} from '../select-list-state';

/**
 * What the three dots of the line page hold (velista `0135`, section 6).
 *
 * The rare acts on a line: give it a name or change it, delete it. They left the page so the
 * page can be about the products.
 *
 * **A row the reader may not use is absent, not disabled.** The page draws the
 * three dots only when at least one row is there.
 *
 * Each row **replaces** this sheet with the next one (`leaveTo`), so closing the
 * name sheet or the delete question lands on the line page and not on a menu
 * somebody already chose from.
 */
@Component({
  selector: 'lib-line-menu-sheet',
  imports: [RokuTranslatorPipe, SheetShell, LineGoneNotice],
  template: `
    <lib-sheet-shell (dismiss)="dismiss()" labelledBy="line-menu-title">
      @if (gone.reason(); as reason) {
        <lib-line-gone-notice
          (closed)="gone.acknowledge()"
          [reason]="reason"
          titleId="line-menu-title"
        />
      } @else {
        <h2 class="title" id="line-menu-title">{{ lineName() }}</h2>

        <ul class="acts">
          @if (canRename()) {
            <li>
              <!--
                One sheet either way (plan 0144, section 5). The words say what
                it does to this line: a line with no name of its own gets one.
              -->
              <button
                (click)="rename()"
                [attr.aria-label]="
                  (named() ? 'list.menu.renameLabel' : 'list.menu.addNameLabel')
                    | rokuT: { name: lineName() }
                "
                class="act"
                type="button"
              >
                {{
                  (named() ? 'list.menu.rename' : 'list.menu.addName') | rokuT
                }}
              </button>
            </li>
          }
          @if (canDelete()) {
            <li>
              <button (click)="remove()" class="act is-danger" type="button">
                {{ 'list.menu.delete' | rokuT }}
              </button>
            </li>
          }
        </ul>
      }
    </lib-sheet-shell>
  `,
  styleUrl: './line-menu-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineMenuSheet {
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _urls = lineUrls();

  readonly gone = watchLineGone({
    listId: this._urls.listId,
    lineId: this._urls.lineId,
    close: () => this.dismiss(),
  });

  private readonly _line = computed(() =>
    this._lines
      .linesIn(this._urls.listId())
      .find((line) => line.id === this._urls.lineId())
  );

  private readonly _abilities = computed(() =>
    selectAbilities(
      this._lists
        .listsIn(this._urls.zoneId())
        .find((list) => list.id === this._urls.listId())?.myPermissions ?? []
    )
  );

  private readonly _name = watchLineName(() => this._line());

  readonly lineName = computed(() => this._name()?.text ?? '');

  /** Whether a person named the line: the row then renames, and else adds a name. */
  readonly named = computed(() => this._name()?.own ?? true);

  readonly canRename = computed(() => {
    const line = this._line();
    return line !== undefined && editScopeFor(line, this._abilities()) !== null;
  });

  readonly canDelete = computed(() => {
    const line = this._line();
    return (
      line !== undefined &&
      actionsFor(line, this._abilities()).includes('delete')
    );
  });

  async rename(): Promise<void> {
    await this._sheet.leaveTo(this._urls.line(...sheetSegments('name')));
  }

  async remove(): Promise<void> {
    await this._sheet.leaveTo(
      this._urls.line(...sheetSegments('confirm', 'delete'))
    );
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(this._urls.line());
  }
}
