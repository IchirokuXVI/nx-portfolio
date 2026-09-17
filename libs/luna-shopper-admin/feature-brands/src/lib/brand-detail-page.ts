import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import { ChainNames } from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  gatewayErrorKey,
  RESOURCE_ID_PARAM,
  ResourceFormPage,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
import type { SeededSpelling } from './brand-seed';
import { BrandsGateway, type Brand } from './brands-gateway';

/** One chain, and every way it spells this brand. */
interface SpellingGroup {
  readonly supermarketId: string;
  readonly rows: readonly SeededSpelling[];
}

/**
 * One brand: the form that edits it, what it is linked to, and how the chains
 * spell it (admin plan 0027, section 2.3, and admin plan 0032, section 2.2).
 *
 * **The brand half is the generic detail view, drawn by the generic component.**
 * There is nothing peculiar about editing a brand, so `ResourceFormPage` is
 * embedded rather than reimplemented: it reads the same descriptor and the same
 * mode off this route, draws the fields it cannot change beside the ones it can,
 * and navigates back to the list on save. What this screen adds is the block
 * underneath, which is the one thing a descriptor cannot describe.
 *
 * The two blocks under it **fail on their own**, separately. A harvester outage
 * empties the spellings and leaves the form above it usable, because the two are
 * different questions and only one of them is out, and the links block reads the
 * brand again rather than borrowing the form's row for the same reason.
 *
 * A spelling that differs from the label only by case or by an accent is still a
 * row here. Seeing `MAHOU` beside `Mahou` is the point of the panel: it is the
 * evidence that one key is holding two chains together.
 */
