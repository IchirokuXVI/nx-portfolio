import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  RECORD_CONTEXT,
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  compositeId,
  isRecordChildList,
  type NamedAction,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { RecordSection } from '@portfolio/luna-shopper-admin/ui';
import { instant } from './people-format';
import type { ListLineRow, ListRow } from './people-seed';
import { PEOPLE_STYLES } from './people-styles';
import { ActionConfirm, ActionRunner, isDangerAction } from './row-actions';

/** What the list descriptor calls this panel among its children. */
export const LIST_LINES_PANEL = 'lines';

/** One line of the list, as a row of the panel. */
export interface LineRow {
  readonly line: ListLineRow;
  /** Whether the line waits for somebody to approve or reject it. */
  readonly waiting: boolean;
  /** The line's own record, where its wording and its quantity change. */
  readonly path: readonly string[] | null;
  /** What can be done to this line right now. */
  readonly actions: readonly NamedAction<ResourceRow>[];
}

/**
 * The lines of a list, as a panel of the list's record page (admin plan
 * 0058, section 2.1).
 *
 * It was the lines block of `ListPage`, and is that block as it was: every
 * line, its state, "Approve" and "Reject" where a line waits, and the delete
 * of a line. It holds every line and not five of them, because the lines are
 * what a list is opened for and no other screen lists them.
 *
 * **Approve and reject are the line descriptor's.** They are the two named
 * actions `LIST_LINES` declares, with the rule for when each applies, drawn
 * beside the line they would change. That rule is a line that waits, so a
 * line that was answered draws neither. A line that waits sits on the waiting
 * wash.
 *
 * **A press on a line opens the line's own record**, which reads first and
 * has its own "Edit".
 *
 * **Nothing here adds a line.** A line is written by somebody in the zone, and
 * an operator is nobody in the zone. The info button of the page says so.
 *
 * The lines come with the list's own read, so the panel makes no request of
 * its own and cannot disagree with the count beside its heading. It learns
 * the list from `RECORD_CONTEXT`, and after an action it asks the page to
 * read the list again.
 */
