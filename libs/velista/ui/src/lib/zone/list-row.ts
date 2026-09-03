import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListRowVm } from '@portfolio/velista/models';
import { ChevronRightIcon, ListLinesIcon } from '../icons/icons';
import { PresenceRow } from '../presence/presence-row';

/**
 * One list, as a row on the group page.
 *
 * Taller and more prominent than the same list inside a zone card, which is a preview
 * of a group rather than the group itself. The counts are the same two and use the same
 * keys, because "7 of 12 pending" means the same thing wherever it is read.
 *
 * The row is a whole button. Unlike the zone card there is nothing nested inside it to
 * conflict with, so the largest possible tap target is also the simplest markup.
 */
@Component({
  selector: 'lib-list-row',
  imports: [RokuTranslatorPipe, ChevronRightIcon, ListLinesIcon, PresenceRow],
  template: `
    <button (click)="open.emit(list().id)" class="row" type="button">
      <lib-list-lines-icon class="glyph" />

      <span class="body">
        <span class="name">{{ list().name }}</span>

        <!--
          A strict zero check and never a falsy one: undefined is a count that has not
          arrived and renders nothing, while 0 is an empty list and says so
          (plan 0019, section 3).
        -->
        @if (list().lineCount === 0) {
          <span class="meta">{{ 'list.empty.short' | rokuT }}</span>
        } @else if (
          list().lineCount !== undefined && list().wantedCount === 0
        ) {
          <!--
            Nothing left to buy gets a sentence of its own rather than "0 of 12
            pending", which is true and reads badly (plan 0060, section 3.1).
          -->
          <span class="meta">{{ 'home.progress.done' | rokuT }}</span>
        } @else if (
          list().wantedCount !== undefined && list().lineCount !== undefined
        ) {
          <!--
            The number is what the list still wants, so it counts down as the shop
            gets done. It said "ready" and read as the opposite until plan 0060.
          -->
          <span class="meta">{{
            'home.progress.pending'
              | rokuT: { pending: list().wantedCount, total: list().lineCount }
          }}</span>
        } @else if (list().lineCount !== undefined) {
          <span class="meta">{{
            'home.list.items' | rokuT: { count: list().lineCount }
          }}</span>
        }
      </span>

      <!--
        Who is here on this list: the dot and up to two initials, no names. A row
        has no space for a sentence and the header above already carries one, so the
        sentence is read but not drawn (plan 0022, section 3.3).

        This page holds no subscription to the list. Backend plan 0032 broadcasts a
        group's list presence to the group's members, so these are filled for every
        readable list in a zone the caller subscribes to, this row's included.
      -->
      <lib-presence-row
        [compact]="true"
        [names]="list().viewers"
        countKey="home.presence.hereCount"
        messageKey="home.presence.here"
      />

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