@Component({
  selector: 'lib-brand-detail-page',
  imports: [ResourceFormPage, RokuTranslatorPipe, RouterLink, ConfirmDialog],
  template: `
    <lib-resource-form-page />

    <!-- What this brand is a spelling of, or what is a spelling of it (admin
         plan 0032, section 2.2). Its own read, so a brand whose links cannot be
         reached still opens and still edits. A brand that is neither draws
         nothing at all: most brands are neither. -->
    @if (linksErrorKey(); as key) {
      <section class="panel" data-links>
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      </section>
    } @else if (brand(); as row) {
      @if (row.canonicalBrandId !== null) {
        <section class="panel" data-links>
          <!-- The sentence and the link side by side rather than the name made
               into one: the name is interpolated into the sentence twice, and a
               link cannot be interpolated at all. -->
          <p>
            {{
              'brands.registered.links.spellingOf'
                | rokuT: { label: canonicalName(row) }
            }}
          </p>
          @if (canonicalLink(); as link) {
            <a [routerLink]="link">{{
              'brands.registered.links.open' | rokuT
            }}</a>
          }

          <!-- Legal for a spelling and for nothing else, which is why it is
               here and not on the list: the link that makes it legal is the
               sentence above it. -->
          <button
            (click)="confirmingDelete.set(true)"
            [disabled]="deleting()"
            class="danger"
            type="button"
            data-delete
          >
            {{ 'brands.registered.links.delete' | rokuT }}
          </button>

          @if (deleteErrorKey(); as key) {
            <p class="failure" role="alert">{{ key | rokuT }}</p>
          }
        </section>
      } @else if (row.linkCount > 0) {
        <section class="panel" data-links>
          <h2>{{ 'brands.registered.links.heading' | rokuT }}</h2>
          <ul class="links">
            @for (link of linked(); track link.id) {
              <li>
                <a [routerLink]="linkTo(link.id)">{{ link.label }}</a>
                <span class="key">{{ link.key }}</span>
              </li>
            }
          </ul>
        </section>
      }
    }

    @if (confirmingDelete()) {
      <lib-confirm-dialog
        (confirm)="remove()"
        (dismiss)="confirmingDelete.set(false)"
        [bodyArgs]="{ spelling: brand()?.label ?? '' }"
        [busy]="deleting()"
        bodyKey="brands.registered.links.deleteBody"
        confirmKey="brands.registered.links.deleteConfirm"
        headingKey="brands.registered.links.delete"
      />
    }

    <section class="panel">
      <h2>{{ 'brands.registered.spellings.heading' | rokuT }}</h2>
      <p class="explains">{{ 'brands.registered.spellings.says' | rokuT }}</p>

      @if (loading()) {
        <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
      } @else if (errorKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      } @else if (groups().length === 0) {
        <p class="state">{{ 'brands.registered.spellings.empty' | rokuT }}</p>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">
                  {{ 'brands.registered.spellings.chain' | rokuT }}
                </th>
                <th scope="col">
                  {{ 'brands.registered.spellings.spelling' | rokuT }}
                </th>
                <th class="figure" scope="col">
                  {{ 'brands.registered.spellings.products' | rokuT }}
                </th>
                <th class="figure" scope="col">
                  {{ 'brands.registered.spellings.waiting' | rokuT }}
                </th>
              </tr>
            </thead>
            @for (group of groups(); track group.supermarketId) {
              <tbody>
                @for (
                  row of group.rows;
                  track row.spelling;
                  let first = $first
                ) {
                  <tr>
                    @if (first) {
                      <th [attr.rowspan]="group.rows.length" scope="rowgroup">
                        {{ names.nameOf(group.supermarketId) }}
                      </th>
                    }
                    <td class="spelling">{{ row.spelling }}</td>
                    <td class="figure">{{ count(row.productCount) }}</td>
                    <td class="figure">{{ count(row.queuedCount) }}</td>
                  </tr>
                }
              </tbody>
            }
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .explains,
    .state {
      color: var(--admin-ink-muted);
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .failure {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .table-wrap {
      overflow-x: auto;
      inline-size: 100%;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: top;
    }

    thead th {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    tbody th {
      font-weight: 600;
    }

    tbody:last-child tr:last-child th,
    tbody:last-child tr:last-child td {
      border-block-end: none;
    }

    /* Verbatim and monospaced, so MAHOU beside Mahou reads as two spellings
       rather than as one of them styled twice. */
    .spelling {
      font-family: monospace;
      overflow-wrap: anywhere;
    }

    .figure {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }

    /* One spelling per line, its key beside it in the muted monospace a key
       wears everywhere in this app. */
    .links {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .links li {
      display: flex;
      gap: var(--admin-space-2);
      align-items: baseline;
    }

    .key {
      font-family: monospace;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandDetailPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _brands = inject(BrandsGateway);

  /** What a chain is called, resolved once per id (plan 0007, section 4). */
  readonly names = inject(ChainNames);

  /** The brand, from the URL. The same parameter the generic form reads. */
  readonly brandId = this._route.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? '';

  readonly loading = signal(true);
  readonly error = signal<GatewayError | null>(null);
  readonly errorKey = computed(() => gatewayErrorKey(this.error()));

  private readonly _spellings = signal<readonly SeededSpelling[]>([]);

  /**
   * The brand itself, read again for the links block.
   *
   * The generic form below reads its own row and shares nothing, so this block
   * asks for its own. That is one extra request on one screen, and it is what
   * lets the block fail on its own the way the spellings do.
   */
  readonly brand = signal<Brand | null>(null);
  /** The brands that are spellings of this one. Empty unless it has any. */
  readonly linked = signal<readonly Brand[]>([]);
  readonly linksError = signal<GatewayError | null>(null);
  readonly linksErrorKey = computed(() => gatewayErrorKey(this.linksError()));

  /** Whether the operator has been asked about deleting this spelling. */
  readonly confirmingDelete = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal<GatewayError | null>(null);
  readonly deleteErrorKey = computed(() => gatewayErrorKey(this.deleteError()));

  /**
   * Where the brand this one spells lives.
   *
   * Built from `ResourceRegistry.pathOf`, never from the segment: where a
   * resource is mounted is its section's business.
   */
  readonly canonicalLink = computed<readonly string[] | null>(() =>
    this.linkTo(this.brand()?.canonicalBrandId ?? null)
  );

  /**
   * The rows, one block per chain, in the order the route answered.
   *
   * Grouped here rather than trusted to arrive grouped. The route orders by
   * chain and then by count, so the rows are already adjacent; walking them into
   * first seen order makes the table's row spans correct whatever the answer
   * does, and costs one pass.
   */
  readonly groups = computed<readonly SpellingGroup[]>(() => {
    const groups: SpellingGroup[] = [];
    const at = new Map<string, SeededSpelling[]>();

    for (const row of this._spellings()) {
      const rows = at.get(row.supermarketId);
      if (rows === undefined) {
        const started: SeededSpelling[] = [row];
        at.set(row.supermarketId, started);
        groups.push({ supermarketId: row.supermarketId, rows: started });
        continue;
      }
      rows.push(row);
    }

    return groups;
  });

  constructor() {
    void this._load();
    void this._loadLinks();
  }

  /** A count, through `Intl`, like every other figure in this app. */
  count(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  /**
   * What to call the brand this one spells.
   *
   * `canonicalLabel` comes joined on the read. The id is the fallback, the way
   * a reference cell falls back to it: a name that did not arrive is a worse
   * answer than an id, and no answer is the worst of the three.
   */
  canonicalName(row: Brand): string {
    return row.canonicalLabel ?? row.canonicalBrandId ?? '';
  }

  /** Where one brand lives, or nothing when this app did not mount brands. */
  linkTo(brandId: string | null): readonly string[] | null {
    const path = this._registry.pathOf('brands');
    return brandId === null || path === null ? null : [...path, brandId];
  }

  /**
   * Delete this spelling.
   *
   * Only a linked brand reaches this, because only a linked brand draws the
   * button: its products belong to the brand it spells, so they go back to no
   * brand and the spelling returns to the suggestions. The list is where the
   * operator goes next, since the row they were looking at is gone.
   */
  async remove(): Promise<void> {
    const row = this.brand();
    if (row === null || this.deleting()) {
      return;
    }

    this.deleting.set(true);
    this.deleteError.set(null);

    try {
      await this._brands.remove(row.id);
      this.confirmingDelete.set(false);
      const path = this._registry.pathOf('brands');
      if (path !== null) {
        await this._router.navigate([...path]);
      }
    } catch (error) {
      // The dialog closes and the sentence lands on the block, where the brand
      // it is about is still on screen.
      this.confirmingDelete.set(false);
      this.deleteError.set(error as GatewayError);
    } finally {
      this.deleting.set(false);
    }
  }

  private async _load(): Promise<void> {
    try {
      const rows = await this._brands.spellings(this.brandId);
      this._spellings.set(rows);
      // The names are a decoration on a decoration: a chain the reference cannot
      // name shows its id, and the block draws either way.
      void this.names.resolve(rows.map((row) => row.supermarketId));
    } catch (error) {
      this.error.set(error as GatewayError);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The brand, and its spellings when it has any.
   *
   * Two requests at most, and one for the brands that are neither a spelling
   * nor spelled: `linkCount` is on the row, so the second read is only made
   * where there is something to read.
   */
  private async _loadLinks(): Promise<void> {
    try {
      const row = await this._brands.read(this.brandId);
      this.brand.set(row);

      if (row.canonicalBrandId === null && row.linkCount > 0) {
        this.linked.set(await this._brands.links(row.id));
      }
    } catch (error) {
      this.linksError.set(error as GatewayError);
    }
  }
}
