import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  draftFor,
  fieldOf,
  isEditable,
  toInput,
  type FieldName,
} from '@portfolio/luna-shopper-admin/models';
import { FieldControl } from '@portfolio/luna-shopper-admin/ui';
import { PRICE_SCOPES } from './price-scopes';
import { SUPERMARKETS, type Supermarket } from './supermarkets';
import { SUPERMARKET_SEED } from './supermarkets-seed';

/**
 * The exit criterion of plan 0004, asserted rather than claimed.
 *
 * Supermarkets is the simplest entity, and it works end to end through the
 * generic list and the generic form with no component of its own. Everything
 * below runs against the in-memory gateway, which is the default behind
 * `RESOURCE_GATEWAYS`, so there is no backend and no `HttpClient` anywhere in
 * this file.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

async function boot(url: string): Promise<ComponentFixture<TestHost>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(
        adminRoutes([
          {
            key: 'catalog',
            label: '',
            resources: [SUPERMARKETS, PRICE_SCOPES],
          },
        ])
      ),
      provideLocationMocks(),
      provideResources(SUPERMARKETS, PRICE_SCOPES),
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);

  return fixture;
}

/**
 * Lets the store's read settle, then redraws.
 *
 * A macrotask rather than a handful of `Promise.resolve()`s, because the read
 * goes through several awaits and counting them would make this spec depend on
 * how many. `whenStable` is not an option in a zoneless spec: it hangs.
 */
async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

describe('the supermarkets descriptor', () => {
  it('names a real field for every column', () => {
    const missing = SUPERMARKETS.list.columns.filter(
      (name) => fieldOf(SUPERMARKETS, name) === undefined
    );

    expect(missing).toEqual([]);
  });

  /**
   * The compact list is what survives to a phone, so it has to be a subset of
   * what the table shows. A card column that is not a table column would appear
   * only on a phone, which is nobody's intention.
   */
  it('draws its phone columns from its table columns', () => {
    const columns = new Set<string>(SUPERMARKETS.list.columns);
    const stray = SUPERMARKETS.list.compact.filter(
      (name) => !columns.has(name)
    );

    expect(stray).toEqual([]);
    expect(SUPERMARKETS.list.compact.length).toBeLessThan(
      SUPERMARKETS.list.columns.length
    );
  });

  /**
   * The filter is what makes a reference picker over chains work. Without one,
   * `ResourceReferences.search` has no parameter to put the operator's term in,
   * so it drops the term and asks for the first page: the picker then answers
   * every search with the same twenty chains.
   */
  it('offers the search its reference picker needs', () => {
    const search = (SUPERMARKETS.filters ?? []).find(
      (filter) => filter.kind === 'search'
    );

    expect(search?.param).toBe('query');
  });

  /**
   * Admin plan 0034, section 2; backend plan 0153. `UpdateSupermarketDto`
   * takes a default scope and `CreateSupermarketDto` does not, because a new
   * chain's national scope becomes its default in the same write.
   */
  it('offers the default price scope on an existing chain only', () => {
    const field = fieldOf(SUPERMARKETS, 'defaultPriceScopeId');

    expect(field).toBeDefined();
    expect(field === undefined ? null : isEditable(field, 'create')).toBe(
      false
    );
    expect(field === undefined ? null : isEditable(field, 'edit')).toBe(true);
  });

  it('never sends a default scope when creating a chain', () => {
    const draft = draftFor(SUPERMARKETS, null, 'create');
    const input = toInput(
      SUPERMARKETS,
      { ...draft, name: { en: 'Deza', es: 'Deza' } },
      'create',
      draft
    );

    expect(input).not.toHaveProperty('defaultPriceScopeId');
  });

  /** The gateway refuses a scope of another chain, so none is offered. */
  it('limits the scope picker to the chain being edited', () => {
    const field = fieldOf(SUPERMARKETS, 'defaultPriceScopeId');
    const scopeFrom = field?.kind === 'reference' ? field.scopeFrom : undefined;

    expect(scopeFrom?.({ id: 'sm_mercadona' })).toEqual({
      supermarketId: 'sm_mercadona',
    });
    // A chain that does not exist yet has no scopes to offer.
    expect(scopeFrom?.({})).toBeNull();
  });

  it('calls a chain by its localized name', () => {
    expect(
      SUPERMARKETS.title(SUPERMARKET_SEED[0] as Supermarket, ['en', 'es'])
    ).toBe('Mercadona');
  });

  /** The reading order reaches the title (admin plan 0026, section 5). */
  it('calls a chain by the name in the language the operator reads', () => {
    const chain = {
      ...(SUPERMARKET_SEED[0] as Supermarket),
      name: { en: 'The Corner Shop', es: 'La Tienda' },
    };

    expect(SUPERMARKETS.title(chain, ['en', 'es'])).toBe('The Corner Shop');
    expect(SUPERMARKETS.title(chain, ['es', 'en'])).toBe('La Tienda');
  });

  it('offers only the orders the backend accepts', () => {
    expect(SUPERMARKETS.sorts?.map((sort) => sort.value)).toEqual([
      'name',
      'created',
      'updated',
    ]);
  });
});

