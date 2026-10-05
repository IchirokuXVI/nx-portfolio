import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  type OnDestroy,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  REFERENCE_NONE,
  isReferenceNone,
  recordIdIn,
} from '@portfolio/luna-shopper-admin/models';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import { PopoverSheet } from '../page/popover-sheet';
import { Viewport } from '../viewport';
import type {
  ReferenceLookup,
  ReferenceOption,
  ReferenceScope,
} from './reference-lookup';

/** How long typing settles before a search goes out. */
const SEARCH_DELAY_MS = 250;

/**
 * The first choice of a list, which clears the value (admin plan 0050).
 *
 * `'none'` reads "None", for a field whose column allows nothing. `'any'` reads
 * "Any", for a filter, where an empty value means every row. `null` offers no
 * such choice: the field can be changed and cannot be emptied.
 */
export type ReferenceEmpty = 'none' | 'any' | null;

/** One line of the open list. */
interface PickerRow {
  /** `''` for the choice that clears, the none literal, or a row's id. */
  readonly id: string;
  readonly kind: 'empty' | 'none' | 'option';
  readonly option: ReferenceOption | null;
}

/**
 * A uuid, chosen by name (plan 0004, section 6; a combobox since plan 0050).
 *
 * One text field with the arrow of a select at its right edge. With a value it
 * shows **what the value points at**, by name. The arrow, a click in the field,
 * an arrow key or typing opens a list under it, and the list holds the first
 * page of the target before anything is typed: an operator who does not know
 * what the options are called can still read them.
 *
 * **A value changes only when an option is chosen.** Text that was typed and
 * not chosen is thrown away when the field is left, and the field shows what
 * it held. Emptying the text clears nothing, because in a form a field cleared
 * by a slip is a saved null.
 *
 * **Two choices can stand before the rows, and only while nothing is typed.**
 * A typed word is a search for a row by name, and neither of these has a name
 * to match.
 *
 * - {@link empty} clears the value. It reads "None" in a form and "Any" in a
 *   filter, and a required field does not offer it.
 * - {@link none} is a filter asking for the rows that point at nothing (plan
 *   0012, section 2). It holds {@link REFERENCE_NONE} as the value, which is
 *   drawn by name like any other choice and is never looked up.
 *
 * **A typed or pasted record ID chooses its record** (admin plan 0051). The ID
 * is read on this picker's own resource, so the ID of a shop finds nothing in
 * a picker of products. A record that is found is chosen at once, as if its
 * row had been clicked. An ID that no record has leaves the value alone, and
 * the list says so in a sentence.
 *
 * A reference whose target no longer exists says so under the field rather
 * than showing an empty box, because those are different problems and only one
 * of them is fixed by picking something.
 *
 * The keyboard and the names a screen reader hears are the combobox pattern
 * with a listbox: the focus stays in the field the whole time, and the active
 * option is named through `aria-activedescendant`.
 *
 * **On a phone it is a sheet** (admin plan 0052, section 3.5). The field is a
 * button that shows the name, with the same arrow. A press opens a sheet from
 * the bottom edge: the search field first, then the same list, with rows a
 * thumb can hit. A choice closes the sheet and the focus goes back to the
 * button. Escape, the scrim and Close change nothing. Every rule above holds
 * in the sheet as it does in the combobox.
 */
