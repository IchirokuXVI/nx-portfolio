import { inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import {
  provideResources,
  ResourceReferences,
  ResourceRegistry,
} from './resource-registry';

interface Scope {
  id: string;
  label: string;
}

const scopes = defineResource<Scope>({
  name: 'price-scopes',
  segment: 'price-scopes',
  labels: { one: 'scopes.one', many: 'scopes.many' },
  title: (row) => row.label,
  fields: [{ kind: 'text', name: 'label', label: 'scopes.label' }],
  list: { columns: ['label'], compact: ['label'] },
  filters: [{ kind: 'search', param: 'query', label: 'scopes.search' }],
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Scope>({
      path: '/v1/admin/catalog/price-scopes',
      seed: [
        { id: 'ps_1', label: 'Catalonia' },
        { id: 'ps_2', label: 'Madrid' },
      ],
    }),
});

/**
 * The registry, and the reference lookup built on it (plan 0004, section 6).
 *
 * Everything runs against the in-memory gateways, which is the default behind
 * `RESOURCE_GATEWAYS`, so nothing here needs a backend or an `HttpClient`.
 */
describe('ResourceRegistry', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideResources(scopes)],
    });
  });

  it('finds a resource by the name a reference field points at', () => {
    expect(TestBed.inject(ResourceRegistry).byName('price-scopes')).toBe(
      scopes
    );
  });

  it('has nothing to say about a resource the app did not mount', () => {
    expect(TestBed.inject(ResourceRegistry).byName('items')).toBeUndefined();
  });

  /**
   * `descriptor.gateway()` calls `inject`, and the registry is asked for one
   * long after it was constructed. Without an injection context the call throws
   * rather than answering, which is the sort of failure that only shows up when
   * somebody opens a form.
   */
  it('builds a gateway outside the moment it was constructed in', async () => {
    const registry = TestBed.inject(ResourceRegistry);

    const page = await registry.gatewayFor(scopes).list({});

    expect(page.items).toHaveLength(2);
  });
});

describe('ResourceReferences', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideResources(scopes)],
    });
  });

  it('shows the target by name, not by id', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(references.resolve('price-scopes', 'ps_2')).resolves.toEqual({
      id: 'ps_2',
      title: 'Madrid',
    });
  });

  /**
   * A reference can outlive what it points at. The picker draws that state, so
   * it has to be a value rather than an exception.
   */
  it('answers nothing for an id that no longer exists', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(
      references.resolve('price-scopes', 'gone')
    ).resolves.toBeNull();
  });

  it('searches through the target resource own search filter', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(references.search('price-scopes', 'madr')).resolves.toEqual([
      { id: 'ps_2', title: 'Madrid' },
    ]);
  });

  /**
   * A picker that showed nothing until something was typed would hide the
   * answer from an operator who does not know what the options are called.
   */
  it('offers the first page when nothing has been typed', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(references.search('price-scopes', '')).resolves.toHaveLength(
      2
    );
  });

  it('finds nothing for a resource that does not exist, rather than throwing', async () => {
    const references = TestBed.inject(ResourceReferences);

    await expect(references.search('items', 'x')).resolves.toEqual([]);
    await expect(references.resolve('items', 'x')).resolves.toBeNull();
  });
});
