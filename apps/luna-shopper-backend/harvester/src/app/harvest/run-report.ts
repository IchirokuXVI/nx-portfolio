import type { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import type { ScopeDeclaration } from './price-scope-resolver';
import type { SourceObservation } from './source-ingest';

export type { ScopeDeclaration } from './price-scope-resolver';

/**
 * A shop a source named (plan 0103, section 2.2).
 *
 * Every field is what the source said. **The postal code is the source's or it
 * is absent**, and an absent one is derived by the orchestrator from the
 * coordinates, which is the only thing a runner ever knew about it anyway. A
 * derived code is never a source code, because a wrong postcode puts the shop in
 * somebody else's list (plan 0097, section 3).
 */
export interface ObservedPlace {
  /** Who found the place: `OSM` for a radius search, the chain for its own list. */
  provider: string;
  /** The source's own reference for this shop, stable across runs. */
  externalRef: string;
  brandKey: string | null;
  brandName: string | null;
  /** What the source called it. Some OpenStreetMap nodes are unnamed. */
  name: string | null;
  latitude: number;
  longitude: number;
  street: string | null;
  city: string | null;
  /** As the source stated it. Null asks the orchestrator to derive one. */
  postalCode: string | null;
  postalCodeSource: PostalCodeSource | null;
  country: string;
  website: string | null;
  openingHours: string | null;
  /**
   * The source's own fields, kept whole and unreshaped, so what an admin reads
   * on the row is what the source said (plan 0038, section 8.2).
   */
  tags: Record<string, string>;
  /**
   * The group of shops this one is priced with, by the key a
   * {@link RunReport.scope} declaration named (plan 0107, section 3.3).
   *
   * It is the source's own key and never a uuid of ours, like every other scope
   * key. Only the trusted import reads it, to put a shop it creates in the
   * scope the chain said prices it; a place that reaches the review queue is
   * scoped by the admin importing it.
   *
   * Absent or null means the source declared no group for this shop, and the
   * location then takes the `STORE` scope catalog gives any location that names
   * none. A radius search always answers null: OpenStreetMap knows nothing
   * about what a shop charges.
   */
  scopeKey?: string | null;
}

/**
 * What a source said about stock, for one product.
 *
 * Either a shop of the source's own, named by its code, or a group of shops
 * named by a scope key. A claim naming neither belongs to the run's default
 * scope, which is what a walk of one warehouse states.
 */
export interface AvailabilityClaim {
  /** The product, by the `externalId` the observation carried. */
  externalId: string;
  available: boolean;
  /** The source's own code for one shop, e.g. `T1`. */
  shopCode?: string | null;
  /** What the source calls this shop, so an unmapped one reads in the queue. */
  shopName?: string | null;
  /** A group of shops, by the key a declaration named. */
  scopeKey?: string | null;
}

/**
 * What a runner has to say about the world, and the whole of what it can do
 * with it (plan 0103, section 2.2).
 *
 * **Every method is synchronous and returns nothing.** A runner cannot await a
 * write, cannot read a result back and cannot learn what the orchestrator
 * decided. That is D1, and it is deliberate: an outcome a runner can read is an
 * outcome a runner starts branching on, and the branch belongs to the
 * orchestrator.
 *
 * This is a second object rather than more methods on `RunContext`, and D2 is
 * why. The context is the run describing itself, which is progress, stage,
 * warnings and abort. This is data about the world. One object with both is one
 * property away from being a handle on the store again.
 */
export interface RunReport {
  /**
   * A price scope the source names.
   *
   * Declared before any price refers to it. A price naming a key nothing
   * declared is a warning and no row, because a scope with no kind and no name
   * is a row an operator cannot act on (D4).
   */
  scope(declaration: ScopeDeclaration): void;

  /** One product as the source described it, with a price per scope it stated. */
  product(observation: SourceObservation): void;

  /** A shop the source named, for a store discovery run or for availability. */
  place(place: ObservedPlace): void;

  /** What the source said about stock, by scope or by the source's shop code. */
  availability(claim: AvailabilityClaim): void;

  /**
   * The run walked the whole assortment of this scope, so a tracked product it
   * did not name is not stocked.
   *
   * **An aborted run declares nothing**, so it writes positives only: a walk
   * that stopped early has not proved anything absent. The runner is what knows
   * whether it finished, so the runner is what says this.
   */
  assortmentComplete(scopeKey: string | null): void;
}

/**
 * A report that keeps everything, for a spec.
 *
 * A runner spec constructs the runner with a fake fetch and one of these, then
 * asserts on what was reported. It needs no `TestingModule`, no repository fake
 * and no `CatalogClient` fake, which is the visible proof of the rule this plan
 * is about (plan 0103, section 9).
 */
export class RecordingRunReport implements RunReport {
  readonly scopes: ScopeDeclaration[] = [];
  readonly products: SourceObservation[] = [];
  readonly places: ObservedPlace[] = [];
  readonly availabilities: AvailabilityClaim[] = [];
  readonly completed: (string | null)[] = [];

  scope(declaration: ScopeDeclaration): void {
    this.scopes.push(declaration);
  }

  product(observation: SourceObservation): void {
    this.products.push(observation);
  }

  place(place: ObservedPlace): void {
    this.places.push(place);
  }

  availability(claim: AvailabilityClaim): void {
    this.availabilities.push(claim);
  }

  assortmentComplete(scopeKey: string | null): void {
    this.completed.push(scopeKey);
  }
}
