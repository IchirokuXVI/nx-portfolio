import {
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import {
  idOf,
  type AnyResourceDescriptor,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import type {
  ReferenceLookup,
  ReferenceOption,
  ReferenceScope,
} from '@portfolio/luna-shopper-admin/ui';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import { ADMIN_SECTIONS } from './admin-section';

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
@Injectable({ providedIn: 'root' })
export class ResourceRegistry {
  private readonly _sections = inject(ADMIN_SECTIONS);
  private readonly _injector = inject(Injector);

  /** Every resource, section by section, in the order the app named them. */
  all(): readonly AnyResourceDescriptor[] {
    return this._sections.flatMap((section) => section.resources ?? []);
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
   */
  pathOf(name: string): readonly string[] | null {
    for (const section of this._sections) {
      const found = (section.resources ?? []).find(
        (descriptor) => descriptor.name === name
      );

      if (found !== undefined) {
        return section.segment === undefined
          ? ['/', found.segment]
          : ['/', section.segment, found.segment];
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
      return {
        id: idOf(descriptor, row),
        title: descriptor.title(row, this._content.order()),
      };
    } catch {
      // A reference can outlive what it points at. That is a state the picker
      // draws rather than a failure, so it is `null` here and a sentence there.
      return null;
    }
  }
}
