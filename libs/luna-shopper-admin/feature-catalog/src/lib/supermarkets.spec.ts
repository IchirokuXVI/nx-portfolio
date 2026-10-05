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
  provideSections,
  sectionLink,
  sectionScreens,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  draftFor,
  fieldOf,
  isEditable,
  toInput,
  type FieldName,
} from '@portfolio/luna-shopper-admin/models';
import { FieldControl } from '@portfolio/luna-shopper-admin/ui';
import { CHAIN_RESOURCES, chainsRoutes } from './chains/chains-routes';
import { SupermarketFormPage } from './supermarket-form-page';
import { SUPERMARKETS, type Supermarket } from './supermarkets';
import { SUPERMARKET_SEED } from './supermarkets-seed';

/**
 * The exit criterion of plan 0004, asserted rather than claimed, as it stands
 * after admin plan 0042.
 *
 * Supermarkets was the simplest entity: a flat list and the generic form, with
 * no component of its own. A chain is a page now, and its list is the column
 * beside that page, so what is asserted is that the same descriptor still
 * drives both: the generic list draws the column, and the generic form draws
 * the Details tab and the page of a new chain.
 *
 * Everything below runs against the in-memory gateway, which is the default
 * behind `RESOURCE_GATEWAYS`, so there is no backend and no `HttpClient`
 * anywhere in this file.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/** The Chains section, as the app declares it. */
const CHAINS: AdminSection = {
  key: 'chains',
  label: '',
  held: CHAIN_RESOURCES,
  screens: chainsRoutes(),
};

