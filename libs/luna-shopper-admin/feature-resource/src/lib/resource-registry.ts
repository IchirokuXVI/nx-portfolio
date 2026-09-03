import {
  inject,
  Injectable,
  InjectionToken,
  Injector,
  runInInjectionContext,
  type Provider,
} from '@angular/core';
import {
  idOf,
  unansweredFilters,
  type AnyResourceDescriptor,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import type {
  ReferenceContext,
  ReferenceLookup,
  ReferenceOption,
} from '@portfolio/luna-shopper-admin/ui';

/**
 * Every resource this app knows about.
 *
 * The list is the app's, because it is the app that decides which screens
 * exist. A routed library that declared its own would make adding a resource a
 * change in two places, and a reference field pointing at a resource the app did
 * not mount would be a picker that finds nothing with nothing to say about why.
 */
export const RESOURCE_DESCRIPTORS = new InjectionToken<
  readonly AnyResourceDescriptor[]
>('RESOURCE_DESCRIPTORS', { providedIn: 'root', factory: () => [] });

/** Name the resources this app has. */
export function provideResources(
  ...descriptors: readonly AnyResourceDescriptor[]
): Provider {
  return { provide: RESOURCE_DESCRIPTORS, useValue: descriptors };
}

/**
 * Finding a descriptor, and building the gateway it names.
 *
 * `descriptor.gateway()` calls `inject`, so it has to run in an injection
 * context. A component calling it in a field initializer is already in one; this
 * service is not, because it is asked for a gateway long after it was
 * constructed, so it keeps an `Injector` and runs the factory inside it.
 */
@Injectable({ providedIn: 'root' })
export class ResourceRegistry {
  private readonly _descriptors = inject(RESOURCE_DESCRIPTORS);
  private readonly _injector = inject(Injector);

  /** Every resource, in the order the app named them. */
  all(): readonly AnyResourceDescriptor[] {
    return this._descriptors;
  }

  /** The resource with this name, or `undefined`. */
  byName(name: string): AnyResourceDescriptor | undefined {
    return this._descriptors.find((descriptor) => descriptor.name === name);
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

  async search(
    resource: string,
    term: string,
    context: ReferenceContext = {}
  ): Promise<readonly ReferenceOption[]> {
    const descriptor = this._registry.byName(resource);
    if (descriptor === undefined) {
      return [];
    }

    const declared = descriptor.filters ?? [];

    // Only the parameters the target really has. A caller passes whatever it
    // knows, and a name this resource does not declare would be sent verbatim
    // to a gateway that validates its query with `forbidNonWhitelisted`.
    const known = new Set(declared.map((filter) => filter.param));
    const filters: Record<string, string> = {};
    for (const [param, value] of Object.entries(context)) {
      if (known.has(param) && value !== '') {
        filters[param] = value;
      }
    }

    // A search this resource cannot answer without a parent it has not been
    // given. The screen has already disabled the control and said what is
    // missing; sending a request that could only be a 400 would find that out
    // a second time and more slowly.
    if (unansweredFilters(declared, filters).length > 0) {
      return [];
    }

    const search = declared.find((filter) => filter.kind === 'search');
    if (search !== undefined && term.trim() !== '') {
      filters[search.param] = term.trim();
    }

    const page = await this._registry
      .gatewayFor(descriptor)
      .list({ filters, limit: PICKER_PAGE_SIZE });

    return page.items.map((row) => ({
      id: idOf(descriptor, row),
      title: descriptor.title(row),
    }));
  }

  async resolve(resource: string, id: string): Promise<ReferenceOption | null> {
    const descriptor = this._registry.byName(resource);
    if (descriptor === undefined) {
      return null;
    }

    try {
      const row = await this._registry.gatewayFor(descriptor).read(id);
      return { id: idOf(descriptor, row), title: descriptor.title(row) };
    } catch {
      // A reference can outlive what it points at. That is a state the picker
      // draws rather than a failure, so it is `null` here and a sentence there.
      return null;
    }
  }
}
