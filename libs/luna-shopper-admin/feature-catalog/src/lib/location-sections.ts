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
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import { ResourceChanges } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  type InfoContent,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  InfoButton,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
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
  imports: [ConfirmDialog, InfoButton, ChevronLeftIcon, RokuTranslatorPipe],
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
        <div class="lead">
          <p class="source">{{ sourceKey() | rokuT }}</p>
          @if (hasMap()) {
            <!-- A waiting state and not a paragraph: what a map does to the
                 list is behind the info button, and the same sentence is asked
                 before the first edit. -->
            <span class="waiting" data-map-notice>{{
              'catalog.locationSections.mapState' | rokuT
            }}</span>
            <lib-info-button [info]="mapInfo" />
          }
        </div>

        <ol class="choices">
          @for (choice of choices(); track choice.section.id) {
            <li
              (dragend)="dropped()"
              (dragover)="draggedOver(choice, $event)"
              (dragstart)="dragStarted(choice, $event)"
              [attr.draggable]="
                choice.ticked && !compact() && !busy() ? 'true' : null
              "
              [class.dragging]="dragging() === choice.section.id"
              [class.off]="!choice.ticked"
            >
              @if (!compact()) {
                @if (choice.ticked) {
                  <!-- The handle a pointer drags the row by, and the control
                       a keyboard moves it with: the arrow keys, one place at
                       a time. -->
                  <button
                    (keydown.arrowdown)="keyMove(choice, 1, $event)"
                    (keydown.arrowup)="keyMove(choice, -1, $event)"
                    [attr.aria-label]="
                      'catalog.locationSections.grip'
                        | rokuT
                          : {
                              name: nameOf(choice.section),
                              place: choice.place ?? 0,
                              count: order().length,
                            }
                    "
                    [disabled]="busy()"
                    class="grip"
                    type="button"
                    data-grip
                  ></button>
                } @else {
                  <span class="grip-space"></span>
                }
              }
              <label>
                <input
                  (change)="toggle(choice.section.id, $event)"
                  [checked]="choice.ticked"
                  [disabled]="busy()"
                  type="checkbox"
                />
                <span aria-hidden="true" class="place">{{
                  choice.place ?? ''
                }}</span>
                <span>{{ nameOf(choice.section) }}</span>
              </label>
              @if (!choice.ticked) {
                <span class="absent">{{
                  'catalog.locationSections.notHere' | rokuT
                }}</span>
              } @else if (compact()) {
                <span class="move">
                  <button
                    (click)="move(choice.section.id, -1)"
                    [attr.aria-label]="
                      'catalog.locationSections.up'
                        | rokuT: { name: nameOf(choice.section) }
                    "
                    [disabled]="busy() || choice.place === 1"
                    type="button"
                    data-move-up
                  >
                    <lib-chevron-left-icon class="up" />
                  </button>
                  <button
                    (click)="move(choice.section.id, 1)"
                    [attr.aria-label]="
                      'catalog.locationSections.down'
                        | rokuT: { name: nameOf(choice.section) }
                    "
                    [disabled]="busy() || choice.place === order().length"
                    type="button"
                    data-move-down
                  >
                    <lib-chevron-left-icon class="down" />
                  </button>
                </span>
              }
            </li>
          }
        </ol>

        <!-- What a move did, for a screen reader: the row has no other way to
             say where it went. -->
        <p aria-live="polite" class="visually-hidden">{{ moved() }}</p>

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

        <!-- On a phone the bar holds the two buttons of the edit in hand, and
             the way back to the chain's order sits under the list. Three
             buttons in 390 px wrap their own words. -->
        @if (ownList() && compact()) {
          <button
            (click)="useChainDefault()"
            [disabled]="busy()"
            class="below"
            type="button"
            data-use-chain
          >
            {{ 'catalog.locationSections.useChain' | rokuT }}
          </button>
        }

        <!-- A bar at the bottom of the tab, in view while the list scrolls
             under it, so that a long list can be ordered and saved without
             going back up. -->
        <div class="controls">
          @if (ownList() && !compact()) {
            <button
              (click)="useChainDefault()"
              [disabled]="busy()"
              type="button"
              data-use-chain
            >
              {{ 'catalog.locationSections.useChain' | rokuT }}
            </button>
          }
          <span class="grow"></span>
          <button
            (click)="discard()"
            [disabled]="busy() || !dirty()"
            type="button"
            data-discard
          >
            {{ 'catalog.locationSections.discard' | rokuT }}
          </button>
          <button
            (click)="save()"
            [disabled]="busy() || !dirty() || order().length === 0"
            class="primary"
            type="button"
            data-save
          >
            {{
              (busy()
                ? 'resource.action.working'
                : 'catalog.locationSections.save'
              ) | rokuT
            }}
          </button>
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
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    section {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-3);
    }

    /* The list keeps a width a row can be read across. The bar under it
       reaches the edges of the tab. */
    .lead,
    .choices,
    section > p {
      max-inline-size: 40rem;
    }

    .lead {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
    }

    .lead .source {
      flex: 1 1 16rem;
    }

    .waiting {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-waiting-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-waiting-on-wash);
    }

    .grow {
      flex: 1;
    }

    .below {
      align-self: flex-start;
    }

    .visually-hidden {
      position: absolute;
      overflow: hidden;
      clip-path: inset(50%);
      inline-size: 1px;
      block-size: 1px;
      white-space: nowrap;
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
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: 2.75rem;
      padding-inline: var(--admin-space-3) var(--admin-space-1);
    }

    .choices li + li {
      border-block-start: 1px solid var(--admin-border);
    }

    .choices li.off {
      padding-inline-end: var(--admin-space-3);
      color: var(--admin-ink-muted);
    }

    /* The row being dragged stays where the list has put it, marked, so the
       order under the pointer is the order that will be saved. */
    .choices li.dragging {
      background: var(--admin-accent-wash);
    }

    .place {
      min-inline-size: 1.25rem;
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    label {
      display: flex;
      flex: 1;
      gap: var(--admin-space-2);
      align-items: center;
      min-inline-size: 0;
      min-block-size: var(--admin-control);
      cursor: pointer;
    }

    .absent {
      font-size: 0.8125rem;
      white-space: nowrap;
    }

    /* Six dots, drawn and not typed, so that no font decides what they are. */
    .choices .grip,
    .grip-space {
      flex: none;
      inline-size: 1.5rem;
      min-block-size: 2.25rem;
      padding: 0;
    }

    .choices .grip {
      border: none;
      background-color: transparent;
      background-image: radial-gradient(
        circle,
        var(--admin-ink-muted) 1.25px,
        transparent 1.5px
      );
      background-position: center;
      background-size: 0.4375rem 0.4375rem;
      background-repeat: space;
      background-clip: content-box;
      padding: 0.5rem 0.3125rem;
      cursor: grab;
    }

    input[type='checkbox'] {
      inline-size: 1.125rem;
      block-size: 1.125rem;
      accent-color: var(--admin-accent);
    }

    .move {
      display: flex;
    }

    /* In view at the bottom of the tab while the list scrolls. On a phone it
       sits above the navigation bar, which is fixed below it. */
    .controls {
      position: sticky;
      inset-block-end: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
      margin-block-start: auto;
      margin-inline: calc(-1 * var(--admin-page-inline));
      padding: var(--admin-space-2) var(--admin-page-inline);
      border-block-start: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    @media (max-width: 47.99rem) {
      .controls {
        inset-block-end: var(--admin-bar);
      }

      .controls .primary {
        flex: 1;
      }
    }

    button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    /* 44 px wide and as tall, which is what a thumb needs. */
    .move button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 2.75rem;
      min-block-size: 2.75rem;
      padding: 0.75rem;
      border: none;
      background: none;
    }

    .move lib-chevron-left-icon {
      inline-size: 1.25rem;
      block-size: 1.25rem;
    }

    .move .up {
      transform: rotate(90deg);
    }

    .move .down {
      transform: rotate(-90deg);
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
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _changes = inject(ResourceChanges);

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

  /** What the info button beside the map state says (admin plan 0040). */
  readonly mapInfo: InfoContent = {
    title: 'catalog.locationSections.info.title',
    points: ['catalog.locationSections.info.map'],
  };

  /** A phone gets a button each way. A wider screen drags, or uses the keys. */
  readonly compact = inject(Viewport).compact;

  /** The section being dragged, or `null`. */
  readonly dragging = signal<string | null>(null);

  /** The last move, as a sentence for a screen reader. */
  readonly moved = signal('');

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
    this._sayMoved(id);
  }

  /** An arrow key on a row's handle: one place up or down. */
  keyMove(choice: SectionChoice, step: -1 | 1, event: Event): void {
    // The page would scroll under the row otherwise.
    event.preventDefault();
    this.move(choice.section.id, step);
  }

  /**
   * A drag began on a row.
   *
   * A list that follows a map asks before its first edit (admin plan 0040),
   * and a drag is an edit. The drag is refused while the question is open, and
   * the operator drags again after saying yes.
   */
  dragStarted(choice: SectionChoice, event: DragEvent): void {
    if (!choice.ticked || this._needsMapConsent(() => undefined)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData('text/plain', choice.section.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    this.dragging.set(choice.section.id);
  }

  /**
   * The dragged row is over another one, and takes its place.
   *
   * The list is reordered while the row is still held, so what the operator
   * sees under the pointer is the order a drop leaves. Only a ticked row is a
   * place: the rest are not in the shop's walk.
   */
  draggedOver(choice: SectionChoice, event: DragEvent): void {
    const id = this.dragging();
    if (id === null || !choice.ticked) {
      return;
    }
    // Without this the browser refuses the drop and animates the row back.
    event.preventDefault();

    const order = this.order();
    const to = order.indexOf(choice.section.id);
    if (choice.section.id === id || to === -1) {
      return;
    }

    this.savedNow.set(false);
    const next = order.filter((held) => held !== id);
    next.splice(to, 0, id);
    this.order.set(next);
  }

  dropped(): void {
    const id = this.dragging();
    this.dragging.set(null);
    if (id !== null) {
      this._sayMoved(id);
    }
  }

  private _sayMoved(id: string): void {
    const section = this.chain().find((held) => held.id === id);
    const place = this.order().indexOf(id) + 1;
    if (section === undefined || place === 0) {
      return;
    }
    this.moved.set(
      this._translator.t(
        'catalog.locationSections.movedTo',
        undefined,
        undefined,
        { name: this.nameOf(section), place, count: this.order().length }
      )
    );
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
      // The shop's own row carries its section names, and the page above
      // counts them on the tab.
      this._changes.wrote('location-sections');
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
