import {
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import type { ActivatedRouteSnapshot } from '@angular/router';
import {
  ContentLocaleStore,
  readRecordById,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  idOf,
  recordIdFor,
  type AnyResourceDescriptor,
  type ErrorLink,
  type ErrorLinkTarget,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import type {
  ReferenceLookup,
  ReferenceOption,
  ReferenceScope,
} from '@portfolio/luna-shopper-admin/ui';
import { ADMIN_SECTIONS } from './admin-section';
import { routeParam } from './resource-route-data';

/**
 * Finding a descriptor, working out where it is mounted, and building the
 * gateway it names.
 *
 * Read from {@link ADMIN_SECTIONS}, which is the same list the route table is
 * built from, so a resource the app mounted is a resource this can find and a
 * path this answers is a path that exists. It used to be read from a second
 * list of descriptors beside the sections, and `POSTAL_CODES` is what that cost:
 * mounted by `harvestRoutes` and registered nowhere, so a reference field
 * pointing at it would have found nothing (admin plan 0022, section 2).
 *
 * `descriptor.gateway()` calls `inject`, so it has to run in an injection
 * context. A component calling it in a field initializer is already in one; this
 * service is not, because it is asked for a gateway long after it was
 * constructed, so it keeps an `Injector` and runs the factory inside it.
 */
/**
 * The ids of the rows above a resource, by the name of each parent's filter.
 *
 * Loosely typed on purpose, so that a row read off the gateway can be handed
 * over whole: only the string values under the names a `parent` declares are
 * ever read.
 */
export type KnownParents = Readonly<Record<string, unknown>>;

/**
 * The parents the address names, for a resource and everything above it.
 *
 * `{ supermarketId, supermarketLocationId }` on the products tab of a shop:
 * each `parent` up the chain names a route parameter, and the closest route
 * that holds it answers. It is what {@link ResourceRegistry.pathOf} wants as
 * `known`, read from where the screen already is.
 */
export function parentsFromRoute(
  registry: ResourceRegistry,
  descriptor: AnyResourceDescriptor,
  route: ActivatedRouteSnapshot
): Record<string, string> {
  const known: Record<string, string> = {};
  let current: AnyResourceDescriptor | undefined = descriptor;

  while (current?.parent !== undefined) {
    const { param, filter, resource } = current.parent;
    const value = routeParam(route, param);

    if (value !== null) {
      known[filter] = value;
    }
    current = registry.byName(resource);
  }

  return known;
}

@Injectable({ providedIn: 'root' })
export class ResourceRegistry {
  private readonly _sections = inject(ADMIN_SECTIONS);
  private readonly _injector = inject(Injector);

  /** Every resource, section by section, in the order the app named them. */
  all(): readonly AnyResourceDescriptor[] {
    return this._sections.flatMap((section) => [
      ...(section.resources ?? []),
      ...(section.held ?? []),
    ]);
  }

  /** The resource with this name, or `undefined`. */
  byName(name: string): AnyResourceDescriptor | undefined {
    return this.all().find((descriptor) => descriptor.name === name);
  }

  /**
   * Where a resource's list lives, as a router link array.
   *
   * `['/', 'catalog', 'items']` for `items`, and `null` for a resource this app
   * did not mount. Everything that used to build such a path out of
   * `descriptor.segment` asks this instead: a segment says what a resource
   * calls itself and says nothing at all about which section holds it.
   *
   * **A resource under a parent is listed under one row of that parent**
   * (admin plan 0042), so its list has an address only once that row is
   * known: `['/', 'chains', '<chain>', 'shops']`. `known` is where the caller
   * says so, by the name of the parent's filter (`supermarketId`). A row of
   * the resource itself, or of anything that carries the same ids, can be
   * passed as it is.
   *
   * Without the parent's id the answer is the closest list that does have an
   * address: `/chains` for the shops of a chain nobody named. A tile that
   * counts every shop therefore still leads somewhere, to the place the
   * operator picks the chain.
   */
  pathOf(name: string, known: KnownParents = {}): readonly string[] | null {
    const descriptor = this.byName(name);
    if (descriptor === undefined) {
      return null;
    }

    const parent = descriptor.parent;
    if (parent === undefined) {
      return this._mounted(descriptor);
    }

    const id = known[parent.filter];
    const above =
      typeof id === 'string' && id !== ''
        ? this.rowPath(parent.resource, id, known)
        : null;

    return above === null
      ? this.pathOf(parent.resource, known)
      : [...above, descriptor.segment];
  }

  /**
   * Where one row lives, or `null` when it has no address that can be built.
   *
   * Stricter than {@link pathOf}: a list can fall back to the list above it,
   * and a row cannot, because the list above is not the row. A shop whose
   * chain is unknown gets no link, and a name without a link is still an
   * answer.
   */
  rowPath(
    name: string,
    id: string,
    known: KnownParents = {}
  ): readonly string[] | null {
    const descriptor = this.byName(name);
    if (descriptor === undefined) {
      return null;
    }

    const parent = descriptor.parent;
    if (parent === undefined) {
      const list = this._mounted(descriptor);
      return list === null ? null : [...list, id];
    }

    const parentId = known[parent.filter];
    if (typeof parentId !== 'string' || parentId === '') {
      return null;
    }

    const above = this.rowPath(parent.resource, parentId, known);
    return above === null ? null : [...above, descriptor.segment, id];
  }

  /**
   * Where a refusal's link goes, or `null` when the resource is not mounted.
   *
   * A row of the target, or its list narrowed by {@link ErrorLink.filter}
   * when the link names one: a category that still holds products opens its
   * products (admin plan 0036).
   */
  linkFor(
    link: ErrorLink,
    id: string,
    known: KnownParents = {}
  ): ErrorLinkTarget | null {
    // The least a link can say, for a resource that did not name its own
    // words. Every one that does reads better than this.
    const labelKey = link.label ?? 'resource.error.openRow';

    if (link.filter === undefined) {
      const row = this.rowPath(link.resource, id, known);
      return row === null ? null : { commands: [...row], labelKey };
    }

    const path = this.pathOf(link.resource, known);
    return path === null
      ? null
      : { commands: [...path], queryParams: { [link.filter]: id }, labelKey };
  }

  /** Where the section that names a resource mounts it, before any parent. */
  private _mounted(
    descriptor: AnyResourceDescriptor
  ): readonly string[] | null {
    for (const section of this._sections) {
      const named = [...(section.resources ?? []), ...(section.held ?? [])];

      if (named.includes(descriptor)) {
        // A resource with no segment of its own is at its section's address
        // (admin plan 0043): the products are at `/products`.
        return [
          '/',
          ...[
            section.segment,
            // A resource held under a tab of its section (admin plan 0044).
            (section.held ?? []).includes(descriptor)
              ? section.heldUnder
              : undefined,
            descriptor.segment,
          ].filter(
            (segment): segment is string =>
              segment !== undefined && segment !== ''
          ),
        ];
      }
    }

    return null;
  }

  /** The gateway for a resource, built in an injection context. */
  gatewayFor(descriptor: AnyResourceDescriptor): ResourceGateway<ResourceRow> {
    return runInInjectionContext(this._injector, () => descriptor.gateway());
  }
}

/** How many rows a picker offers at once. */
const PICKER_PAGE_SIZE = 20;

/**
 * The reference picker's questions, answered from the registry (plan 0004,
 * section 6).
 *
 * A reference field names the resource it points at, and everything else follows
 * from that resource's own descriptor: its search filter, its gateway, and what
 * it calls a row. So a picker for a resource that does not exist yet costs
 * nothing to write, and adding that resource makes every picker pointing at it
 * work with no further change.
 */
@Injectable({ providedIn: 'root' })
export class ResourceReferences implements ReferenceLookup {
  private readonly _registry = inject(ResourceRegistry);

  /**
   * The operator's reading order, for the names this answers with (admin plan
   * 0026, section 5).
   *
   * A picker is one of the three places a descriptor's `title` is called, and
   * the only one that is a service rather than a screen. The order is read per
   * call rather than kept, so a picker opened after a switch offers the names
   * in the language the operator is reading now.
   */
  private readonly _content = inject(ContentLocaleStore);

  /**
   * The rows of `resource` a picker offers, narrowed by what was typed and by
   * what the screen already decided.
   *
   * **A target that declares no `search` filter silently ignores the term.**
   * There is nowhere to put it, so the first page comes back for every search
   * and a row past the page size cannot be reached by typing its name at all.
   * That is a gap in the descriptor rather than in the picker, and it is why
   * admin plan 0011 gives `LOCATIONS` one.
   *
   * The scope goes in whatever the term does, because it is what addresses the
   * collection rather than what narrows it: a picker over one chain's shops
   * reads nothing at all without its chain, typed term or not.
   */
  async search(
    resource: string,
    term: string,
    scope: ReferenceScope = {}
  ): Promise<readonly ReferenceOption[]> {
    const descriptor = this._registry.byName(resource);
    if (descriptor === undefined) {
      return [];
    }

    // A typed ID is the record that has it, on this resource and within the
    // scope, or nothing (admin plan 0051). No filter is sent: an ID is not a
    // word a name could match.
    const id = recordIdFor(descriptor, term);
    if (id !== null) {
      const row = await readRecordById(
        descriptor,
        this._registry.gatewayFor(descriptor),
        id,
        scope
      );
      return row === null ? [] : [this._option(descriptor, row)];
    }

    const search = descriptor.filters?.find(
      (filter) => filter.kind === 'search'
    );
    const filters =
      search === undefined || term.trim() === ''
        ? { ...scope }
        : { ...scope, [search.param]: term.trim() };

    const page = await this._registry
      .gatewayFor(descriptor)
      .list({ filters, limit: PICKER_PAGE_SIZE });

    return page.items.map((row) => ({
      id: idOf(descriptor, row),
      title: descriptor.title(row, this._content.order()),
    }));
  }

  async resolve(resource: string, id: string): Promise<ReferenceOption | null> {
    const descriptor = this._registry.byName(resource);
    if (descriptor === undefined) {
      return null;
    }

    try {
      const row = await this._registry.gatewayFor(descriptor).read(id);
      // The row rides along, because a `references` field asks its
      // descriptor whether a target is locked, and that is a question about
      // the target's own columns (admin plan 0028, section 4.1).
      return {
        id: idOf(descriptor, row),
        title: descriptor.title(row, this._content.order()),
        row,
      };
    } catch {
      // A reference can outlive what it points at. That is a state the picker
      // draws rather than a failure, so it is `null` here and a sentence there.
      return null;
    }
  }

  /** What one row of a resource is called, for "No product has this ID." */
  nounOf(resource: string): string | null {
    return this._registry.byName(resource)?.labels.one ?? null;
  }

  private _option(
    descriptor: AnyResourceDescriptor,
    row: ResourceRow
  ): ReferenceOption {
    return {
      id: idOf(descriptor, row),
      title: descriptor.title(row, this._content.order()),
      row,
    };
  }
}
