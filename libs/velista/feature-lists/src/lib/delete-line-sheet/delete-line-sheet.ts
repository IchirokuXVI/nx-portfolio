import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { LineStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  SheetNavigation,
  zoneIdOf,
} from '@portfolio/velista/platform';
import { ConfirmSheet, SheetShell } from '@portfolio/velista/ui';
import { LineGoneNotice, watchLineGone } from '../line-gone/line-gone';
import { listErrorKey } from '../list-error-copy';

/**
 * Take one line off the list, for everybody.
 *
 * `ConfirmSheet` unchanged, which is `0010`'s component and the point of having built
 * it: everything except the copy and the request is identical to the four confirms on
 * the members screen.
 *
 * **No typed name here.** `0010` set the rule that friction is proportional to what is
 * lost, and one line is a tap to recreate. The list itself is the thing that asks for a
 * name, and only when it has lines on it (section 6).
 *
 * The delete is optimistic like every other write on this screen, so the row leaves
 * before the response and comes back if it fails.
 */
@Component({
  selector: 'lib-delete-line-sheet',
  imports: [RokuTranslatorPipe, ConfirmSheet, SheetShell, LineGoneNotice],
  template: `
    @if (gone.reason(); as reason) {
      <lib-sheet-shell (dismiss)="dismiss()" labelledBy="delete-line-title">
        <lib-line-gone-notice
          (closed)="gone.acknowledge()"
          [reason]="reason"
          titleId="delete-line-title"
        />
      </lib-sheet-shell>
    } @else {
      <lib-confirm-sheet
        (confirm)="confirm()"
        (dismiss)="dismiss()"
        [body]="'list.confirm.deleteLine.body' | rokuT"
        [busy]="submitting()"
        [confirmLabel]="'list.confirm.deleteLine.action' | rokuT"
        [destructive]="true"
        [errorKey]="errorKey()"
        [title]="'list.confirm.deleteLine.title' | rokuT: { name: lineName() }"
        titleId="delete-line-title"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteLineSheet {
  private readonly _lines = inject(LineStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  /**
   * The line going away under the confirmation (velista plan 0083).
   *
   * Held while this sheet's own delete is out: the store marks the line as this
   * reader's before the request, and the confirmation leaves by itself once it lands.
   */
  readonly gone = watchLineGone({
    listId: this.listId,
    lineId: this.lineId,
    close: () => this.dismiss(),
    paused: this.submitting,
  });

  /** What the confirmation names, so the copy says the thing rather than "this item". */
  readonly lineName = computed(
    () =>
      this._lines
        .linesIn(this.listId())
        .find((line) => line.id === this.lineId())?.content ?? ''
  );

  async confirm(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    const outcome = await this._lines.deleteLine(this.lineId());

    if (outcome.state === 'failed') {
      this.submitting.set(false);
      this.errorKey.set(listErrorKey(outcome.error, 'lines.write'));
      return;
    }

    // `submitting` stays true: the sheet is leaving, and the watch must not close it a
    // second time now that the line is gone.
    if (this._route.snapshot.data['popsAfterDelete'] === true) {
      // Over the list, this confirmation was pushed by the detail sheet (velista plan
      // 0083, section 6). Popping lands on that sheet, which finds its line deleted by
      // this reader and pops itself, so the list ends up current with nothing about
      // the deleted line behind it. With nothing to pop, `dismiss` goes to the list.
      await this._sheet.dismiss(this._listUrl());
      return;
    }

    // Over the line page, `leaveTo` rather than `dismiss`: popping would hand back a
    // page about a line that no longer exists, and that page does not close itself.
    await this._sheet.leaveTo(this._listUrl());
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(this._listUrl());
  }

  private _listUrl(): string {
    return appPath(
      this._locale(),
      this._basePath,
      'zones',
      this.zoneId(),
      'lists',
      this.listId()
    );
  }
}
