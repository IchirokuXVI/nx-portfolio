import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  output,
  viewChildren,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import type { AddChoiceRow } from '@portfolio/velista/models';
import { handleBackWhile } from '@portfolio/velista/platform';
import { ChevronLeftIcon, PlusIcon } from '../icons/icons';
import { ProductPicture } from './product-picture';

/** Where the question is asked, which decides how its title reads. */
export type AddChoiceScope = 'list' | 'basket';

/** Numbers each title, so two on a page never share an id. */
let choiceCount = 0;

/**
 * Which line takes it? The question a typed name already on the list asks, when two
 * or more lines that hold a product carry it (velista `0170`, alternative D).
 *
 * The content of an `AnchoredPopover` held against the plus that was pressed. One
 * row per line the server named, in its order: the line's thumb, its name, the
 * product's brand and size, and what its quantity goes from and to. "A new line"
 * comes last. A row is the answer, so a press sends the add again.
 *
 * ## The title wraps and the count does not shrink
 *
 * The title is the name as the first line stores it, which can be anything somebody
 * wrote, so it wraps
 * on as many lines as it needs and breaks a word with no spaces anywhere. A row's
 * name and product line are cut with an ellipsis instead, because the count beside
 * them is the part of the row that answers the question.
 *
 * ## Focus
 *
 * Focus moves to the first row when it opens. The container hands it back to the
 * plus when it closes, because only the container knows where it came from. Escape
 * and a press outside are the popover's to report; the back gesture is this
 * component's, through the back stack, since it has no route of its own.
 *
 * Plain values in and three answers out. It knows nothing of lists, stores or the
 * request: the page builds the rows from the refusal and the catalog it holds.
 */
@Component({
  selector: 'lib-add-choice',
  imports: [RokuTranslatorPipe, ProductPicture, PlusIcon, ChevronLeftIcon],
  template: `
    @if (back(); as listName) {
      <!--
        The basket asks which list first (velista 0116), and this is the way back
        to that question, with the list that was picked as its words.
      -->
      <button
        (click)="returned.emit()"
        [attr.aria-label]="'basket.addChoice.back' | rokuT: { list: listName }"
        class="back"
        type="button"
      >
        <lib-chevron-left-icon aria-hidden="true" class="back-glyph" />
        <span class="back-name">{{ listName }}</span>
      </button>
    }
    <h2 [id]="titleId()" class="title">
      {{ titleKey() | rokuT: { name: name() } }}
    </h2>
    <ul class="rows">
      @for (row of rows(); track row.lineId) {
        <li>
          <button
            (click)="chose.emit(row.lineId)"
            [attr.aria-label]="rowLabel(row) | rokuT: rowArgs(row)"
            #option
            class="row"
            type="button"
          >
            <lib-product-picture [imageUrl]="row.imageUrl" class="thumb" />
            <span class="text">
              <span class="name">{{ row.name }}</span>
              @if (row.product !== null) {
                <span class="product">{{ row.product }}</span>
              }
            </span>
            <span aria-hidden="true" class="count"
              >{{ number(row.from) }} &rarr;
              <b class="to">{{ number(row.to) }}</b></span
            >
          </button>
        </li>
      }
      <li>
        <button (click)="newLine.emit()" #option class="row new" type="button">
          <span aria-hidden="true" class="thumb dashed">
            <lib-plus-icon class="dashed-glyph" />
          </span>
          <span class="text">
            <span class="name">{{ 'list.addChoice.newLine' | rokuT }}</span>
          </span>
        </button>
      </li>
    </ul>
  `,
  styleUrl: './add-choice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddChoice {
  /**
   * The name the title says: the stored words of the first line (`addChoiceName`),
   * which is the rows' own spelling, and not the words as typed.
   */
  readonly name = input.required<string>();

  /** The lines that carry them, in the order the server named them. */
  readonly rows = input.required<readonly AddChoiceRow[]>();

  /** How many the add carries, for each row's accessible name. */
  readonly added = input(1);

  readonly scope = input<AddChoiceScope>('list');

  /**
   * The list the basket's picker chose, drawn as the way back to it, or null. An
   * empty name draws nothing either, never a chevron with no words.
   */
  readonly back = input<string | null>(null);

  /** A line was chosen, by id. The add is sent again with `intoLineId`. */
  readonly chose = output<string>();

  /** A new line was chosen. The add is sent again with `newLine`. */
  readonly newLine = output<void>();

  /** Back to the basket's list picker. The container puts focus back in the field. */
  readonly returned = output<void>();

  /** The back gesture, which closes it like Escape does. */
  readonly dismissed = output<void>();

  /** The title's id, for the dialog around it to be labelled by. */
  readonly titleId = input(`add-choice-title-${++choiceCount}`);

  protected readonly titleKey = computed(() =>
    this.scope() === 'basket'
      ? 'basket.addChoice.title'
      : 'list.addChoice.title'
  );

  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _numbers = computed(
    () => new Intl.NumberFormat(this._locale())
  );

  private readonly _options =
    viewChildren<ElementRef<HTMLButtonElement>>('option');

  constructor() {
    afterNextRender(() => this._options()[0]?.nativeElement.focus());
    handleBackWhile(
      () => true,
      () => this.dismissed.emit()
    );
  }

  protected number(value: number): string {
    return this._numbers().format(value);
  }

  protected rowLabel(row: AddChoiceRow): string {
    return row.product === null
      ? 'list.addChoice.rowNoProduct'
      : 'list.addChoice.row';
  }

  protected rowArgs(row: AddChoiceRow): Record<string, unknown> {
    return {
      added: this.number(this.added()),
      name: row.name,
      product: row.product ?? '',
      from: this.number(row.from),
      to: this.number(row.to),
    };
  }
}
