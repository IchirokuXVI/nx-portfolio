import {
  ChangeDetectionStrategy,
  Component,
  effect,
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
import type { ReferenceLookup, ReferenceOption } from './reference-lookup';
import { ReferencePicker } from './reference-picker';

/**
 * Several uuids, each chosen by name (admin plan 0028, section 3).
 *
 * The ids held are a row of chips, in the order the row carries them, each
 * with a button that removes it. Below them is the same picker a single
 * reference uses, and choosing a row there adds it. An id already held is not
 * added twice.
 *
 * **A locked id has no remove button**, and says why in its `title`. Whether
 * an id is locked is a question about the row it points at, so it cannot be
 * answered until the lookup has read that row. Until then the chip offers no
 * removal at all where locks apply: a slow lookup must not be the window in
 * which the operator removes the one entry the descriptor said to keep.
 */
@Component({
  selector: 'lib-references-control',
  imports: [RokuTranslatorPipe, ReferencePicker],
  template: `
    @if (value().length === 0) {
      <p class="muted">{{ 'resource.references.empty' | rokuT }}</p>
    } @else {
      <ul class="chips">
        @for (id of value(); track id) {
          <li
            [attr.title]="
              isLocked(id) ? ('resource.references.locked' | rokuT) : null
            "
            [class.locked]="isLocked(id)"
            class="chip"
          >
            @if (!known(id)) {
              <span class="muted">{{
                'resource.reference.resolving' | rokuT
              }}</span>
            } @else if (optionOf(id); as option) {
              <span class="name">{{ option.title }}</span>
            } @else {
              <span class="missing">{{
                'resource.reference.missing' | rokuT: { id: id }
              }}</span>
            }

            @if (removable(id)) {
              <button
                (click)="remove(id)"
                [attr.aria-label]="
                  'resource.references.remove' | rokuT: { name: nameOf(id) }
                "
                [disabled]="disabled()"
                type="button"
              >
                {{ 'resource.references.removeShort' | rokuT }}
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
        [disabled]="disabled()"
        [lookup]="lookup()"
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

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .chip {
      display: inline-flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: 2.25rem;
      padding: var(--admin-space-1) var(--admin-space-1) var(--admin-space-1)
        var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
    }

    .chip.locked {
      padding-inline-end: var(--admin-space-3);
      border-style: dashed;
    }

    .name {
      font-weight: 600;
    }

    .missing {
      color: var(--admin-danger);
    }

    .muted {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    button {
      min-block-size: 2rem;
      padding: 0 var(--admin-space-2);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: 0.875rem;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    button:disabled {
      opacity: 0.55;
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
  readonly disabled = input(false);

  readonly valueChange = output<readonly string[]>();

  /** What the lookup answered, by id. Absent while the answer is outstanding. */
  private readonly _resolved = signal<
    ReadonlyMap<string, ReferenceOption | null>
  >(new Map());

  /** Every id already sent to the lookup, answered or still in flight. */
  private readonly _asked = new Set<string>();

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

  /** What the remove button calls the entry: its name, or its id. */
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
   * Whether the chip offers removal. Where locks apply, only once the lookup
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