describe('supermarkets through the generic machinery', () => {
  it('lists the chains, with no component of its own', async () => {
    const fixture = await boot('/supermarkets');

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(SUPERMARKET_SEED.length);
    expect(text(fixture)).toContain('Mercadona');
    expect(text(fixture)).toContain('Carrefour Express');
  });

  it('shows the brand key that tells two lookalike chains apart', async () => {
    const fixture = await boot('/supermarkets');

    expect(text(fixture)).toContain('Q217599');
    expect(text(fixture)).toContain('Q2940602');
  });

  it('lands the empty path on the one resource there is', async () => {
    await boot('/');

    expect(TestBed.inject(Router).url).toBe('/supermarkets');
  });

  it('answers an address that is not a screen without losing the chrome', async () => {
    const fixture = await boot('/supermarkets-of-mars');

    expect(text(fixture)).toContain('notFound.heading');
    expect(text(fixture)).toContain('shell.signOut');
  });

  it('opens one chain on a form built from the descriptor', async () => {
    const fixture = await boot('/supermarkets/sm_mercadona');

    // One box per content locale for the name, plus the two url fields and the
    // brand key. The default scope is a picker now, so only the id is shown
    // and not edited.
    const inputs = fixture.nativeElement.querySelectorAll('input[type="text"]');
    expect(inputs).toHaveLength(5);
    expect(fixture.nativeElement.querySelectorAll('.readonly')).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('lib-reference-picker')
    ).not.toBeNull();
  });

  /** Admin plan 0034, section 2: the picker reads this chain's scopes only. */
  it('offers the default scope as a picker over this chain', async () => {
    const fixture = await boot('/supermarkets/sm_mercadona');

    const control = fixture.debugElement
      .queryAll(By.directive(FieldControl))
      .map((node) => node.componentInstance as FieldControl)
      .find((found) => found.field().name === 'defaultPriceScopeId');

    expect(control?.scopeOf()).toEqual({ supermarketId: 'sm_mercadona' });
  });

  /**
   * A chain with no default scope is a gap to fix, and chains made before
   * backend plan 0153 have none. The list flags each one; a chain with a
   * default shows its scope instead.
   */
  it('flags every chain that has no default scope', async () => {
    const fixture = await boot('/supermarkets');

    const flags = fixture.nativeElement.querySelectorAll('tbody .flag');
    const without = SUPERMARKET_SEED.filter(
      (chain) => chain.defaultPriceScopeId === null
    );
    expect(without.length).toBeGreaterThan(0);
    expect(without.length).toBeLessThan(SUPERMARKET_SEED.length);
    expect(flags).toHaveLength(without.length);
    expect(flags[0].textContent).toContain(
      'catalog.supermarkets.noDefaultScope'
    );
  });

  it('offers a create form at `new` rather than reading a row called new', async () => {
    const fixture = await boot('/supermarkets/new');

    expect(text(fixture)).toContain('resource.form.create');
    expect(text(fixture)).not.toContain('resource.error.notFound');
  });

  /**
   * The plan's other exit criterion, stated as a property of this file: a second
   * entity is a second descriptor, and nothing in the list or the form knows the
   * word "supermarket".
   */
  it('is a descriptor and nothing else', () => {
    const names: FieldName<Supermarket>[] = SUPERMARKETS.fields.map(
      (field) => field.name as FieldName<Supermarket>
    );

    expect(names).toEqual([
      'id',
      'name',
      'websiteUrl',
      'logoUrl',
      'externalBrandKey',
      'defaultPriceScopeId',
    ]);
    expect(SUPERMARKETS.actions).toEqual({
      create: true,
      edit: true,
      delete: true,
    });
  });
});
