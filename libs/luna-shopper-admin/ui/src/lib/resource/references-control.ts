import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  isReferenceNone,
  type ReferenceScope,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { ChevronLeftIcon, CloseIcon } from '@portfolio/shared/ui';
import type { ReferenceLookup, ReferenceOption } from './reference-lookup';
import { ReferencePicker } from './reference-picker';

/**
 * Several uuids, each chosen by name (admin plan 0028, section 3; rows since
 * admin plan 0052, section 3.6).
 *
 * The ids held are one row each, in the order the row carries them: the name,
 * then the button that takes it away. Below them is the same picker a single
 * reference uses, and choosing a row there adds it. An id already held is not
 * added twice.
 *
 * **Where the order counts, each row has "Move up" and "Move down"**, and the
 * first row says "Main". A product's categories are the case: the first is the
 * one a row shows when it has room for one. After a move the focus stays on
 * the button that was pressed, on the row at its new place.
 *
 * **A locked id has no button that takes it away**, and says why in its
 * `title`. Whether an id is locked is a question about the row it points at,
 * so it cannot be answered until the lookup has read that row. Until then the
 * row offers no removal at all where locks apply: a slow lookup must not be
 * the window in which the operator removes the one entry the descriptor said
 * to keep.
 */
@Component({
  selector: 'lib-references-control',
  imports: [RokuTranslatorPipe, ReferencePicker, ChevronLeftIcon, CloseIcon],
  template: `
    @if (value().length === 0) {
      <p class="muted">{{ 'resource.references.empty' | rokuT }}</p>
    } @else {
      <ul class="rows">
        @for (id of value(); track id; let first = $first; let last = $last) {
          <li
            [attr.data-row]="id"
            [attr.title]="
              isLocked(id) ? ('resource.references.locked' | rokuT) : null
            "
            [class.locked]="isLocked(id)"
            class="row"
          >
            @if (!known(id)) {
              <span class="name muted">{{
                'resource.reference.resolving' | rokuT
              }}</span>
            } @else if (optionOf(id); as option) {
              <span class="name">{{ option.title }}</span>
            } @else {
              <span class="name missing">{{
                'resource.reference.missing' | rokuT: { id: id }
              }}</span>
            }

            <!-- The first is the one a row of a list shows when it has room
                 for one. Only where the order counts. -->
            @if (ordered() && first) {
              <span class="main" data-main>{{
                'resource.references.main' | rokuT
              }}</span>
            }

            @if (ordered()) {
              <!-- Each names the row it moves, so two rows of arrows are not
                   a column of buttons that all say the same. -->
              <button
                (click)="move(id, -1)"
                [attr.aria-label]="
                  'resource.references.moveUp' | rokuT: { name: nameOf(id) }
                "
                [disabled]="disabled() || first"
                class="icon up"
                type="button"
                data-move="up"
              >
                <lib-chevron-left-icon />
              </button>
              <button
                (click)="move(id, 1)"
                [attr.aria-label]="
                  'resource.references.moveDown' | rokuT: { name: nameOf(id) }
                "
                [disabled]="disabled() || last"
                class="icon down"
                type="button"
                data-move="down"
              >
                <lib-chevron-left-icon />
              </button>
            }

            @if (removable(id)) {
              <button
                (click)="remove(id)"
                [attr.aria-label]="
                  'resource.references.remove' | rokuT: { name: nameOf(id) }
                "
                [disabled]="disabled()"
                class="icon"
                type="button"
                data-remove
              >
                <span aria-hidden="true" class="cross"><lib-close-icon /></span>
              </button>
            }
          </li>
        }
      </ul>
    }

    @if (scope(); as fixed) {
      <lib-reference-picker
        (valueChange)="add($event)"
        [controlId]="controlId()"
        [describedBy]="describedBy()"
        [disabled]="disabled()"
        [invalid]="invalid()"
        [lookup]="lookup()"
        [prompt]="addKey()"
        [resource]="resource()"
        [scope]="fixed"
        value=""
      />
    } @else {
      <p class="muted">{{ 'resource.references.needsScope' | rokuT }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    /* As high as a control, because it stands in a column of them: 36 px
       beside a pointer and 44 px under a thumb. It is a row of a list and
       not a control, so its edge is the light one. */
    .row {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: var(--admin-control);
      padding-inline: var(--admin-space-3) var(--admin-space-1);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
    }

    .row.locked {
      padding-inline-end: var(--admin-space-3);
      border-style: dashed;
    }

    .name {
      flex: 1;
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .missing {
      color: var(--admin-danger);
    }

    .muted {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    .main {
      flex: none;
      padding: 0.0625rem var(--admin-space-2);
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-neutral-on-wash);
    }

    /* A button of a row is a mark with no box. It is 28 px inside a 36 px
       row, and 40 px inside the 44 px row of a phone. */
    .icon {
      display: grid;
      flex: none;
      place-items: center;
      inline-size: calc(var(--admin-control) - 0.5rem);
      block-size: calc(var(--admin-control) - 0.5rem);
      min-block-size: 0;
      padding: 0;
      border: none;
      background: none;
      color: var(--admin-ink-muted);
      cursor: pointer;
    }

    .icon lib-chevron-left-icon,
    .cross {
      display: block;
      inline-size: 1.125rem;
      block-size: 1.125rem;
    }

    .cross {
      inline-size: 0.875rem;
      block-size: 0.875rem;
    }

    /* The shared chevron points back. A quarter turn points it up or down. */
    .up lib-chevron-left-icon {
      rotate: 90deg;
    }

    .down lib-chevron-left-icon {
      rotate: -90deg;
    }

    .icon:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .icon:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferencesControl {
  readonly controlId = input.required<string>();
  /** The resource every id points at, by descriptor name. */
  readonly resource = input.required<string>();
  /** The ids currently held, in the order the row carries them. */
  readonly value = input.required<readonly string[]>();
  readonly lookup = input.required<ReferenceLookup>();
  /**
   * What the picker is limited to, or `null` when the form cannot search yet.
   *
   * With `null` nothing can be added, which is the answer for a new shop whose
   * chain is not chosen: offering every chain's rows would be offering choices
   * the server refuses.
   */
  readonly scope = input<ReferenceScope | null>({});
  /**
   * Whether a target is locked, asked with the target's row, or `null` when
   * the field locks nothing.
   */
  readonly locks = input<((target: ResourceRow) => boolean) | null>(null);
  /**
   * Whether the order counts. Each row then has "Move up" and "Move down",
   * and the first row says "Main".
   */
  readonly ordered = input(false);
  /**
   * A translation key for what the picker under the rows says while it is
   * empty: "Add a category".
   */
  readonly addKey = input('resource.references.add');
  /** Whether the value was refused. The picker under the rows carries it. */
  readonly invalid = input(false);
  /** The ids of the lines that describe the field. */
  readonly describedBy = input<string | null>(null);
  readonly disabled = input(false);

  readonly valueChange = output<readonly string[]>();

  /** What the lookup answered, by id. Absent while the answer is outstanding. */
  private readonly _resolved = signal<
    ReadonlyMap<string, ReferenceOption | null>
  >(new Map());

  /** Every id already sent to the lookup, answered or still in flight. */
  private readonly _asked = new Set<string>();

  private readonly _host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly _injector = inject(Injector);

  constructor() {
    effect(() => {
      const lookup = this.lookup();
      const resource = this.resource();
      for (const id of this.value()) {
        if (!this._asked.has(id)) {
          this._asked.add(id);
          void this._resolve(lookup, resource, id);
        }
      }
    });
  }

  /** Whether the lookup has answered for this id, with a row or with none. */
  known(id: string): boolean {
    return this._resolved().has(id);
  }

  optionOf(id: string): ReferenceOption | null {
    return this._resolved().get(id) ?? null;
  }

  /** What the buttons of a row call the entry: its name, or its id. */
  nameOf(id: string): string {
    return this.optionOf(id)?.title ?? id;
  }

  /**
   * Whether the descriptor keeps this target.
   *
   * False while the row is unknown, and false for an id that points at nothing,
   * since there is no row to ask about. {@link removable} is what stops the
   * first case from being removable.
   */
  isLocked(id: string): boolean {
    const locks = this.locks();
    const row = this.optionOf(id)?.row;
    return locks !== null && row !== undefined && locks(row);
  }

  /**
   * Whether the row offers removal. Where locks apply, only once the lookup
   * has answered and the answer is not locked.
   */
  removable(id: string): boolean {
    if (this.locks() === null) {
      return true;
    }
    return this.known(id) && !this.isLocked(id);
  }

  add(id: string): void {
    if (id === '' || isReferenceNone(id) || this.value().includes(id)) {
      return;
    }
    this.valueChange.emit([...this.value(), id]);
  }

  remove(id: string): void {
    if (!this.removable(id)) {
      return;
    }
    this.valueChange.emit(this.value().filter((entry) => entry !== id));
  }

  /**
   * One place up or down. A step off either end does nothing: the button
   * there is off, and this is the same answer for a caller that is not a
   * button.
   */
  move(id: string, step: 1 | -1): void {
    const ids = [...this.value()];
    const from = ids.indexOf(id);
    const to = from + step;
    if (from === -1 || to < 0 || to >= ids.length) {
      return;
    }
    [ids[from], ids[to]] = [ids[to], ids[from]];
    this.valueChange.emit(ids);
    this._focusAfterMove(id, step);
  }

  /**
   * Keeps the focus on the button that was pressed, on the row at its new
   * place. The row is moved in the document, and a browser drops the focus of
   * an element that is moved.
   *
   * A row that reached an end has that button switched off, so the focus goes
   * to the other arrow of the same row. The operator is still on the row
   * that moved, one key from moving it back.
   */
  private _focusAfterMove(id: string, step: 1 | -1): void {
    afterNextRender(
      () => {
        const row = Array.from(
          this._host.nativeElement.querySelectorAll<HTMLElement>('[data-row]')
        ).find((entry) => entry.getAttribute('data-row') === id);
        const [pressed, other] = step === -1 ? ['up', 'down'] : ['down', 'up'];
        const button = (direction: string) =>
          row?.querySelector<HTMLButtonElement>(`[data-move="${direction}"]`);
        const target =
          button(pressed)?.disabled === false ? button(pressed) : button(other);
        target?.focus();
      },
      { injector: this._injector }
    );
  }

  private async _resolve(
    lookup: ReferenceLookup,
    resource: string,
    id: string
  ): Promise<void> {
    let option: ReferenceOption | null;
    try {
      option = await lookup.resolve(resource, id);
    } catch {
      // A reference can outlive what it points at, and a failed read is drawn
      // the same way: an id with no row, which is removable and locks nothing.
      option = null;
    }
    this._resolved.update((resolved) => new Map(resolved).set(id, option));
  }
}
