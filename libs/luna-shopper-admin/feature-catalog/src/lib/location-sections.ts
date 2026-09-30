import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import { localizedTextValue } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
import { panelErrorKey } from './chain-sections';
import {
  ShopSections,
  type ShopSection,
  type ShopSectionList,
} from './shop-sections';

/** One row of the ordering control. */
export interface SectionChoice {
  readonly section: ShopSection;
  /** Whether the shop has it. */
  readonly ticked: boolean;
  /** Its place in the shop's walk, from 1, or `null` when not ticked. */
  readonly place: number | null;
}

/**
 * Move one id a step up or down a list, answering a new list. A step past
 * either end answers the list unchanged.
 */
export function moveId(
  order: readonly string[],
  id: string,
  step: -1 | 1
): string[] {
  const from = order.indexOf(id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= order.length) {
    return [...order];
  }
  const next = [...order];
  next[from] = order[to];
  next[to] = id;
  return next;
}

/**
 * The sections a shop has, and the order it walks them (admin plan 0037,
 * target 2; backend plan 0167, section 2).
 *
 * It opens on what the shop has now. A shop with no list of its own inherits
 * every section of its chain in the chain's order, and the panel says so,
 * because an operator reading a full, tidy list would otherwise take it for a
 * list somebody wrote.
 *
 * **The order is held here and saved whole.** Ticking a section, or moving one
 * up or down, changes nothing on the server: Save sends the ticked sections in
 * the order shown, in one request. "Use the chain's default" sends the empty
 * list, which deletes the shop's own and returns it to the chain's.
 *
 * Only the shop's own chain's sections are offered, because a section of
 * another chain is refused, and a picker that offered one would offer a
 * refusal.
 */
