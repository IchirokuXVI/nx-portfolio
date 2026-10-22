import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ActionOutcomeDialog,
  RecordPage,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  CautionLine,
  ConfirmDialog,
  PageHeader,
} from '@portfolio/luna-shopper-admin/ui';
import { ScheduleView } from './schedule-view';

/**
 * The page of one schedule (admin plan 0067, target 3): the record page, with
 * a body of its own.
 *
 * **It is `RecordPage`.** The header, the More menu, the named actions and
 * their questions, the leave guard, "added" and where the app goes after a
 * save are all the record page's, inherited and not written again. Only two
 * things differ, and both are in the template:
 *
 * - **The body is `ScheduleView`** and not `RecordView`, because three of its
 *   controls are no field kind: seven day toggles, a time of day, and the box
 *   of the consent. It is built from the parts `RecordView` is built from, so
 *   the rows, the bar and the Record block look and behave as on any record.
 * - **The question of a named action is handed the chain**, beside the title.
 *   Turning a schedule on asks the consent a new schedule asks, and that
 *   sentence names the chain whose website is fetched.
 *
 * A schedule holds no collection, so the page draws no tabs and no outlet.
 */
@Component({
  selector: 'lib-schedule-page',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    ActionOutcomeDialog,
    CautionLine,
    ConfirmDialog,
    PageHeader,
    ScheduleView,
  ],
  template: `
    @let record = store();
    @let status = record.status();

    <lib-page-header
      [backLabel]="backLabel()"
      [backLink]="listUrl"
      [heading]="heading()"
      [info]="descriptor.info ?? null"
      [loading]="status === 'loading'"
      [moreLabel]="moreLabel()"
      [subtitle]="subtitle()"
      overflow="menu"
    >
      @for (chip of chips(); track chip.label) {
        <span
          [class.danger]="chip.tone === 'danger'"
          [class.good]="chip.tone === 'good'"
          [class.waiting]="chip.tone === 'waiting'"
          class="chip"
          pageChip
          >{{ chip.label | rokuT: chip.args ?? {} }}</span
        >
      }

      @if (canEdit()) {
        <button (click)="edit()" pageAction type="button" data-edit>
          {{ 'resource.action.edit' | rokuT }}
        </button>
      }

      @for (action of plainActions(); track action.name) {
        <button
          (click)="run(action)"
          [attr.data-action]="action.name"
          [disabled]="working()"
          pageMoreAction
          type="button"
        >
          {{ action.label | rokuT }}
        </button>
      }

      @for (action of dangerActions(); track action.name) {
        <button
          (click)="run(action)"
          [attr.data-action]="action.name"
          [disabled]="working()"
          pageMoreDanger
          type="button"
        >
          {{ action.label | rokuT }}
        </button>
      }
    </lib-page-header>

    @if (status === 'missing') {
      <section class="state" data-missing>
        <p>{{ 'record.state.missing.body' | rokuT: { name: noun() } }}</p>
        <a [routerLink]="listUrl" class="button">{{
          'record.state.missing.list'
            | rokuT: { list: (descriptor.labels.many | rokuT) }
        }}</a>
      </section>
    } @else if (status === 'error') {
      <lib-caution-line [text]="errorText()" tone="refused" data-no-answer>
        <button (click)="retry()" class="retry" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </lib-caution-line>
    } @else {
      @if (status === 'loading') {
        <p class="sr-only" role="status">{{ heading() }}</p>
      }
      <!-- What a named action said once it went through, as on the record
           page. -->
      @if (done(); as said) {
        <lib-caution-line
          [text]="said.key | rokuT: said.args ?? {}"
          tone="saved"
          data-action-done
        />
      }
      @for (key of keys(); track key) {
        <lib-schedule-view
          (addAnother)="addAnother()"
          (cancel)="cancel()"
          (saved)="saved($event)"
          [added]="added()"
          [descriptor]="descriptor"
          [refusal]="refusal()"
          [store]="record"
        />
      }
    }

    @if (leaving()) {
      <lib-confirm-dialog
        (confirm)="answerLeave(true)"
        (dismiss)="answerLeave(false)"
        [bodyArgs]="leaveArgs()"
        [bodyKey]="
          record.mode() === 'create'
            ? 'record.leave.bodyNew'
            : 'record.leave.body'
        "
        confirmKey="resource.confirm.discard.confirm"
        dismissKey="record.leave.stay"
        headingKey="resource.confirm.discard.heading"
        prefer="dismiss"
        data-leave
      />
    }

    @if (asking(); as action) {
      @if (action.confirm; as question) {
        <lib-confirm-dialog
          (confirm)="confirmAction()"
          (dismiss)="asking.set(null)"
          [bodyArgs]="{ name: title(), chain: chain() }"
          [bodyKey]="question.body"
          [busy]="working()"
          [confirmKey]="question.confirm"
          [headingArgs]="{ name: title() }"
          [headingKey]="question.heading"
          [tone]="action.danger ? 'danger' : 'primary'"
          data-action-question
        />
      }
    }

    @if (panel(); as shown) {
      <lib-action-outcome-dialog
        (closed)="panel.set(null)"
        [headingArgs]="{ name: title() }"
        [headingKey]="shown.heading"
        [inputs]="shown.inputs"
        [panel]="shown.panel"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    .chip {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-neutral-on-wash);
    }

    .chip.good {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .chip.waiting {
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    .chip.danger {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    button {
      font-weight: 500;
      cursor: pointer;
    }

    button:focus-visible,
    .button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .state {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      max-inline-size: 47.5rem;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .button {
      display: inline-flex;
      align-items: center;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border-radius: var(--admin-radius-control);
      background: var(--admin-accent);
      font-weight: 500;
      text-decoration: none;
      color: var(--admin-accent-ink);
    }

    lib-caution-line {
      align-items: center;
      max-inline-size: 47.5rem;
    }

    .retry {
      margin-inline-start: var(--admin-space-2);
    }

    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchedulePage extends RecordPage {
  /**
   * The chain whose website a schedule fetches, for the question that turns
   * it on. Its ID until the name is read.
   */
  readonly chain = computed(() => {
    const row = this.store().row();
    const name = row?.['chainName'];
    if (typeof name === 'string' && name !== '') {
      return name;
    }
    return typeof row?.['supermarketId'] === 'string'
      ? row['supermarketId']
      : '';
  });
}
