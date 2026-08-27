import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListRowVm } from '@portfolio/velista/models';
import { ChevronRightIcon, ListLinesIcon } from '../icons/icons';

/**
 * One list, as a row on the group page.
 *
 * Taller and more prominent than the same list inside a zone card, which is a preview
 * of a group rather than the group itself. The counts are the same two and use the same
 * keys, because "7 of 12 ready" means the same thing wherever it is read.
 *
 * The row is a whole button. Unlike the zone card there is nothing nested inside it to
 * conflict with, so the largest possible tap target is also the simplest markup.
 */
@Component({
  selector: 'lib-list-row',
  imports: [RokuTranslatorPipe, ChevronRightIcon, ListLinesIcon],
  template: `
    <button (click)="open.emit(list().id)" class="row" type="button">
      <lib-list-lines-icon class="glyph" />

      <span class="body">
        <span class="name">{{ list().name }}</span>

        @if (
          list().readyCount !== undefined && list().lineCount !== undefined
        ) {
          <span class="meta">{{
            'home.progress.ready'
              | rokuT: { ready: list().readyCount, total: list().lineCount }
          }}</span>
        } @else if (list().lineCount !== undefined) {
          <span class="meta">{{
            'home.list.items' | rokuT: { count: list().lineCount }
          }}</span>
        }
      </span>

      <lib-chevron-right-icon class="chevron" />
    </button>
  `,
  styleUrl: './list-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListRow {
  readonly list = input.required<ListRowVm>();

  readonly open = output<string>();
}