async function boot(url: string): Promise<ComponentFixture<TestHost>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([CHAINS])),
      provideLocationMocks(),
      provideSections(CHAINS),
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
  const rowsOf = (fixture: ComponentFixture<TestHost>) =>
    [...fixture.nativeElement.querySelectorAll('[data-row]')] as HTMLElement[];

  /** The form's text boxes, by what they hold. */
  const typed = (fixture: ComponentFixture<TestHost>) =>
    (
      [
        ...fixture.nativeElement.querySelectorAll('input[type="text"]'),
      ] as HTMLInputElement[]
    ).map((input) => input.value);

  it('lists the chains, with the generic list as a column', async () => {
    const fixture = await boot('/chains');

    expect(rowsOf(fixture)).toHaveLength(SUPERMARKET_SEED.length);
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(text(fixture)).toContain('Mercadona');
    expect(text(fixture)).toContain('Carrefour Express');
  });

  /**
   * In the column a chain is its name and the shops it holds (admin plan 0042,
   * section 2). The count is the one catalog gave on the read.
   */
  it('shows how many shops each chain holds, as the gateway counted them', async () => {
    const fixture = await boot('/chains');

    const trailing = (name: string) =>
      rowsOf(fixture)
        .find((row) => row.querySelector('.row-heading')?.textContent === name)
        ?.querySelector('.row-trailing')
        ?.textContent?.trim();

    expect(trailing('Mercadona')).toBe('3');
    expect(trailing('Consum')).toBe('1');
  });

  /**
   * The brand key was a column of the flat list. A column of names has no room
   * for it, so it is read where the chain is open: on its Details tab.
   */
  it('shows the brand key that tells two lookalike chains apart', async () => {
    const carrefour = await boot('/chains/sm_carrefour/details');
    expect(typed(carrefour)).toContain('Q217599');

    const express = await boot('/chains/sm_carrefour_express/details');
    expect(typed(express)).toContain('Q2940602');
  });

  /**
   * The section has no home and no tab of its own, so its entry on the rail
   * opens the one resource it holds that has no parent. It used to be the
   * empty path that landed on the one resource there was.
   */
  it('opens the section on the chains, which every other resource is under', () => {
    expect(sectionLink(CHAINS)).toBe('/chains');
    // None of the five is a flat list with a link of its own.
    expect(sectionScreens(CHAINS)).toEqual([]);
  });

  it('opens a chain from the column, on its shops', async () => {
    const fixture = await boot('/chains');

    rowsOf(fixture)
      .find((row) => row.textContent?.includes('Mercadona'))
      ?.click();
    await settle(fixture);
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe('/chains/sm_mercadona/shops');
  });

  it('answers an address that is not a screen without losing the chrome', async () => {
    const fixture = await boot('/supermarkets-of-mars');

    expect(text(fixture)).toContain('notFound.heading');
    // The rail is still there: the way to the account, and through it the
    // way out, is one of its two buttons (admin plan 0041).
    expect(
      fixture.nativeElement.querySelector('[data-menu="account"]')
    ).not.toBeNull();
  });

  it('opens one chain on a form built from the descriptor', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');
    const form = fixture.debugElement.query(By.directive(SupermarketFormPage))
      .nativeElement as HTMLElement;

    // One box per content locale for the name, plus the two url fields and the
    // brand key. The default scope is a picker, so the id and the shop count
    // are what is shown and not edited.
    expect(typed(fixture)).toEqual(
      expect.arrayContaining([
        'Mercadona',
        'https://www.mercadona.es',
        'Q1888874',
      ])
    );
    expect(form.querySelectorAll('.readonly')).toHaveLength(2);
    expect(form.querySelector('lib-reference-picker')).not.toBeNull();
  });

  /** Admin plan 0034, section 2: the picker reads this chain's scopes only. */
  it('offers the default scope as a picker over this chain', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');

    const control = fixture.debugElement
      .queryAll(By.directive(FieldControl))
      .map((node) => node.componentInstance as FieldControl)
      .find((found) => found.field().name === 'defaultPriceScopeId');

    expect(control?.scopeOf()).toEqual({ supermarketId: 'sm_mercadona' });
  });

  /**
   * A chain with no default scope is a gap to fix, and chains made before
   * backend plan 0153 have none. The flat list flagged each one in a column.
   * The column of names has no such cell, so the gap is read on the chain's
   * Price scopes tab, where one scope is made the default: `chain-page.spec.ts`
   * asserts that. What stays here is that the field still says what an unset
   * default reads as, for any list that draws the column.
   */
  it('still names what a chain with no default scope reads as', () => {
    const field = fieldOf(SUPERMARKETS, 'defaultPriceScopeId');
    const without = SUPERMARKET_SEED.filter(
      (chain) => chain.defaultPriceScopeId === null
    );

    expect(without.length).toBeGreaterThan(0);
    expect(without.length).toBeLessThan(SUPERMARKET_SEED.length);
    expect(field?.kind === 'reference' ? field.unsetFlag : null).toBe(
      'catalog.supermarkets.noDefaultScope'
    );
  });

  it('offers a create form at `new` rather than reading a row called new', async () => {
    const fixture = await boot('/chains/new');

    expect(
      fixture.debugElement.query(By.directive(SupermarketFormPage))
    ).not.toBeNull();
    expect(text(fixture)).toContain('resource.form.create');
    expect(text(fixture)).not.toContain('resource.error.notFound');
  });

  /** Admin plan 0042, target 8: a new chain opens the page it was made as. */
  it('opens the chain that was made, and stays on the tab after a change', async () => {
    const created = await boot('/chains/new');
    const page = created.debugElement.query(By.directive(SupermarketFormPage))
      .componentInstance as SupermarketFormPage;

    page.change({ name: 'name', value: { en: 'Deza', es: 'Deza' } });
    await page.submit();
    await settle(created);
    await settle(created);

    expect(TestBed.inject(Router).url).toMatch(/^\/chains\/[^/]+\/shops$/);
    expect(TestBed.inject(Router).url).not.toBe('/chains/new/shops');

    const changed = await boot('/chains/sm_mercadona/details');
    const tab = changed.debugElement.query(By.directive(SupermarketFormPage))
      .componentInstance as SupermarketFormPage;

    tab.change({ name: 'externalBrandKey', value: 'Q0' });
    await tab.submit();
    await settle(changed);

    expect(TestBed.inject(Router).url).toBe('/chains/sm_mercadona/details');
    expect(text(changed)).toContain('resource.form.saved');
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
      // Counted by catalog on the read, and never typed (admin plan 0042).
      'locationCount',
    ]);
    const count = fieldOf(SUPERMARKETS, 'locationCount');
    expect(count === undefined ? null : isEditable(count, 'edit')).toBe(false);
    expect(SUPERMARKETS.actions).toEqual({
      create: true,
      edit: true,
      delete: true,
    });
  });
});