@Component({
  selector: 'lib-list-lines-panel',
  imports: [RouterLink, RokuTranslatorPipe, RecordSection, ActionConfirm],
  template: `
    <lib-record-section
      [count]="count()"
      [heading]="'people.lists.record.lines' | rokuT"
    >
      @if (actions.errorKey(); as key) {
        <p class="refusal" role="alert">{{ key | rokuT }}</p>
      }

      @if (lines().length === 0) {
        <p class="empty" data-empty>{{ 'people.lists.noLines' | rokuT }}</p>
      } @else {
        <ul class="lines" data-lines>
          @for (entry of lines(); track entry.line.id) {
            <li
              [attr.data-line]="entry.line.id"
              [class.waiting]="entry.waiting"
              class="row"
            >
              <span class="row-main">
                @if (entry.path; as path) {
                  <a [routerLink]="path" class="row-title" data-open-line>{{
                    entry.line.content
                  }}</a>
                } @else {
                  <span class="row-title">{{ entry.line.content }}</span>
                }
                <span class="row-line">
                  {{
                    'people.lists.quantity'
                      | rokuT: { count: entry.line.quantity }
                  }}
                  ·
                  {{
                    'people.lists.approval.' + entry.line.approvalStatus | rokuT
                  }}
                  · {{ when(entry.line.createdAt) }}
                </span>
              </span>
              <span class="row-actions">
                @for (action of entry.actions; track action.name) {
                  <button
                    (click)="run(action, entry.line)"
                    [attr.data-action]="action.name"
                    [class.danger]="isDanger(action)"
                    [class.primary]="action.name === 'approve-line'"
                    [disabled]="actions.busy()"
                    class="button small"
                    type="button"
                  >
                    {{ action.label | rokuT }}
                  </button>
                }
                @if (canDelete) {
                  <button
                    (click)="askToDelete(entry.line)"
                    [disabled]="actions.busy()"
                    class="button small danger"
                    type="button"
                    data-delete-line
                  >
                    {{ 'resource.action.delete' | rokuT }}
                  </button>
                }
              </span>
            </li>
          }
        </ul>
      }
    </lib-record-section>

    <lib-action-confirm [runner]="actions" />
  `,
  styles: [
    PEOPLE_STYLES,
    `
      /* A panel among the sections of the page, and not a page of its own. */
      :host {
        display: block;
        flex: none;
      }

      .lines {
        list-style: none;
      }

      /* Every row has a line above it: the first one sits under the heading
         of the section. */
      .row:first-child,
      .empty,
      .refusal {
        border-block-start: 1px solid var(--admin-border);
      }

      .empty {
        padding: var(--admin-space-3) var(--admin-space-4);
        color: var(--admin-ink-muted);
      }

      /* A refusal inside the frame of the section, edge to edge. */
      .refusal {
        border-inline: none;
        border-block-end: none;
        border-radius: 0;
        padding-inline: var(--admin-space-4);
      }

      /* The answer that lets the line count is the last of the two, where
         the main action of a row sits. Delete stays at the very end. */
      .row-actions > .primary {
        order: 1;
      }

      .row-actions > [data-delete-line] {
        order: 2;
      }

      /* A line's controls sit under its words on a phone, where three of
         them do not fit beside a sentence. */
      @media (max-width: 47.99rem) {
        .row {
          flex-direction: column;
          align-items: stretch;
        }

        .row-actions {
          justify-content: flex-start;
        }

        .button.small {
          min-block-size: 2.75rem;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListLinesPanel {
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _translator = inject(RokuTranslatorService);

  private readonly _record = inject(RECORD_CONTEXT);

  readonly actions = new ActionRunner();

  private readonly _lines = this._registry.byName('list-lines');

  readonly canDelete = this._lines?.actions?.delete === true;

  /** The line actions, built once in this injection context. */
  private readonly _named: readonly NamedAction<ResourceRow>[] =
    this._lines?.actions?.named?.() ?? [];

  /** This panel, as the record names it, which is what its count is asked by. */
  private readonly _child = (
    this._record.descriptor.record?.children ?? []
  ).find(
    (child) => !isRecordChildList(child) && child.name === LIST_LINES_PANEL
  );

  /**
   * The list, as the page read it. The read of one list carries its lines,
   * which the descriptor names as no field.
   */
  private readonly _list = computed(() => this._record.row() as ListRow | null);

  /** How many lines the list holds, as the page counts them. */
  readonly count = computed(() =>
    this._child === undefined ? null : this._record.countOf(this._child)
  );

  /** The lines in the order the list holds them. */
  readonly lines = computed<readonly LineRow[]>(() => {
    const list = this._list();
    if (list === null) {
      return [];
    }
    const known = { zoneId: list.zoneId, listId: list.id };

    return (list.lines ?? []).map(
      (line): LineRow => ({
        line,
        waiting: line.approvalStatus === 'PENDING',
        path: this._registry.rowPath(
          'list-lines',
          compositeId([list.id, line.id]),
          known
        ),
        actions: this._named.filter(
          (action) => action.available?.(line) ?? true
        ),
      })
    );
  });

  when(value: string): string {
    return instant(value, this._translator.locale());
  }

  /** Whether the button of an action is red, as its confirmation is. */
  isDanger(action: NamedAction<ResourceRow>): boolean {
    return isDangerAction(action);
  }

  /** Run one of a line's actions, asking first where it says to ask. */
  run(action: NamedAction<ResourceRow>, line: ListLineRow): void {
    this.actions.start(action, line, {
      args: { name: line.content },
      // The tone is the descriptor's: red only for an action marked `danger`.
      after: () => this._changed(),
    });
  }

  askToDelete(line: ListLineRow): void {
    const list = this._list();
    if (list === null || this._lines === undefined) {
      return;
    }
    const lines = this._lines;

    this.actions.ask(
      {
        heading: 'resource.confirm.delete.heading',
        body: 'resource.confirm.delete.body',
        confirm: 'resource.confirm.delete.confirm',
      },
      async () => {
        await this._registry
          .gatewayFor(lines)
          .remove(compositeId([list.id, line.id]));
        await this._changed();
      },
      { args: { name: line.content } }
    );
  }

  /**
   * A line moved, and the lines and their count come with the read of the
   * list.
   *
   * The panel asks for that read and waits for it, whatever the page is
   * doing. The buttons of a row stay off until the action is over, so they
   * must not come back while the old row is still drawn: "Approve" could be
   * pressed a second time on a line that is approved already. The draft of a
   * page that is a form is kept.
   *
   * The others are told after the read. Told before it, the page would start
   * a read of its own, which is newer and so takes the answer of this one
   * away, and the wait would end with the old row on the screen.
   */
  private async _changed(): Promise<void> {
    await this._record.reload();
    this._changes.wrote('list-lines');
    this._changes.wrote('lists');
  }
}
