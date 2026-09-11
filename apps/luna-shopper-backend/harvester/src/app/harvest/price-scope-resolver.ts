import { Injectable } from '@nestjs/common';
import type { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import { CatalogClient } from './catalog-client.service';
import { printedNameOrNull } from './source-entry-name';

/**
 * A group of shops a source prices together, as the source names it (plan 0103,
 * section 2.2).
 *
 * The key is the source's own, never a uuid of ours (D3). That is what makes a
 * run idempotent across weeks and a document portable between clusters: an id
 * does not survive a move to another deployment, and `PriceScope.externalKey`
 * does.
 */
export interface ScopeDeclaration {
  /** The source's own key for the group of shops that pays one price. */
  key: string;
  kind: PriceScopeKind;
  /** What the source calls it, for a scope the orchestrator has to create. */
  name: string | null;
}

/**
 * Turns the scopes a run declared into the scopes catalog holds, creating what
 * is missing (plan 0103, section 3).
 *
 * **Scope creation lives here and nowhere else.** It used to live in
 * `LidlCatalogRunner` and again in `LidlStoreDiscoveryRunner`, which meant no
 * other runner could create one, the ingest could not create one at all, and a
 * file import could not create one even when the file described the regions. A
 * runner now declares what the source named and holds nothing that could write
 * it.
 *
 * **A scope is created only from a declaration** (D4). The resolver never
 * invents one from a price: a scope with no kind and no name is a row an
 * operator cannot act on, so a price naming a key nothing declared is a warning
 * and no row instead.
 *
 * One resolver per run. It pages the chain's existing scopes on first use and
 * caches every answer by key, so a walk that declares 59 regions across 4,000
 * products asks catalog once rather than 4,000 times.
 */
@Injectable()
export class PriceScopeResolver {
  constructor(private readonly catalog: CatalogClient) {}

  /**
   * A resolver scoped to one chain, for the length of one run.
   *
   * `adapterKey` is here for one reason: a scope the run has to create is named
   * with the source's own string, and that string belongs to the language the
   * source prints in (plan 0111, section 8).
   */
  forRun(supermarketId: string, adapterKey: string | null): RunScopeResolver {
    return new RunScopeResolver(this.catalog, supermarketId, adapterKey);
  }
}

/** What a run resolves its own declarations through. */
export class RunScopeResolver {
  /** The chain's scopes by external key, paged once on first use. */
  private held: Map<string, string> | null = null;
  /** Every key this run has answered, including the ones it created. */
  private readonly resolved = new Map<string, string>();
  /** The keys this run created, for the run's report. */
  private readonly created = new Set<string>();

  constructor(
    private readonly catalog: CatalogClient,
    private readonly supermarketId: string,
    private readonly adapterKey: string | null
  ) {}

  /**
   * The scope this declaration names, created if catalog does not hold it.
   *
   * Declaring the same key twice is free and answers the same scope: a run
   * declares a region once per product that is priced for it, which is once per
   * product rather than once per run.
   */
  async declare(declaration: ScopeDeclaration): Promise<string> {
    const cached = this.resolved.get(declaration.key);
    if (cached) {
      return cached;
    }

    const held = await this.load();
    const existing = held.get(declaration.key);
    if (existing) {
      this.resolved.set(declaration.key, existing);
      return existing;
    }

    // The source's own name for the group, written once under the language
    // that source prints in (plan 0111, section 8). It used to be written into
    // both keys, which made a copy indistinguishable from a translation and
    // reported a coverage that was a duplicate.
    //
    // A source that prints no language this build can name leaves the scope
    // unnamed rather than filing its string under a guessed key. The scope
    // still exists and still prices its shops: the name is what an operator
    // reads, and `null` is already what a declaration with no name produces.
    const scope = await this.catalog.createPriceScope(
      this.supermarketId,
      declaration.kind,
      declaration.key,
      printedNameOrNull(declaration.name, this.adapterKey)
    );
    held.set(declaration.key, scope.id);
    this.resolved.set(declaration.key, scope.id);
    this.created.add(declaration.key);
    return scope.id;
  }

  /**
   * The scope a key resolves to, or null when nothing declared it.
   *
   * Synchronous and side effect free, because this is what the ingest asks on
   * every price of every product. A key it has not been told about answers null
   * rather than reaching for catalog: resolving a scope is the orchestrator's
   * act, and a price is not a declaration (D4).
   */
  idFor = (key: string): string | null => this.resolved.get(key) ?? null;

  /** Whether this run had to create the scope for a key it declared. */
  wasCreated(key: string): boolean {
    return this.created.has(key);
  }

  /** How many scopes this run created, for the run's report. */
  get createdCount(): number {
    return this.created.size;
  }

  /** Every key this run resolved, in the order it first declared them. */
  get keys(): string[] {
    return [...this.resolved.keys()];
  }

  private async load(): Promise<Map<string, string>> {
    if (this.held) {
      return this.held;
    }
    const held = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const page = await this.catalog.listPriceScopes(
        this.supermarketId,
        cursor
      );
      for (const scope of page.items) {
        if (scope.externalKey) {
          held.set(scope.externalKey, scope.id);
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    this.held = held;
    return held;
  }
}