@Component({
  selector: 'lib-reference-picker',
  imports: [
    NgTemplateOutlet,
    RokuTranslatorPipe,
    ChevronLeftIcon,
    PopoverSheet,
  ],
  template: `
    <!-- The open list, drawn once: under the field on a wide screen and in the
         sheet on a phone. The options take no focus and no key of their own.
         The search field holds the focus and its keys move through them,
         which is what aria-activedescendant says to a screen reader. -->
    <ng-template #list>
      <!-- eslint-disable @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
      <ul [attr.aria-label]="label()" [id]="listId()" role="listbox">
        @for (row of rows(); track row.id; let index = $index) {
          <li
            (click)="pick(row)"
            (mousemove)="active.set(index)"
            [attr.aria-selected]="row.id === value()"
            [class.active]="index === active()"
            [class.quiet]="row.kind !== 'option'"
            [id]="optionId(index)"
            role="option"
          >
            @switch (row.kind) {
              @case ('empty') {
                {{ emptyKey() | rokuT }}
              }
              @case ('none') {
                {{ 'resource.reference.none' | rokuT }}
              }
              @default {
                {{ row.option?.title }}
              }
            }
          </li>
        }
      </ul>
      <!-- eslint-enable @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
      @if (searching()) {
        <p class="state" role="status">
          {{ 'resource.reference.searching' | rokuT }}
        </p>
      } @else if (idNotFound()) {
        <!-- An ID was typed and no row of this resource has it. Not
             "Nothing matched": that is the answer to a search by name,
             and its remedy is another word. This one has none. -->
        <p class="state" role="status" data-id-not-found>
          @if (nounKey(); as noun) {
            {{ 'resource.id.notFound' | rokuT: { thing: noun | rokuT } }}
          } @else {
            {{ 'resource.id.notFoundHere' | rokuT }}
          }
        </p>
      } @else if (rows().length === 0) {
        <p class="state" role="status">
          {{ 'resource.reference.noResults' | rokuT }}
        </p>
      }
    </ng-template>

    @if (compact()) {
      <!-- On a phone the field is a button and the list is a sheet from the
           bottom edge (admin plan 0052, section 3.5). A list under the field
           opened behind the keyboard. The label names the button, and the
           value it holds is its description. -->
      <div class="box">
        <button
          (click)="show()"
          [attr.aria-describedby]="describedIds()"
          [attr.aria-expanded]="open()"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [attr.aria-label]="label()"
          [disabled]="disabled()"
          [id]="controlId()"
          aria-haspopup="dialog"
          class="field"
          type="button"
          data-picker-button
        >
          <span
            [class.quiet]="!isNone() && shownTitle() === ''"
            [id]="shownId()"
            class="name"
          >
            @if (isNone()) {
              {{ 'resource.reference.none' | rokuT }}
            } @else if (shownTitle() !== '') {
              {{ shownTitle() }}
            } @else {
              {{ placeholderKey() | rokuT }}
            }
          </span>
          <span class="arrow"><lib-chevron-left-icon /></span>
        </button>
      </div>

      @if (open()) {
        <lib-popover-sheet
          (closed)="dismiss()"
          [heading]="label() ?? (placeholderKey() | rokuT)"
          [sheet]="true"
        >
          <div class="find">
            <input
              (input)="onType($event)"
              (keydown)="onKey($event)"
              [attr.aria-activedescendant]="activeId()"
              [attr.aria-controls]="listId()"
              [attr.aria-label]="'resource.reference.search' | rokuT"
              [value]="term()"
              aria-autocomplete="list"
              aria-expanded="true"
              autocapitalize="none"
              autocomplete="off"
              autocorrect="off"
              role="combobox"
              spellcheck="false"
              type="text"
              data-picker-search
            />
          </div>
          <div class="sheet-list">
            <ng-container [ngTemplateOutlet]="list" />
          </div>
        </lib-popover-sheet>
      }
    } @else {
      <div class="box">
        <input
          (blur)="leave()"
          (click)="show()"
          (input)="onType($event)"
          (keydown)="onKey($event)"
          [attr.aria-activedescendant]="activeId()"
          [attr.aria-controls]="open() ? listId() : null"
          [attr.aria-describedby]="describedIds()"
          [attr.aria-expanded]="open()"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [attr.aria-label]="label()"
          [disabled]="disabled()"
          [id]="controlId()"
          [placeholder]="placeholderKey() | rokuT"
          [value]="
            editing()
              ? term()
              : isNone()
                ? ('resource.reference.none' | rokuT)
                : shownTitle()
          "
          aria-autocomplete="list"
          autocapitalize="none"
          autocomplete="off"
          autocorrect="off"
          role="combobox"
          spellcheck="false"
          type="text"
        />
        <!-- Out of the tab order on purpose: the field opens the same list with
             an arrow key, so a second stop would be a second name for one
             control. The press is swallowed so the field keeps the focus. -->
        <button
          (click)="toggle()"
          (mousedown)="$event.preventDefault()"
          [attr.aria-controls]="open() ? listId() : null"
          [attr.aria-expanded]="open()"
          [attr.aria-label]="'resource.reference.open' | rokuT"
          [disabled]="disabled()"
          class="arrow"
          tabindex="-1"
          type="button"
          data-arrow
        >
          <lib-chevron-left-icon />
        </button>

        @if (open()) {
          <div (mousedown)="$event.preventDefault()" class="popup">
            <ng-container [ngTemplateOutlet]="list" />
          </div>
        }
      </div>
    }

    @if (missing()) {
      <p [id]="missingId()" class="missing">
        {{ 'resource.reference.missing' | rokuT: { id: value() } }}
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .box {
      position: relative;
    }

    /* The outline, the height and the padding are the global control rule's.
       Only the room for the arrow is added, by the sum the select uses. */
    .box input,
    .field {
      inline-size: 100%;
      padding-inline-end: calc(
        var(--admin-space-3) + var(--admin-caret) + var(--admin-space-2)
      );
      text-overflow: ellipsis;
    }

    /* The button of a phone reads as the field it stands for: the text of a
       field at the left, and the same arrow at the right. */
    .field {
      display: block;
      overflow: hidden;
      font-size: var(--admin-field-size);
      text-align: start;
      white-space: nowrap;
      cursor: pointer;
    }

    .field .quiet {
      color: var(--admin-ink-muted);
    }

    .field .arrow {
      pointer-events: none;
    }

    /* The search field stays at the top of the sheet while the list scrolls
       under it. */
    .find {
      position: sticky;
      inset-block-start: 0;
      padding: var(--admin-space-2) var(--admin-space-4);
      border-block-end: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    .find input {
      inline-size: 100%;
    }

    /* A row under a thumb is 48 px high. */
    .sheet-list li {
      min-block-size: 3rem;
      padding-inline: var(--admin-space-4);
    }

    .sheet-list .state {
      padding-inline: var(--admin-space-4);
    }

    input::placeholder {
      color: var(--admin-ink-muted);
      opacity: 1;
    }

    /* As wide as the arrow and the space on both sides of it, so the chevron
       sits --admin-space-3 from the edge, where a select draws its own. */
    .arrow {
      position: absolute;
      inset-block: 0;
      inset-inline-end: 0;
      display: grid;
      place-items: center;
      inline-size: calc(var(--admin-caret) + 2 * var(--admin-space-3));
      min-block-size: 0;
      padding: 0;
      border: none;
      background: none;
      color: var(--admin-ink-muted);
      cursor: pointer;
    }

    /* The shared chevron points back. A quarter turn points it down. */
    .arrow lib-chevron-left-icon {
      inline-size: var(--admin-caret);
      block-size: var(--admin-caret);
      rotate: -90deg;
    }

    .arrow:disabled {
      cursor: default;
    }

    /* Over the page rather than in it: a list in the flow pushed the rows of a
       filter bar down every time it opened. The shadow says it is above. */
    .popup {
      position: absolute;
      inset-inline: 0;
      inset-block-start: calc(100% + var(--admin-space-1));
      z-index: 30;
      max-block-size: 16rem;
      overflow-y: auto;
      scroll-margin-block: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      box-shadow: 0 0.375rem 1rem rgb(20 23 26 / 14%);
    }

    ul {
      list-style: none;
    }

    li {
      display: flex;
      align-items: center;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      overflow-wrap: anywhere;
      cursor: pointer;
    }

    li.quiet {
      color: var(--admin-ink-muted);
    }

    li[aria-selected='true'] {
      font-weight: 600;
    }

    li.active {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .state {
      padding: var(--admin-control-pad) var(--admin-space-3);
      color: var(--admin-ink-muted);
    }

    .missing {
      color: var(--admin-danger);
    }

    :disabled {
      opacity: 0.55;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferencePicker implements OnDestroy {
  readonly controlId = input.required<string>();
  /** The resource being pointed at, by descriptor name. */
  readonly resource = input.required<string>();
  /** The id currently held, or `''`. */
  readonly value = input.required<string>();
  readonly lookup = input.required<ReferenceLookup>();
  /**
   * What the screen has already decided, sent with every search.
   *
   * The mapping screen of plan 0011 is what this exists for: its picker is over
   * one chain's shops, and that collection cannot be read at all until the
   * chain is named. Empty for every picker whose target lists from nothing.
   */
  readonly scope = input<ReferenceScope>({});
  /**
   * The choice that clears the value, and how it reads.
   *
   * Off unless a use asks. A use that forgets it gets a field nobody can
   * empty, which somebody notices. The other default lets a required field be
   * saved empty.
   */
  readonly empty = input<ReferenceEmpty>(null);
  /**
   * Whether "none" is a choice here: the rows that point at nothing.
   *
   * Set by a filter over a nullable column and by nothing else. It is not
   * {@link empty}: clearing a filter asks for every row, and this asks for
   * every row that is already empty.
   */
  readonly none = input(false);
  /**
   * The name of the field, for a use whose visible label is not a
   * `<label for>` pointing at {@link controlId}. Already translated.
   */
  readonly label = input<string | null>(null);
  /**
   * A translation key for what the empty field says, in place of "Choose…".
   * The picker under a list of references says what it adds: "Add a category".
   */
  readonly prompt = input<string | null>(null);
  /** Whether the value was refused. Sets `aria-invalid` and the red edge. */
  readonly invalid = input(false);
  /** The ids of the lines that describe the field: its refusals and its help. */
  readonly describedBy = input<string | null>(null);
  readonly disabled = input(false);

  readonly valueChange = output<string>();

  /** What the operator typed since the list last closed. */
  readonly term = signal('');
  /** Whether the field shows {@link term} rather than the value's name. */
  readonly editing = signal(false);
  readonly open = signal(false);
  readonly options = signal<readonly ReferenceOption[]>([]);
  readonly searching = signal(false);
  readonly resolving = signal(false);
  readonly chosen = signal<ReferenceOption | null>(null);
  /** The index in {@link rows} the keys are on, or `-1` for none. */
  readonly active = signal(-1);
  /** The last read was for a typed ID, and no row of the resource has it. */
  readonly idNotFound = signal(false);

  /** What one row of the resource is called, as a key, when the lookup knows. */
  readonly nounKey = computed(
    () => this.lookup().nounOf?.(this.resource()) ?? null
  );

  readonly listId = computed(() => `${this.controlId()}-list`);
  readonly missingId = computed(() => `${this.controlId()}-missing`);

  /** Whether the value held is "none" rather than an id. */
  readonly isNone = computed(() => isReferenceNone(this.value()));

  /** Whether there is typed text. The two leading choices go when there is. */
  readonly typed = computed(() => this.editing() && this.term().trim() !== '');

  /** The name of the value held, or `''` while there is none to show. */
  readonly shownTitle = computed(() => this.chosen()?.title ?? '');

  /** Whether the value points at a row that is not there. */
  readonly missing = computed(
    () =>
      this.value() !== '' &&
      !this.isNone() &&
      !this.resolving() &&
      this.chosen() === null
  );

  readonly emptyKey = computed(() =>
    this.empty() === 'any' ? 'resource.filter.any' : 'resource.reference.none'
  );

  /** What an empty field says: the same words a select beside it would. */
  readonly placeholderKey = computed(() => {
    if (this.resolving()) {
      return 'resource.reference.resolving';
    }
    const prompt = this.prompt();
    if (prompt !== null) {
      return prompt;
    }
    return this.empty() === null ? 'resource.field.choose' : this.emptyKey();
  });

  /** The id of the name the button of a phone shows, which describes it. */
  readonly shownId = computed(() => `${this.controlId()}-shown`);

  /**
   * What the field is described by: the lines its row handed it, the line
   * that says its target is gone, and on a phone the value it holds. The
   * label names the button there, so the value has to be said another way.
   */
  readonly describedIds = computed(() => {
    const ids = [
      this.compact() ? this.shownId() : null,
      this.describedBy(),
      this.missing() ? this.missingId() : null,
    ].filter((id): id is string => id !== null && id !== '');

    return ids.length === 0 ? null : ids.join(' ');
  });

  /** The open list, top to bottom. */
  readonly rows = computed<readonly PickerRow[]>(() => {
    const rows: PickerRow[] = [];
    if (!this.typed()) {
      if (this.empty() !== null) {
        rows.push({ id: '', kind: 'empty', option: null });
      }
      if (this.none()) {
        rows.push({ id: REFERENCE_NONE, kind: 'none', option: null });
      }
    }
    if (!this.searching()) {
      for (const option of this.options()) {
        rows.push({ id: option.id, kind: 'option', option });
      }
    }
    return rows;
  });

  readonly activeId = computed(() =>
    this.open() && this.active() >= 0 && this.active() < this.rows().length
      ? this.optionId(this.active())
      : null
  );

  private readonly _host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly _injector = inject(Injector);

  /**
   * Whether the window is a phone's. The field is then a button, and the list
   * is a sheet from the bottom edge.
   */
  readonly compact = inject(Viewport).compact;
  /**
   * Every row a list has shown, by id. A value chosen from the list is then
   * named from here, without a second read for a row already in hand.
   */
  private readonly _seen = new Map<string, ReferenceOption>();
  private _timer: ReturnType<typeof setTimeout> | null = null;
  /** The search this component is waiting for, so a slow one cannot land last. */
  private _pending = 0;
  /** The same guard for the read that names the value held. */
  private _resolveRequest = 0;

  constructor() {
    effect(() => {
      const id = this.value();
      const request = ++this._resolveRequest;
      // "None" names nothing, so there is nothing to resolve and nothing to be
      // missing: the template draws it from the value alone.
      if (id === '' || isReferenceNone(id)) {
        this.chosen.set(null);
        this.resolving.set(false);
        return;
      }
      const seen = this._seen.get(id);
      if (seen !== undefined) {
        this.chosen.set(seen);
        this.resolving.set(false);
        return;
      }
      // The name of the value before this one must not stand in the field
      // while the read for this one is out.
      this.chosen.set(null);
      void this._resolve(id, request);
    });

    // A field that is switched off while its list is open closes it.
    effect(() => {
      if (this.disabled() && untracked(this.open)) {
        this.close();
      }
    });
  }

  ngOnDestroy(): void {
    this._clearTimer();
  }

  optionId(index: number): string {
    return `${this.controlId()}-option-${index}`;
  }

  /** Opens the list on the first page, or on what is already typed. */
  show(): void {
    if (this.open() || this.disabled()) {
      return;
    }
    this.open.set(true);
    this.active.set(-1);
    void this._search(this.typed() ? this.term() : '');
    // A list near the bottom edge of the window opens below it, where nobody
    // sees it. The sheet of a phone is placed by the window and needs none of
    // this.
    if (this.compact()) {
      return;
    }
    afterNextRender(
      () => {
        const popup = this._host.nativeElement.querySelector('.popup');
        popup?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this._injector }
    );
  }

  /** The arrow: opens a closed list, closes an open one. */
  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this._host.nativeElement.querySelector<HTMLElement>('.box input')?.focus();
    this.show();
  }

  /** Closes the list and throws away text that was not chosen. */
  close(): void {
    this._clearTimer();
    this._pending++;
    this.searching.set(false);
    this.idNotFound.set(false);
    this.open.set(false);
    this.editing.set(false);
    this.term.set('');
    this.active.set(-1);
  }

  /**
   * The field lost the focus. A press on the list or the arrow never gets here.
   *
   * The search field of a sheet is never bound to this: a press on the heading
   * of the sheet takes the focus from it, and that is no reason to close.
   */
  leave(): void {
    this.close();
  }

  /**
   * The sheet was asked to close: Escape, the scrim or its Close button. It
   * changes nothing, and the focus goes back to the button that opened it.
   */
  dismiss(): void {
    this.close();
    this._focusButton();
  }

  pick(row: PickerRow): void {
    this.close();
    this._focusButton();
    this.valueChange.emit(row.id);
  }

  /**
   * On a phone, puts the focus back on the button once the sheet is gone. On
   * a wide screen the field never lost it.
   */
  private _focusButton(): void {
    if (!this.compact()) {
      return;
    }
    afterNextRender(
      () => {
        this._host.nativeElement
          .querySelector<HTMLElement>('[data-picker-button]')
          ?.focus();
      },
      { injector: this._injector }
    );
  }

  onType(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.term.set(term);
    this.editing.set(true);
    this.open.set(true);
    this.active.set(-1);
    this.idNotFound.set(false);
    // A search that is still out answers a text the field no longer holds.
    // Its answer is dropped, and the rows it would replace are hidden until
    // the search for this text lands: Enter on a stale row picks the wrong
    // record.
    this._pending++;
    this.searching.set(true);

    this._clearTimer();
    // An ID is pasted whole, so there is no typing to wait out.
    if (this._idIn(term) !== null) {
      void this._search(term);
      return;
    }
    this._timer = setTimeout(() => void this._search(term), SEARCH_DELAY_MS);
  }

  onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.show();
          return;
        }
        this._move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      case 'Enter': {
        if (!this.open()) {
          return;
        }
        // An open list owns Enter, with or without an active option.
        // Otherwise Enter during a search would submit the form the field is
        // in.
        event.preventDefault();
        const row = this.rows()[this.active()];
        if (row !== undefined) {
          this.pick(row);
        }
        return;
      }
      case 'Escape': {
        if (this.open()) {
          // The list is what Escape closes. A dialog or a panel around the
          // field hears the next one.
          event.preventDefault();
          event.stopPropagation();
          this.dismiss();
        }
        return;
      }
    }
  }

  /** Moves the active option one step, around the ends. */
  private _move(step: 1 | -1): void {
    const count = this.rows().length;
    if (count === 0) {
      return;
    }
    const from = this.active();
    const next =
      from < 0 ? (step === 1 ? 0 : count - 1) : (from + step + count) % count;
    this.active.set(next);
    afterNextRender(
      () => {
        this._host.nativeElement.ownerDocument
          .getElementById(this.optionId(next))
          ?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this._injector }
    );
  }

  /**
   * The ID a term is on this picker's resource, or `null` for text.
   *
   * The lookup's answer when it has one, because it is the lookup that reads
   * the term: a resource with no read by ID gets a pasted uuid searched as
   * words, and then nothing here may treat it as an ID.
   */
  private _idIn(term: string): string | null {
    const lookup = this.lookup();
    return lookup.recordIdFor === undefined
      ? recordIdIn(term)
      : lookup.recordIdFor(this.resource(), term);
  }

  /**
   * The options for a term, and the one place this component reads them.
   *
   * An empty term asks for the first page. A term that is a record ID asks
   * for that record (admin plan 0051), and the lookup answers it from the
   * resource's own read by ID: one row, or none.
   */
  private _read(term: string): Promise<readonly ReferenceOption[]> {
    return this.lookup().search(this.resource(), term, this.scope());
  }

  private async _search(term: string): Promise<void> {
    const request = ++this._pending;
    this.searching.set(true);
    this.idNotFound.set(false);

    let options: readonly ReferenceOption[];
    let failed = false;
    try {
      options = await this._read(term);
    } catch {
      options = [];
      failed = true;
    }

    // A search the operator has already typed past must not overwrite a later
    // one that came back first, which is the ordinary case when the second
    // term is more specific and therefore faster.
    if (request !== this._pending) {
      return;
    }
    for (const option of options) {
      this._seen.set(option.id, option);
    }

    const id = this._idIn(term);
    if (id !== null && options.length === 1 && options[0].id === id) {
      // The record the ID names. There is nothing to choose between, so it is
      // chosen: the field shows its name, and the list closes.
      this.close();
      this._focusButton();
      this.valueChange.emit(id);
      return;
    }

    this.options.set(options);
    this.searching.set(false);
    // A read that failed has not said the record is missing.
    this.idNotFound.set(id !== null && options.length === 0 && !failed);
    this.active.set(this._startAt());
  }

  /**
   * Where the keys start once a list has landed: the first match under a typed
   * word, so Enter takes it, and the value held otherwise.
   */
  private _startAt(): number {
    const rows = this.rows();
    if (this.typed()) {
      return rows.length > 0 ? 0 : -1;
    }
    const held = this.value();
    return held === '' ? -1 : rows.findIndex((row) => row.id === held);
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private async _resolve(id: string, request: number): Promise<void> {
    this.resolving.set(true);
    let found: ReferenceOption | null;
    try {
      found = await this.lookup().resolve(this.resource(), id);
    } catch {
      found = null;
    }
    // A read for a value the field no longer holds answers nothing here: the
    // value that replaced it has its own read, or needed none.
    if (request !== this._resolveRequest) {
      return;
    }
    this.chosen.set(found);
    this.resolving.set(false);
  }
}
