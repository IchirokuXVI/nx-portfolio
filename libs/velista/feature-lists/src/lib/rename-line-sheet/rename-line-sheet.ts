import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { LineStore } from '@portfolio/velista/data-access';
import { LINE_CONTENT_MAX_LENGTH } from '@portfolio/velista/models';
import { SheetNavigation } from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { LineGoneNotice, watchLineGone } from '../line-gone/line-gone';
import {
  mergeProductsMaxOf,
  mergeQuestionOf,
  type MergeQuestion,
} from '../line-merge-question';
import { lineUrls } from '../line-page/line-urls';
import { listErrorKey } from '../list-error-copy';

/**
 * Change the name of a line, from the three dots of its page (velista `0135`,
 * section 6).
 *
 * One field and Save. The field is focused on arrival, which the sheet rules
 * allow for a sheet whose whole job is typing one value.
 *
 * ## A name another line holds asks first
 *
 * The server refuses the rename with the other line's name and number (backend
 * plan 0112). The sheet then asks in place of its field, and Merge repeats the
 * save with `confirmMerge`. The earlier line survives, so a merge can leave this
 * line's id behind. The sheet then goes to the page of the line that remains.
 *
 * The refusal is read by `mergeQuestionOf`, the same function the detail sheet
 * over the list uses, so the two cannot read it differently.
 */
@Component({
  selector: 'lib-rename-line-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon, LineGoneNotice],
  templateUrl: './rename-line-sheet.html',
  styleUrl: './rename-line-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameLineSheet {
  private readonly _lines = inject(LineStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _injector = inject(Injector);
  private readonly _urls = lineUrls();

  readonly maxLength = LINE_CONTENT_MAX_LENGTH;

  /** What the field holds. */
  readonly name = signal('');

  readonly saving = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly errorArgs = signal<Record<string, number> | undefined>(undefined);

  /** The merge question, while it is being asked. */
  readonly merge = signal<MergeQuestion | null>(null);

  /** Following the survivor of a merge, which is this sheet leaving on purpose. */
  private readonly _leaving = signal(false);

  readonly gone = watchLineGone({
    listId: this._urls.listId,
    lineId: this._urls.lineId,
    close: () => this.dismiss(),
    paused: computed(() => this.saving() || this._leaving()),
  });

  private readonly _line = computed(() =>
    this._lines
      .linesIn(this._urls.listId())
      .find((line) => line.id === this._urls.lineId())
  );

  /** The name as it is saved, for the title of the question. */
  readonly lineName = computed(() => this._line()?.content ?? '');

  readonly canSave = computed(() => {
    const line = this._line();
    const typed = this.name().trim();
    return (
      line !== undefined &&
      typed !== '' &&
      typed !== line.content &&
      !this.saving()
    );
  });

  private readonly _question = viewChild<ElementRef<HTMLElement>>('question');
  private readonly _field = viewChild<ElementRef<HTMLInputElement>>('field');

  /** Whether the field took the line's name yet. Once, so typing is never undone. */
  private _seeded = false;

  constructor() {
    // The name arrives with the line, which on a cold load is after the sheet.
    effect(() => {
      const line = this._line();
      if (line === undefined || this._seeded) {
        return;
      }
      this._seeded = true;
      untracked(() => this.name.set(line.content));
    });
  }

  onInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.errorKey.set(null);
  }

  async save(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.canSave()) {
      return;
    }
    await this._save(false);
  }

  /** Merge, from the question. */
  async confirmMerge(): Promise<void> {
    if (this.saving()) {
      return;
    }
    await this._save(true);
  }

  /** Back to the field from the question, with what was typed still in it. */
  keepEditing(): void {
    this.merge.set(null);
    afterNextRender(() => this._field()?.nativeElement.focus(), {
      injector: this._injector,
    });
  }

  private async _save(confirmMerge: boolean): Promise<void> {
    const line = this._line();
    if (line === undefined) {
      return;
    }

    this.saving.set(true);
    this.errorKey.set(null);
    this.errorArgs.set(undefined);

    const outcome = await this._lines.updateLine(line.id, {
      content: this.name().trim(),
      ...(confirmMerge ? { confirmMerge: true } : {}),
    });

    if (outcome.state === 'failed') {
      this.saving.set(false);
      this._refused(outcome.error, line.quantity);
      return;
    }

    if (outcome.line.id !== line.id) {
      // This line was the one absorbed. Before `saving` drops, so the watch never
      // sees the line gone and unheld. The page under the sheet is about a line
      // that no longer exists, so the survivor's page takes its place.
      this._leaving.set(true);
      this.saving.set(false);
      await this._sheet.leaveTo(this._urls.lineOf(outcome.line.id));
      return;
    }

    // `saving` stays true: the sheet is leaving.
    await this.dismiss();
  }

  private _refused(error: unknown, amount: number): void {
    const question = mergeQuestionOf(error, amount);
    if (question !== null) {
      this.merge.set(question);
      afterNextRender(() => this._question()?.nativeElement.focus(), {
        injector: this._injector,
      });
      return;
    }

    this.merge.set(null);
    this.errorKey.set(
      listErrorKey(error, 'lines.write') ?? 'list.detail.failed'
    );
    const max = mergeProductsMaxOf(error);
    this.errorArgs.set(max === null ? undefined : { max });
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(this._urls.line());
  }
}
