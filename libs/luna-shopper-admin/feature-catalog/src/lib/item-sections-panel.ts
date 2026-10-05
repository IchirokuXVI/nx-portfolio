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
import {
  ContentLocaleStore,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { localizedTextValue } from '@portfolio/luna-shopper-admin/models';
import { ReferencePicker } from '@portfolio/luna-shopper-admin/ui';
import type { ItemScopePrices } from './catalog-seed';
import { itemScopePricesSource } from './catalog-sources';
import { panelErrorKey } from './chain-sections';
import {
  ShopSections,
  type SectionsAtLocation,
  type ShopSection,
} from './shop-sections';

/** How many scopes one read of the product's prices asks for. */
const SCOPE_PAGE_SIZE = 100;

/** The most pages that read follows: a product is priced at a few scopes. */
const SCOPE_PAGE_LIMIT = 10;

/** The sentence the preview says, and what it names. */
export interface PreviewSentence {
  readonly key: string;
  readonly sections: string;
}

/**
 * The preview's answer as a sentence, naming the step of the rule that
 * answered (backend plan 0167, section 3).
 */
export function previewSentence(
  answer: SectionsAtLocation,
  itemId: string,
  nameOf: (id: string) => string
): PreviewSentence {
  const entry = answer.items.find((item) => item.itemId === itemId);
  const step = entry?.step ?? 'NONE';
  const sections = (entry?.sectionIds ?? []).map(nameOf).join(', ');
  switch (step) {
    case 'PINNED':
      return { key: 'catalog.itemSections.preview.pinned', sections };
    case 'COVERED':
      return { key: 'catalog.itemSections.preview.covered', sections };
    default:
      return { key: 'catalog.itemSections.preview.none', sections: '' };
  }
}

/**
 * One chain's row of the panel: the product's pins there, an edit of them, and
 * the preview at one of that chain's shops.
 */
@Component({
  selector: 'lib-item-chain-sections',
  imports: [RokuTranslatorPipe, ReferencePicker],
  template: `
    <article [attr.aria-labelledby]="headingId()">
      <h3 [id]="headingId()">{{ chainName() }}</h3>

      @if (loading() && sections().length === 0) {
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
      } @else if (sections().length === 0) {
        <p class="muted">{{ 'catalog.itemSections.noSections' | rokuT }}</p>
      } @else {
        @if (editing()) {
          <fieldset>
            <legend>{{ 'catalog.itemSections.pickLegend' | rokuT }}</legend>
            @for (section of sections(); track section.id) {
              <label>
                <input
                  (change)="toggle(section.id)"
                  [checked]="picked().includes(section.id)"
                  [disabled]="busy()"
                  type="checkbox"
                />
                <span>{{ nameOf(section) }}</span>
              </label>
            }
            <p class="muted">{{ 'catalog.itemSections.pickHelp' | rokuT }}</p>
          </fieldset>
          @if (saveErrorKey(); as key) {
            <p class="failure" role="alert">{{ key | rokuT }}</p>
          }
          <div class="controls">
            <button
              (click)="save()"
              [disabled]="busy()"
              class="primary"
              type="button"
            >
              {{
                (busy()
                  ? 'resource.action.working'
                  : 'catalog.itemSections.save'
                ) | rokuT
              }}
            </button>
            <button (click)="cancel()" [disabled]="busy()" type="button">
              {{ 'resource.action.cancel' | rokuT }}
            </button>
          </div>
        } @else {
          <p class="pins">
            @if (pinnedNames(); as names) {
              {{ 'catalog.itemSections.pinnedTo' | rokuT: { sections: names } }}
            } @else {
              {{ 'catalog.itemSections.byCategories' | rokuT }}
            }
          </p>
          <button (click)="edit()" type="button">
            {{ 'catalog.itemSections.edit' | rokuT }}
          </button>
        }

        <div class="preview">
          <label [for]="pickerId()" class="label">
            {{ 'catalog.itemSections.previewAt' | rokuT }}
          </label>
          <lib-reference-picker
            (valueChange)="choose($event)"
            [controlId]="pickerId()"
            [lookup]="references"
            [scope]="{ supermarketId: supermarketId() }"
            [value]="locationId()"
            resource="locations"
          />
          @if (previewErrorKey(); as key) {
            <p class="failure" role="alert">{{ key | rokuT }}</p>
          } @else if (preview(); as sentence) {
            <p class="answer" role="status">
              {{ sentence.key | rokuT: { sections: sentence.sections } }}
            </p>
          }
        </div>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
    }

    article {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding-block: var(--admin-space-4);
    }

    h3 {
      font-size: 0.9375rem;
      font-weight: 700;
    }

    .muted {
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

    fieldset {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    legend {
      padding-inline: var(--admin-space-1);
      font-weight: 600;
    }

    fieldset label {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: var(--admin-control);
      cursor: pointer;
    }

    input[type='checkbox'] {
      inline-size: 1.125rem;
      block-size: 1.125rem;
      accent-color: var(--admin-accent);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    .preview {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      inline-size: 100%;
      max-inline-size: 32rem;
      padding: var(--admin-space-3);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
    }

    .label {
      font-size: 0.875rem;
      font-weight: 600;
    }

    .answer {
      padding-inline-start: var(--admin-space-3);
      border-inline-start: 3px solid var(--admin-accent);
    }

    button {
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      cursor: pointer;
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
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
export class ItemChainSections {
  private readonly _shopSections = inject(ShopSections);
  private readonly _content = inject(ContentLocaleStore);
  readonly references = inject(ResourceReferences);

  readonly itemId = input.required<string>();
  readonly supermarketId = input.required<string>();
  readonly chainName = input.required<string>();

  /** The chain's sections, in the chain's order. */
  readonly sections = signal<readonly ShopSection[]>([]);
  /** The sections the product is pinned to in this chain. */
  readonly pinned = signal<readonly string[]>([]);
  /** The pick being edited, while the edit is open. */
  readonly picked = signal<readonly string[]>([]);
  readonly editing = signal(false);

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly readErrorKey = signal<string | null>(null);
  readonly saveErrorKey = signal<string | null>(null);

  /** The shop the preview is at, or `''`. */
  readonly locationId = signal('');
  readonly preview = signal<PreviewSentence | null>(null);
  readonly previewErrorKey = signal<string | null>(null);

  private _generation = 0;
  private _previewGeneration = 0;

  readonly headingId = computed(() => `item-chain-${this.supermarketId()}`);
  readonly pickerId = computed(() => `item-chain-shop-${this.supermarketId()}`);

  /** The pinned sections by name, or `''` when there is no pin. */
  readonly pinnedNames = computed(() =>
    this.pinned()
      .map((id) => this._sectionName(id))
      .join(', ')
  );

  constructor() {
    effect(() => {
      const itemId = this.itemId();
      const supermarketId = this.supermarketId();
      untracked(() => void this._read(itemId, supermarketId));
    });
  }

  nameOf(section: ShopSection): string {
    return (
      localizedTextValue(section.name, this._content.order()) || section.slug
    );
  }

  reload(): Promise<void> {
    return this._read(this.itemId(), this.supermarketId());
  }

  edit(): void {
    this.saveErrorKey.set(null);
    this.picked.set(this.pinned());
    this.editing.set(true);
  }

  cancel(): void {
    this.editing.set(false);
    this.saveErrorKey.set(null);
  }

  toggle(id: string): void {
    this.picked.update((picked) =>
      picked.includes(id)
        ? picked.filter((held) => held !== id)
        : [...picked, id]
    );
  }

  /** The pick, whole. An empty pick removes the pins. */
  async save(): Promise<void> {
    this.busy.set(true);
    this.saveErrorKey.set(null);
    try {
      const pinned = await this._shopSections.setPins(
        this.supermarketId(),
        this.itemId(),
        this.picked()
      );
      this.pinned.set(pinned);
      this.editing.set(false);
      await this._previewAt(this.locationId());
    } catch (error) {
      this.saveErrorKey.set(panelErrorKey(error));
    } finally {
      this.busy.set(false);
    }
  }

  choose(locationId: string): Promise<void> {
    this.locationId.set(locationId);
    return this._previewAt(locationId);
  }

  private async _previewAt(locationId: string): Promise<void> {
    this._previewGeneration += 1;
    const generation = this._previewGeneration;
    this.previewErrorKey.set(null);
    if (locationId === '') {
      this.preview.set(null);
      return;
    }
    try {
      const answer = await this._shopSections.atLocation(locationId, [
        this.itemId(),
      ]);
      if (generation === this._previewGeneration) {
        this.preview.set(
          previewSentence(answer, this.itemId(), (id) => this._sectionName(id))
        );
      }
    } catch (error) {
      if (generation === this._previewGeneration) {
        this.preview.set(null);
        this.previewErrorKey.set(panelErrorKey(error));
      }
    }
  }

  private _sectionName(id: string): string {
    const section = this.sections().find((held) => held.id === id);
    return section === undefined ? id : this.nameOf(section);
  }

  private async _read(itemId: string, supermarketId: string): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    this.loading.set(true);
    this.readErrorKey.set(null);
    try {
      const [sections, pinned] = await Promise.all([
        this._shopSections.chainSections(supermarketId),
        this._shopSections.pinsOf(supermarketId, itemId),
      ]);
      if (generation !== this._generation) {
        return;
      }
      this.sections.set(sections);
      this.pinned.set(pinned);
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

/**
 * Where the product is, chain by chain (admin plan 0037, targets 3 and 4).
 *
 * One row per chain the product is sold at, read from its prices at every
 * scope: a scope belongs to one chain, so the chains it is priced in are the
 * chains that sell it. Each row says which sections the product is pinned to
 * there, or that it is placed by its categories, and edits the pins with a
 * pick of that chain's sections. Saving an empty pick removes them.
 *
 * Under each chain, a preview takes one of its shops and says where shoppers
 * will find the product there, naming the step that answered: a pin, a
 * section covering its category, or neither, when it is shown under its own
 * categories.
 *
 * It fails on its own, like the source products panel beside it.
 */
@Component({
  selector: 'lib-item-sections-panel',
  imports: [RokuTranslatorPipe, ItemChainSections],
  template: `
    <section aria-labelledby="item-sections-heading">
      <h2 id="item-sections-heading">
        {{ 'catalog.itemSections.heading' | rokuT }}
      </h2>

      @if (loading() && chains().length === 0) {
        <p class="muted" role="status">
          {{ 'resource.list.loading' | rokuT }}
        </p>
      } @else if (errorKey(); as key) {
        <div class="failure" role="alert">
          <p>{{ key | rokuT }}</p>
          <button (click)="reload()" type="button">
            {{ 'resource.action.retry' | rokuT }}
          </button>
        </div>
      } @else if (chains().length === 0) {
        <p class="muted">{{ 'catalog.itemSections.notSold' | rokuT }}</p>
      } @else {
        @for (chain of chains(); track chain) {
          <lib-item-chain-sections
            [chainName]="chainName(chain)"
            [itemId]="itemId()"
            [supermarketId]="chain"
          />
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    lib-item-chain-sections + lib-item-chain-sections {
      border-block-start: 1px solid var(--admin-border);
    }

    .muted {
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

    button {
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      cursor: pointer;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemSectionsPanel {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _references = inject(ResourceReferences);

  /** The product. */
  readonly itemId = input.required<string>();

  /** The chains it is sold at, in the order its scopes came. */
  readonly chains = signal<readonly string[]>([]);
  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);

  private readonly _chainNames = signal<ReadonlyMap<string, string>>(new Map());
  private _generation = 0;

  constructor() {
    effect(() => {
      const itemId = this.itemId();
      untracked(() => void this._read(itemId));
    });
  }

  chainName(id: string): string {
    return this._chainNames().get(id) ?? id;
  }

  reload(): Promise<void> {
    return this._read(this.itemId());
  }

  private async _read(itemId: string): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    this.loading.set(true);
    this.errorKey.set(null);

    try {
      const gateway = this._gateways.for<ItemScopePrices>(
        itemScopePricesSource()
      );
      const chains: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < SCOPE_PAGE_LIMIT; page += 1) {
        const answer = await gateway.list({
          cursor,
          limit: SCOPE_PAGE_SIZE,
          filters: { itemId },
        });
        for (const scope of answer.items) {
          const chain = scope.supermarketId;
          if (
            typeof chain === 'string' &&
            chain !== '' &&
            !chains.includes(chain)
          ) {
            chains.push(chain);
          }
        }
        if (answer.nextCursor === null) {
          break;
        }
        cursor = answer.nextCursor;
      }
      if (generation !== this._generation) {
        return;
      }
      this.chains.set(chains);
      this._nameChains(chains);
    } catch (error) {
      if (generation === this._generation) {
        this.errorKey.set(panelErrorKey(error));
      }
    } finally {
      if (generation === this._generation) {
        this.loading.set(false);
      }
    }
  }

  private _nameChains(ids: readonly string[]): void {
    for (const id of ids) {
      this._references
        .resolve('supermarkets', id)
        .then((option) => {
          if (option !== null) {
            this._chainNames.update((held) =>
              new Map(held).set(id, option.title)
            );
          }
        })
        .catch(() => {
          // The id stays.
        });
    }
  }
}