@Component({
  selector: 'lib-location-sections',
  imports: [ConfirmDialog, RokuTranslatorPipe],
  template: `
    <section aria-labelledby="location-sections-heading">
      <h2 id="location-sections-heading">
        {{ 'catalog.locationSections.heading' | rokuT }}
      </h2>

      @if (loading() && saved() === null) {
        <p class="muted" role="status">
          {{ 'resource.list.loading' | rokuT }}
        </p>
      } @else if (readErrorKey(); as key) {
        <div class="failure" role="alert">
          <p>{{ key | rokuT }}</p>
          <button (click)="reload()" type="button">
            {{ 'resource.action.retry' | rokuT }}
          </button>
        </div>
      } @else if (chain().length === 0) {
        <p class="empty">{{ 'catalog.locationSections.noSections' | rokuT }}</p>
      } @else {
        <p class="source">{{ sourceKey() | rokuT }}</p>

        @if (hasMap()) {
          <p class="notice" role="note">
            {{ 'catalog.locationSections.mapNotice' | rokuT }}
          </p>
        }

        <ol class="choices">
          @for (choice of choices(); track choice.section.id) {
            <li [class.off]="!choice.ticked">
              <span aria-hidden="true" class="place">{{
                choice.place ?? ''
              }}</span>
              <label>
                <input
                  (change)="toggle(choice.section.id, $event)"
                  [checked]="choice.ticked"
                  [disabled]="busy()"
                  type="checkbox"
                />
                <span>{{ nameOf(choice.section) }}</span>
              </label>
              @if (choice.ticked) {
                <span class="move">
                  <button
                    (click)="move(choice.section.id, -1)"
                    [attr.aria-label]="
                      'catalog.locationSections.up'
                        | rokuT: { name: nameOf(choice.section) }
                    "
                    [disabled]="busy() || choice.place === 1"
                    type="button"
                  >
                    {{ 'catalog.locationSections.upShort' | rokuT }}
                  </button>
                  <button
                    (click)="move(choice.section.id, 1)"
                    [attr.aria-label]="
                      'catalog.locationSections.down'
                        | rokuT: { name: nameOf(choice.section) }
                    "
                    [disabled]="busy() || choice.place === order().length"
                    type="button"
                  >
                    {{ 'catalog.locationSections.downShort' | rokuT }}
                  </button>
                </span>
              }
            </li>
          }
        </ol>

        @if (order().length === 0) {
          <p class="muted">
            {{ 'catalog.locationSections.noneTicked' | rokuT }}
          </p>
        }

        @if (saveErrorKey(); as key) {
          <p class="failure" role="alert">{{ key | rokuT }}</p>
        }
        @if (savedNow()) {
          <p class="muted" role="status">
            {{ 'catalog.locationSections.saved' | rokuT }}
          </p>
        }

        <div class="controls">
          <button
            (click)="save()"
            [disabled]="busy() || !dirty() || order().length === 0"
            class="primary"
            type="button"
          >
            {{
              (busy()
                ? 'resource.action.working'
                : 'catalog.locationSections.save'
              ) | rokuT
            }}
          </button>
          @if (dirty()) {
            <button (click)="discard()" [disabled]="busy()" type="button">
              {{ 'catalog.locationSections.discard' | rokuT }}
            </button>
          }
          @if (ownList()) {
            <button
              (click)="useChainDefault()"
              [disabled]="busy()"
              type="button"
            >
              {{ 'catalog.locationSections.useChain' | rokuT }}
            </button>
          }
        </div>
      }
    </section>

    @if (askingMapEdit()) {
      <lib-confirm-dialog
        (confirm)="confirmMapEdit()"
        (dismiss)="dismissMapEdit()"
        bodyKey="catalog.locationSections.mapNotice"
        confirmKey="catalog.locationSections.mapConfirm.confirm"
        headingKey="catalog.locationSections.mapConfirm.heading"
        tone="primary"
      />
    }
  `,
  styles: `
    :host {
      display: block;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      max-inline-size: 36rem;
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .source {
      color: var(--admin-ink);
    }

    .empty {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .notice {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-status-attention);
      border-radius: var(--admin-radius);
      background: var(--admin-status-attention-wash);
      color: var(--admin-ink);
    }

    .failure {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .choices {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      list-style: none;
    }

    .choices li {
      display: grid;
      grid-template-columns: 2rem 1fr auto;
      gap: var(--admin-space-3);
      align-items: center;
      min-block-size: 3rem;
      padding: var(--admin-space-1) var(--admin-space-3);
    }

    .choices li + li {
      border-block-start: 1px solid var(--admin-border);
    }

    .choices li.off {
      color: var(--admin-ink-muted);
    }

    .place {
      font-variant-numeric: tabular-nums;
      text-align: end;
      color: var(--admin-ink-muted);
    }

    label {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: 2.75rem;
      cursor: pointer;
    }

    input[type='checkbox'] {
      inline-size: 1.125rem;
      block-size: 1.125rem;
      accent-color: var(--admin-accent);
    }

    .move {
      display: flex;
      gap: var(--admin-space-1);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .move button {
      min-block-size: 2.25rem;
      padding: var(--admin-space-1) var(--admin-space-3);
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    button:active:not(:disabled) {
      transform: translateY(1px);
    }

    button:focus-visible,
    input:focus-visible {
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
export class LocationSections {
  private readonly _sections = inject(ShopSections);
  private readonly _content = inject(ContentLocaleStore);

  /** The shop. */
  readonly locationId = input.required<string>();
  /** The shop's chain, whose sections are the only ones offered. */
  readonly supermarketId = input.required<string>();
  /**
   * Whether the shop has a walk shown to shoppers (backend plan 0168), whose
   * every save rewrites this list (admin plan 0040).
   */
  readonly hasMap = input(false);

  /**
   * Whether the operator has agreed, on this visit, to edit a list the map
   * rewrites. Asked once per visit, on the first edit, and never again until
   * the panel is opened afresh.
   */
  readonly mapEditAccepted = signal(false);
  /** The edit waiting on that agreement, or `null`. */
  private readonly _pendingEdit = signal<(() => unknown) | null>(null);
  /** Whether the map confirmation is open. */
  readonly askingMapEdit = computed(() => this._pendingEdit() !== null);

  /** What the server holds, as last read or written. */
  readonly saved = signal<ShopSectionList | null>(null);
  /** The chain's sections, in the chain's order. */
  readonly chain = signal<readonly ShopSection[]>([]);
  /** The ticked sections, in the order the shop walks them. */
  readonly order = signal<readonly string[]>([]);

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly readErrorKey = signal<string | null>(null);
  readonly saveErrorKey = signal<string | null>(null);
  /** Whether the last act was a successful write, for the status line. */
  readonly savedNow = signal(false);

  private _generation = 0;

  /** The ids the server holds, in its order. */
  private readonly _savedOrder = computed(() =>
    (this.saved()?.sections ?? []).map((section) => section.id)
  );

  /** Whether the shop has a list of its own, rather than its chain's. */
  readonly ownList = computed(() => this.saved()?.source === 'LOCATION');

  /** The sentence saying where the list comes from. */
  readonly sourceKey = computed(() =>
    this.ownList()
      ? 'catalog.locationSections.own'
      : 'catalog.locationSections.fromChain'
  );

  /** Whether the order held here differs from the server's. */
  readonly dirty = computed(() => {
    const held = this.order();
    const saved = this._savedOrder();
    return (
      held.length !== saved.length ||
      held.some((id, index) => saved[index] !== id)
    );
  });

  /** The ticked sections in their order, then the rest in the chain's. */
  readonly choices = computed<readonly SectionChoice[]>(() => {
    const chain = this.chain();
    const order = this.order();
    const ticked = order
      .map((id) => chain.find((section) => section.id === id))
      .filter((section): section is ShopSection => section !== undefined)
      .map((section, index) => ({ section, ticked: true, place: index + 1 }));
    const rest = chain
      .filter((section) => !order.includes(section.id))
      .map((section) => ({ section, ticked: false, place: null }));
    return [...ticked, ...rest];
  });

  constructor() {
    effect(() => {
      const locationId = this.locationId();
      const supermarketId = this.supermarketId();
      untracked(() => void this._read(locationId, supermarketId));
    });
    // Accepting that a map writes the list holds for one shop only.
    effect(() => {
      this.locationId();
      untracked(() => this.mapEditAccepted.set(false));
    });
  }

  nameOf(section: ShopSection): string {
    return (
      localizedTextValue(section.name, this._content.order()) || section.slug
    );
  }

  reload(): Promise<void> {
    return this._read(this.locationId(), this.supermarketId());
  }

  /** Tick or untick one section. A newly ticked one joins at the end. */
  toggle(id: string, event?: Event): void {
    if (this._needsMapConsent(() => this.toggle(id))) {
      // The box has already flipped in the page. Put it back until the
      // operator says yes, because the list itself has not changed.
      const box = event?.target;
      if (box instanceof HTMLInputElement) {
        box.checked = !box.checked;
      }
      return;
    }
    this.savedNow.set(false);
    this.order.update((order) =>
      order.includes(id) ? order.filter((held) => held !== id) : [...order, id]
    );
  }

  move(id: string, step: -1 | 1): void {
    if (this._needsMapConsent(() => this.move(id, step))) {
      return;
    }
    this.savedNow.set(false);
    this.order.update((order) => moveId(order, id, step));
  }

  /** Back to what the server holds. */
  discard(): void {
    this.saveErrorKey.set(null);
    this.order.set(this._savedOrder());
  }

  /** The ticked sections, in the order shown, in one request. */
  save(): Promise<void> {
    return this._write(this.order());
  }

  /** The empty list, which returns the shop to its chain's default. */
  useChainDefault(): Promise<void> {
    if (this._needsMapConsent(() => this.useChainDefault())) {
      return Promise.resolve();
    }
    return this._write([]);
  }

  /** The operator agreed: remember it for the visit, and make the edit. */
  async confirmMapEdit(): Promise<void> {
    const edit = this._pendingEdit();
    this.mapEditAccepted.set(true);
    this._pendingEdit.set(null);
    await edit?.();
  }

  /** The operator declined: nothing changes, and the next edit asks again. */
  dismissMapEdit(): void {
    this._pendingEdit.set(null);
  }

  /**
   * Whether an edit has to wait for the operator (admin plan 0040, target 2).
   *
   * Only for a shop with a map, and only until the first yes of the visit.
   * A shop with no map edits exactly as it did before.
   */
  private _needsMapConsent(edit: () => unknown): boolean {
    if (!this.hasMap() || this.mapEditAccepted()) {
      return false;
    }
    this._pendingEdit.set(edit);
    return true;
  }

  private async _write(sectionIds: readonly string[]): Promise<void> {
    this.busy.set(true);
    this.saveErrorKey.set(null);
    this.savedNow.set(false);
    try {
      const answer = await this._sections.setForLocation(
        this.locationId(),
        sectionIds
      );
      this.saved.set(answer);
      this.order.set(answer.sections.map((section) => section.id));
      this.savedNow.set(true);
    } catch (error) {
      // What was ticked stays, so a refusal costs a retry and not the work.
      this.saveErrorKey.set(panelErrorKey(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async _read(
    locationId: string,
    supermarketId: string
  ): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    this.loading.set(true);
    this.readErrorKey.set(null);

    try {
      const [saved, chain] = await Promise.all([
        this._sections.forLocation(locationId),
        this._sections.chainSections(supermarketId),
      ]);
      if (generation !== this._generation) {
        return;
      }
      this.chain.set(chain);
      this.saved.set(saved);
      this.order.set(saved.sections.map((section) => section.id));
    } catch (error) {
      if (generation === this._generation) {
        this.readErrorKey.set(panelErrorKey(error));
      }
    } finally {
      if (generation === this._generation) {
        this.loading.set(false);
      }
    }
  }
}
