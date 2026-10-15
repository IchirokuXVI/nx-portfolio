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
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  ResourceChanges,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  type InfoContent,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  InfoButton,
  ReferencePicker,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import {
  panelErrorKey,
  ShopSections,
  type ItemSectionsAt,
  type ShopSection,
} from './shop-sections';

/** One category a section covers, by name. */
export interface CoveredCategory {
  readonly id: string;
  readonly name: string;
  /** A top level category, which covers every category inside it. */
  readonly root: boolean;
}

/** One row of the list: a section and its place in the shop's walk, from 1. */
export interface SectionRow {
  readonly section: ShopSection;
  readonly place: number;
}

/** The sentence the preview says, and the sections it names. */
export interface PreviewSentence {
  readonly key: string;
  readonly sections: string;
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
 * The preview's answer for one product as a sentence: the sections that hold
 * one of its categories, or none (backend plan 0200, section 3).
 */
export function previewSentence(
  answer: readonly ItemSectionsAt[],
  itemId: string,
  nameOf: (id: string) => string
): PreviewSentence {
  const entry = answer.find((item) => item.itemId === itemId);
  if (entry === undefined || entry.step !== 'COVERED') {
    return { key: 'catalog.locationSections.preview.none', sections: '' };
  }
  return {
    key: 'catalog.locationSections.preview.covered',
    sections: entry.sectionIds.map(nameOf).join(', '),
  };
}

/**
 * The sections of a shop (admin plan 0063, section 2): the one place a section
 * is added, opened, ordered and deleted. A section belongs to its shop, and a
 * shop with none has none: nothing comes from the chain.
 *
 * - **Add** opens the `sections` form under the shop, and the new section
 *   goes last.
 * - **A row opens its section**, whose form changes its name and categories.
 * - **The order is held here and saved whole.** Moving a row changes nothing
 *   on the server: Save sends every section in the order shown, in one
 *   request.
 * - **Delete asks first**, because a section leaves the shopping lists of the
 *   shoppers at this shop with it.
 * - **The preview** answers where one product is at this shop, from what the
 *   server holds.
 */
@Component({
  selector: 'lib-location-sections',
  imports: [
    ConfirmDialog,
    InfoButton,
    ChevronLeftIcon,
    ReferencePicker,
    RokuTranslatorPipe,
    RouterLink,
  ],
  template: `
    <section aria-labelledby="location-sections-heading">
      <div class="head">
        <h2 id="location-sections-heading">
          {{ 'catalog.locationSections.heading' | rokuT }}
        </h2>
        @if (newLink(); as link) {
          <a [routerLink]="link" class="button" data-add>{{
            'catalog.locationSections.add' | rokuT
          }}</a>
        }
      </div>

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
      } @else if (rows().length === 0) {
        <div class="empty" data-empty>
          <p>{{ 'catalog.locationSections.empty' | rokuT }}</p>
          @if (newLink(); as link) {
            <a [routerLink]="link" class="button">{{
              'catalog.locationSections.add' | rokuT
            }}</a>
          }
        </div>
      } @else {
        @if (hasMap()) {
          <div class="lead">
            <!-- A waiting state and not a paragraph: what a map does to the
                 order is behind the info button, and the same sentence is
                 asked before the first move. -->
            <span class="waiting" data-map-notice>{{
              'catalog.locationSections.mapState' | rokuT
            }}</span>
            <lib-info-button [info]="mapInfo" />
          </div>
        }

        <ol class="rows">
          @for (row of rows(); track row.section.id) {
            <li
              (dragend)="dropped()"
              (dragover)="draggedOver(row, $event)"
              (dragstart)="dragStarted(row, $event)"
              [attr.draggable]="!compact() && !busy() ? 'true' : null"
              [class.dragging]="dragging() === row.section.id"
            >
              @if (!compact()) {
                <!-- The handle a pointer drags the row by, and the control a
                     keyboard moves it with: the arrow keys, one place at a
                     time. -->
                <button
                  (keydown.arrowdown)="keyMove(row, 1, $event)"
                  (keydown.arrowup)="keyMove(row, -1, $event)"
                  [attr.aria-label]="
                    'catalog.locationSections.grip'
                      | rokuT
                        : {
                            name: nameOf(row.section),
                            place: row.place,
                            count: rows().length,
                          }
                  "
                  [disabled]="busy()"
                  class="grip"
                  type="button"
                  data-grip
                ></button>
              }
              <span aria-hidden="true" class="place">{{ row.place }}</span>
              <div class="what">
                @if (rowLink(row.section.id); as link) {
                  <a [routerLink]="link" class="name" data-open>{{
                    nameOf(row.section)
                  }}</a>
                } @else {
                  <span class="name">{{ nameOf(row.section) }}</span>
                }
                <span class="covers">
                  @for (category of covered(row.section); track category.id) {
                    <span [class.root]="category.root" class="chip">{{
                      category.root
                        ? ('catalog.locationSections.coversAll'
                          | rokuT: { name: category.name })
                        : category.name
                    }}</span>
                  } @empty {
                    <span class="muted">{{
                      'catalog.locationSections.coversNothing' | rokuT
                    }}</span>
                  }
                </span>
              </div>
              @if (compact()) {
                <span class="move">
                  <button
                    (click)="move(row.section.id, -1)"
                    [attr.aria-label]="
                      'catalog.locationSections.up'
                        | rokuT: { name: nameOf(row.section) }
                    "
                    [disabled]="busy() || row.place === 1"
                    type="button"
                    data-move-up
                  >
                    <lib-chevron-left-icon class="up" />
                  </button>
                  <button
                    (click)="move(row.section.id, 1)"
                    [attr.aria-label]="
                      'catalog.locationSections.down'
                        | rokuT: { name: nameOf(row.section) }
                    "
                    [disabled]="busy() || row.place === rows().length"
                    type="button"
                    data-move-down
                  >
                    <lib-chevron-left-icon class="down" />
                  </button>
                </span>
              }
              <button
                (click)="deleting.set(row.section)"
                [attr.aria-label]="
                  'catalog.locationSections.deleteNamed'
                    | rokuT: { name: nameOf(row.section) }
                "
                [disabled]="busy()"
                class="danger"
                type="button"
                data-delete
              >
                {{ 'resource.action.delete' | rokuT }}
              </button>
            </li>
          }
        </ol>

        <!-- What a move did, for a screen reader: the row has no other way to
             say where it went. -->
        <p aria-live="polite" class="visually-hidden">{{ moved() }}</p>

        @if (saveErrorKey(); as key) {
          <p class="failure" role="alert">{{ key | rokuT }}</p>
        }
        @if (savedNow()) {
          <p class="muted" role="status">
            {{ 'catalog.locationSections.saved' | rokuT }}
          </p>
        }

        <section aria-labelledby="location-sections-preview" class="preview">
          <h3 id="location-sections-preview">
            {{ 'catalog.locationSections.preview.heading' | rokuT }}
          </h3>
          <label class="label" for="location-sections-item">
            {{ 'catalog.locationSections.preview.product' | rokuT }}
          </label>
          <lib-reference-picker
            (valueChange)="choose($event)"
            [lookup]="references"
            [value]="itemId()"
            controlId="location-sections-item"
            resource="items"
          />
          @if (previewErrorKey(); as key) {
            <p class="failure" role="alert">{{ key | rokuT }}</p>
          } @else if (preview(); as sentence) {
            <p class="answer" role="status" data-preview>
              {{ sentence.key | rokuT: { sections: sentence.sections } }}
            </p>
          }
        </section>

        <!-- A bar at the bottom of the tab, in view while the list scrolls
             under it, so that a long list can be ordered and saved without
             going back up. -->
        <div class="controls">
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
            [disabled]="busy() || !dirty()"
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

    @if (deleting(); as target) {
      <lib-confirm-dialog
        (confirm)="confirmDelete(target)"
        (dismiss)="deleting.set(null)"
        [bodyArgs]="{ name: nameOf(target) }"
        [busy]="removing()"
        bodyKey="catalog.locationSections.deleteBody"
        confirmKey="catalog.locationSections.deleteConfirm"
        headingKey="catalog.locationSections.deleteHeading"
      />
    }

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
      flex-direction: column;
      gap: var(--admin-space-3);
    }

    :host > section {
      flex: 1;
    }

    /* The list keeps a width a row can be read across. The bar under it
       reaches the edges of the tab. */
    .head,
    .lead,
    .rows,
    .empty,
    .preview,
    :host > section > p {
      max-inline-size: 48rem;
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    h3 {
      font-size: 0.9375rem;
      font-weight: 600;
    }

    .lead {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
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

    .visually-hidden {
      position: absolute;
      overflow: hidden;
      clip-path: inset(50%);
      inline-size: 1px;
      block-size: 1px;
      white-space: nowrap;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .empty {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
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

    .rows {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      list-style: none;
    }

    .rows li {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: 3.25rem;
      padding: var(--admin-space-1) var(--admin-space-2) var(--admin-space-1)
        var(--admin-space-3);
    }

    .rows li + li {
      border-block-start: 1px solid var(--admin-border);
    }

    /* The row being dragged stays where the list has put it, marked, so the
       order under the pointer is the order that will be saved. */
    .rows li.dragging {
      background: var(--admin-accent-wash);
    }

    .place {
      flex: none;
      min-inline-size: 1.25rem;
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .what {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-3);
      align-items: baseline;
      min-inline-size: 0;
    }

    .name {
      font-weight: 600;
      color: var(--admin-ink);
    }

    a.name {
      text-decoration: underline;
      text-decoration-color: var(--admin-border);
      text-underline-offset: 0.2em;
    }

    a.name:hover {
      color: var(--admin-accent);
      text-decoration-color: currentColor;
    }

    .covers {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1);
      font-size: 0.8125rem;
    }

    .chip {
      padding: 0 var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      white-space: nowrap;
    }

    .chip.root {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    /* Six dots, drawn and not typed, so that no font decides what they are. */
    .rows .grip {
      flex: none;
      inline-size: 1.5rem;
      min-block-size: 2.25rem;
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

    .move {
      display: flex;
      flex: none;
    }

    .preview {
      gap: var(--admin-space-2);
      margin-block-start: var(--admin-space-3);
    }

    .label {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .answer {
      color: var(--admin-ink);
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

    a.button,
    button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      text-decoration: none;
      cursor: pointer;
    }

    a.button {
      display: inline-flex;
      align-items: center;
      font-weight: 600;
      color: var(--admin-accent);
    }

    button.danger {
      flex: none;
      border-color: transparent;
      background: none;
      color: var(--admin-danger);
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

    a:focus-visible,
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
export class LocationSections {
  private readonly _sections = inject(ShopSections);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _changes = inject(ResourceChanges);
  private readonly _registry = inject(ResourceRegistry);
  readonly references = inject(ResourceReferences);

  /** The shop. */
  readonly locationId = input.required<string>();
  /** The shop's chain, which is part of the address of a section. */
  readonly supermarketId = input.required<string>();
  /**
   * Whether the shop has a walk shown to shoppers (backend plan 0168), whose
   * every save writes the order of these sections (backend plan 0200,
   * section 5).
   */
  readonly hasMap = input(false);

  /**
   * Whether the operator has agreed, on this visit, to change an order the
   * map writes. Asked once per visit, on the first move, and never again
   * until the panel is opened afresh.
   */
  readonly mapEditAccepted = signal(false);
  /** The move waiting on that agreement, or `null`. */
  private readonly _pendingEdit = signal<(() => unknown) | null>(null);
  /** Whether the map confirmation is open. */
  readonly askingMapEdit = computed(() => this._pendingEdit() !== null);

  /** The shop's sections as the server holds them, in its order. */
  readonly saved = signal<readonly ShopSection[] | null>(null);
  /** The order held here, which Save sends. */
  readonly order = signal<readonly string[]>([]);

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly readErrorKey = signal<string | null>(null);
  readonly saveErrorKey = signal<string | null>(null);
  /** Whether the last act was a successful save, for the status line. */
  readonly savedNow = signal(false);

  /** The section the operator asked to delete, while the dialog is open. */
  readonly deleting = signal<ShopSection | null>(null);
  readonly removing = signal(false);

  /** The product the preview is about, or `''`. */
  readonly itemId = signal('');
  readonly preview = signal<PreviewSentence | null>(null);
  readonly previewErrorKey = signal<string | null>(null);

  private readonly _categories = signal<ReadonlyMap<string, CoveredCategory>>(
    new Map()
  );
  private readonly _asked = new Set<string>();
  private _generation = 0;
  private _previewGeneration = 0;

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

  /** The ids the server holds, in its order. */
  private readonly _savedOrder = computed(() =>
    (this.saved() ?? []).map((section) => section.id)
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

  /** The sections in the order held here. */
  readonly rows = computed<readonly SectionRow[]>(() => {
    const saved = this.saved() ?? [];
    return this.order()
      .map((id) => saved.find((section) => section.id === id))
      .filter((section): section is ShopSection => section !== undefined)
      .map((section, index) => ({ section, place: index + 1 }));
  });

  /** The create form, opened under this shop. */
  readonly newLink = computed(() => {
    const path = this._registry.pathOf('sections', this._parents());
    return path === null ? null : [...path, 'new'];
  });

  constructor() {
    effect(() => {
      const locationId = this.locationId();
      untracked(() => {
        // Accepting that a map writes the order holds for one shop only, and
        // so does the product the preview was asked about.
        this.mapEditAccepted.set(false);
        this.itemId.set('');
        this.preview.set(null);
        void this._read(locationId);
      });
    });
  }

  nameOf(section: ShopSection): string {
    return (
      localizedTextValue(section.name, this._content.order()) || section.slug
    );
  }

  /** The categories a section covers, named once the lookup answers. */
  covered(section: ShopSection): readonly CoveredCategory[] {
    const known = this._categories();
    return section.categoryIds.map(
      (id) => known.get(id) ?? { id, name: id, root: false }
    );
  }

  /** Where one section opens. */
  rowLink(id: string): readonly string[] | null {
    return this._registry.rowPath('sections', id, this._parents());
  }

  reload(): Promise<void> {
    return this._read(this.locationId());
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
  keyMove(row: SectionRow, step: -1 | 1, event: Event): void {
    // The page would scroll under the row otherwise.
    event.preventDefault();
    this.move(row.section.id, step);
  }

  /**
   * A drag began on a row.
   *
   * An order that follows a map asks before its first change (admin plan
   * 0040), and a drag is a change. The drag is refused while the question is
   * open, and the operator drags again after saying yes.
   */
  dragStarted(row: SectionRow, event: DragEvent): void {
    if (this._needsMapConsent(() => undefined)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData('text/plain', row.section.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    this.dragging.set(row.section.id);
  }

  /**
   * The dragged row is over another one, and takes its place.
   *
   * The list is reordered while the row is still held, so what the operator
   * sees under the pointer is the order a drop leaves.
   */
  draggedOver(row: SectionRow, event: DragEvent): void {
    const id = this.dragging();
    if (id === null) {
      return;
    }
    // Without this the browser refuses the drop and animates the row back.
    event.preventDefault();

    const order = this.order();
    const to = order.indexOf(row.section.id);
    if (row.section.id === id || to === -1) {
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

  /** Back to what the server holds. */
  discard(): void {
    this.saveErrorKey.set(null);
    this.order.set(this._savedOrder());
  }

  /** Every section, in the order shown, in one request. */
  async save(): Promise<void> {
    this.busy.set(true);
    this.saveErrorKey.set(null);
    this.savedNow.set(false);
    try {
      const answer = await this._sections.setOrder(
        this.locationId(),
        this.order()
      );
      this._hold(answer);
      this.savedNow.set(true);
      // The shop's own row carries its section names in this order.
      this._changes.wrote('location-sections');
    } catch (error) {
      // The order stays, so a refusal costs a retry and not the work.
      this.saveErrorKey.set(panelErrorKey(error));
    } finally {
      this.busy.set(false);
    }
  }

  async confirmDelete(section: ShopSection): Promise<void> {
    this.removing.set(true);
    this.saveErrorKey.set(null);
    this.savedNow.set(false);
    try {
      await this._sections.remove(section.id);
      this.deleting.set(null);
      // An order being changed keeps its changes, less the section.
      const held = this.order().filter((id) => id !== section.id);
      const answer = await this._sections.forLocation(this.locationId());
      this._hold(answer, held);
      this._changes.wrote('sections');
      await this._previewAgain();
    } catch (error) {
      this.deleting.set(null);
      this.saveErrorKey.set(panelErrorKey(error));
    } finally {
      this.removing.set(false);
    }
  }

  /** A product was picked for the preview, or cleared. */
  choose(itemId: string): Promise<void> {
    this.itemId.set(itemId);
    return this._previewAgain();
  }

  /** The operator agreed: remember it for the visit, and make the move. */
  async confirmMapEdit(): Promise<void> {
    const edit = this._pendingEdit();
    this.mapEditAccepted.set(true);
    this._pendingEdit.set(null);
    await edit?.();
  }

  /** The operator declined: nothing changes, and the next move asks again. */
  dismissMapEdit(): void {
    this._pendingEdit.set(null);
  }

  /** The ids above a section, by the name of each parent's filter. */
  private _parents(): Record<string, string> {
    return {
      supermarketLocationId: this.locationId(),
      supermarketId: this.supermarketId(),
    };
  }

  /**
   * Whether a move has to wait for the operator (admin plan 0040, target 2).
   *
   * Only for a shop with a map, and only until the first yes of the visit.
   * Adding, opening and deleting a section never ask: a walk deletes no
   * section, and it only writes the order (backend plan 0200, section 5).
   */
  private _needsMapConsent(edit: () => unknown): boolean {
    if (!this.hasMap() || this.mapEditAccepted()) {
      return false;
    }
    this._pendingEdit.set(edit);
    return true;
  }

  private _sayMoved(id: string): void {
    const section = this.saved()?.find((held) => held.id === id);
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

  /**
   * Hold what the server answered. `order`, when given, is an order being
   * changed that should survive: its ids that still exist, then the rest.
   */
  private _hold(
    sections: readonly ShopSection[],
    order?: readonly string[]
  ): void {
    const ids = sections.map((section) => section.id);
    this.saved.set(sections);
    this.order.set(
      order === undefined
        ? ids
        : [
            ...order.filter((id) => ids.includes(id)),
            ...ids.filter((id) => !order.includes(id)),
          ]
    );
    this._nameCategories(sections.flatMap((section) => section.categoryIds));
  }

  private async _read(locationId: string): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    this.loading.set(true);
    this.readErrorKey.set(null);

    try {
      const sections = await this._sections.forLocation(locationId);
      if (generation !== this._generation) {
        return;
      }
      this._hold(sections);
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

  private async _previewAgain(): Promise<void> {
    this._previewGeneration += 1;
    const generation = this._previewGeneration;
    const itemId = this.itemId();
    this.previewErrorKey.set(null);
    if (itemId === '') {
      this.preview.set(null);
      return;
    }
    try {
      const answer = await this._sections.atLocation(this.locationId(), [
        itemId,
      ]);
      if (generation !== this._previewGeneration) {
        return;
      }
      const saved = this.saved() ?? [];
      this.preview.set(
        previewSentence(answer, itemId, (id) => {
          const section = saved.find((held) => held.id === id);
          return section === undefined ? id : this.nameOf(section);
        })
      );
    } catch (error) {
      if (generation === this._previewGeneration) {
        this.preview.set(null);
        this.previewErrorKey.set(panelErrorKey(error));
      }
    }
  }

  private _nameCategories(ids: readonly string[]): void {
    for (const id of new Set(ids)) {
      if (this._asked.has(id)) {
        continue;
      }
      this._asked.add(id);
      this.references
        .resolve('categories', id)
        .then((option) => {
          if (option === null) {
            return;
          }
          const parent = option.row?.['parentId'];
          this._categories.update((held) =>
            new Map(held).set(id, {
              id,
              name: option.title,
              root: parent === null,
            })
          );
        })
        .catch(() => {
          // The id stays, which is what a category nobody can name shows.
        });
    }
  }
}
