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
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ItemNames, LineStore } from '@portfolio/velista/data-access';
import {
  LINE_CONTENT_MAX_LENGTH,
  lineNameChange,
} from '@portfolio/velista/models';
import { SheetNavigation } from '@portfolio/velista/platform';
import {
  productDetailText,
  SheetShell,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { LineGoneNotice, watchLineGone } from '../line-gone/line-gone';
import {
  mergeProductsMaxOf,
  mergeQuestionOf,
  type MergeQuestion,
} from '../line-merge-question';
import { watchLineName } from '../line-page/line-name';
import { lineUrls } from '../line-page/line-urls';
import { listErrorKey } from '../list-error-copy';

/**
 * Give a line a name, change it, or take it away (velista `0144`, section 4), from
 * the three dots of its page and from "Add a name" on it (velista `0135`, section 6).
 *
 * One field and Save. The field is focused on arrival, which the sheet rules
 * allow for a sheet whose whole job is typing one value.
 *
 * ## A line made from a product has no name of its own
 *
 * It is drawn with the product's name, so its field starts empty. Text names the
 * line. An empty field on a named line that holds a product takes the name away,
 * and the line is drawn with the product's name again. What a save sends is
 * `lineNameChange`, the same function the sheet of a row uses.
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
  private readonly _itemNames = inject(ItemNames);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);
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

  private readonly _name = watchLineName(() => this._line());

  /** The name the line is drawn with, for the title of the question. */
  readonly lineName = computed(() => this._name()?.text ?? '');

  /** The product's name, as the empty field's hint. */
  readonly productName = computed(() => this._name()?.productName ?? null);

  /**
   * The product the line shows, under the title: its name, its format and its
   * brand. Null on a line with no product.
   */
  readonly product = computed(() => {
    const itemId = this._name()?.itemId ?? null;
    const item = itemId === null ? null : this._itemNames.nameOf(itemId);
    const name = this.productName();
    if (item === null || name === null) {
      return null;
    }
    const locale = this._locale();
    this._translator.loaded();
    const detail = productDetailText(item, locale, (key, args) =>
      this._translator.t(key, undefined, locale, args)
    );
    return detail === null ? name : `${name} · ${detail}`;
  });

  /** What Save sends, or null when there is nothing it may send. */
  private readonly _change = computed(() => {
    const line = this._line();
    const name = this._name();
    return line === undefined || name === null
      ? null
      : lineNameChange(line, name, this.name());
  });

  readonly canSave = computed(() => this._change() !== null && !this.saving());

  private readonly _question = viewChild<ElementRef<HTMLElement>>('question');
  private readonly _field = viewChild<ElementRef<HTMLInputElement>>('field');

  /**
   * What the field was last given from the line, or null before it was. The field
   * follows the line only while it still holds this, so typing is never undone.
   */
  private _seeded: string | null = null;

  constructor() {
    // The name arrives with the line, which on a cold load is after the sheet. The
    // names of its products can come later still and show that the line's name is
    // a product's (velista `0144`, section 2), and then the field empties, as long
    // as nobody has typed in it.
    effect(() => {
      const field = this._name()?.field;
      if (field === undefined || this.saving()) {
        return;
      }
      untracked(() => {
        if (this._seeded === null || this.name() === this._seeded) {
          this._seeded = field;
          this.name.set(field);
        }
      });
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
    const change = this._change();
    if (line === undefined || change === null) {
      return;
    }

    this.saving.set(true);
    this.errorKey.set(null);
    this.errorArgs.set(undefined);

    // Text names the line; an empty field takes the name away, and the merge
    // question answers either (velista `0144`, section 4).
    const outcome = await this._lines.updateLine(line.id, {
      ...change,
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
