import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  RESOURCE_GATEWAYS,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { CautionLine, PageHeader } from '@portfolio/luna-shopper-admin/ui';
import { pricePolicySource } from '../catalog-sources';
import type { PricePolicy } from '../price-policies';
import {
  PRICE_RULES_INFO,
  PriceRuleForm,
  PriceRulesPage,
  toPriceRuleRows,
} from './price-rules-page';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products-routes';

/**
 * The price rules (admin plan 0043, target 6): six rows in rank order, a
 * switch on each, and a form that opens under its row.
 *
 * Against the in memory gateway, whose six rows are the ones the migration
 * seeds.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

const SECTION: AdminSection = {
  key: 'products',
  label: '',
  segment: PRODUCTS_SEGMENT,
  held: PRODUCT_RESOURCES,
  heldTabs: true,
  screens: productsRoutes(),
};

async function boot(url = '/products/price-rules') {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([SECTION])),
      provideLocationMocks(),
      provideSections(SECTION),
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);

  return fixture;
}

async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const page = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(PriceRulesPage))
    .componentInstance as PriceRulesPage;

const q = <T extends Element>(
  fixture: ComponentFixture<TestHost>,
  selector: string
) => fixture.nativeElement.querySelector(selector) as T | null;

/** One rule, as the memory table holds it now. */
const stored = (kind: string) =>
  TestBed.inject(RESOURCE_GATEWAYS)
    .for(pricePolicySource())
    .read(kind) as Promise<PricePolicy>;

afterEach(() => TestBed.resetTestingModule());

describe('the price rules', () => {
  it('lists the six rules in rank order: the lower number first', async () => {
    const fixture = await boot();
    const rows = page(fixture).rows();

    expect(rows.map((row) => [row.rank, row.id])).toEqual([
      [1, 'OFFICIAL_LEAFLET'],
      [2, 'OFFICIAL_API'],
      [3, 'OFFICIAL_WEB'],
      [4, 'ADMIN'],
      [5, 'USER_RECEIPT'],
      [6, 'USER_REPORTED'],
    ]);
    expect(fixture.nativeElement.querySelectorAll('[data-rule]')).toHaveLength(
      6
    );
  });

  it('says on a row the rank, the source, the limit and whether it is on', async () => {
    const fixture = await boot();
    const [, api, , admin] = page(fixture).rows();

    expect(api).toEqual({
      id: 'OFFICIAL_API',
      rank: 2,
      source: 'catalog.priceSourceKind.OFFICIAL_API',
      maxAgeDays: 7,
      enabled: true,
    });
    // A source with no limit is never out of date, and the row says so.
    expect(admin.maxAgeDays).toBeNull();
    const row = q(fixture, '[data-rule="ADMIN"]');
    expect(row?.textContent).toContain('catalog.pricePolicies.neverOld');
    expect(q(fixture, '[data-rule="OFFICIAL_API"]')?.textContent).toContain(
      'catalog.pricePolicies.oldAfter'
    );
    const toggle = q(fixture, '[data-rule-switch="OFFICIAL_API"]');
    expect(toggle?.getAttribute('role')).toBe('switch');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
  });

  /** Target 9: the three points of the board, and the caution. */
  it('explains itself behind the info button, with the caution', async () => {
    const fixture = await boot();
    const header = fixture.debugElement.query(By.directive(PageHeader))
      .componentInstance as PageHeader;

    expect(header.heading()).toBe('catalog.pricePolicies.many');
    expect(header.info()).toBe(PRICE_RULES_INFO);
    expect(PRICE_RULES_INFO.points).toEqual([
      'catalog.pricePolicies.info.wins',
      'catalog.pricePolicies.info.age',
      'catalog.pricePolicies.info.off',
    ]);
    expect(PRICE_RULES_INFO.caution).toBe('catalog.pricePolicies.caution');
  });

  it('turns a rule off with its switch, and reads the rows again', async () => {
    const fixture = await boot();
    expect((await stored('OFFICIAL_WEB')).enabled).toBe(true);

    q<HTMLButtonElement>(fixture, '[data-rule-switch="OFFICIAL_WEB"]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect((await stored('OFFICIAL_WEB')).enabled).toBe(false);
    expect(
      page(fixture)
        .rows()
        .find((row) => row.id === 'OFFICIAL_WEB')?.enabled
    ).toBe(false);
    expect(
      q(fixture, '[data-rule-switch="OFFICIAL_WEB"]')?.getAttribute(
        'aria-checked'
      )
    ).toBe('false');
    // Only the switch was sent: the rank and the limit are what they were.
    expect((await stored('OFFICIAL_WEB')).priority).toBe(30);
  });
});

describe('the form of a price rule', () => {
  it('opens under its row, in place, at an address of its own', async () => {
    const fixture = await boot();
    expect(fixture.debugElement.query(By.directive(PriceRuleForm))).toBeNull();

    q<HTMLButtonElement>(fixture, '[data-rule="OFFICIAL_API"]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe(
      '/products/price-rules/OFFICIAL_API'
    );
    // Inside the row it belongs to, with every other row still on screen.
    const open = fixture.nativeElement.querySelector('li.open') as HTMLElement;
    expect(open.querySelector('[data-rule="OFFICIAL_API"]')).not.toBeNull();
    expect(open.querySelector('lib-price-rule-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-rule]')).toHaveLength(
      6
    );
    expect(
      q(fixture, '[data-rule="OFFICIAL_API"]')?.getAttribute('aria-expanded')
    ).toBe('true');
    // One header: the page's.
    expect(
      fixture.debugElement.queryAll(By.directive(PageHeader))
    ).toHaveLength(1);
  });

  it('opens with the rule the address names', async () => {
    const fixture = await boot('/products/price-rules/ADMIN');

    expect(page(fixture).openId()).toBe('ADMIN');
    const form = fixture.debugElement.query(By.directive(PriceRuleForm))
      .componentInstance as PriceRuleForm;
    expect(form.store.row()).toMatchObject({ sourceKind: 'ADMIN' });
  });

  /** The row above says which rule it is, so the form does not ask. */
  it('draws the three columns a rule can change, and the caution', async () => {
    const fixture = await boot('/products/price-rules/OFFICIAL_API');
    const form = fixture.debugElement.query(By.directive(PriceRuleForm))
      .componentInstance as PriceRuleForm;

    expect(form.ruleFields.map((field) => field.name)).toEqual([
      'priority',
      'maxAgeDays',
      'enabled',
    ]);
    const caution = fixture.debugElement.query(By.directive(CautionLine))
      .componentInstance as CautionLine;
    expect(caution.text()).toBe('catalog.pricePolicies.caution');
  });

  it('saves, closes, and has the page read the rows again', async () => {
    const fixture = await boot('/products/price-rules/OFFICIAL_API');
    const form = fixture.debugElement.query(By.directive(PriceRuleForm))
      .componentInstance as PriceRuleForm;

    form.store.set('maxAgeDays', '14');
    await form.submit();
    await settle(fixture);
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe('/products/price-rules');
    expect(fixture.debugElement.query(By.directive(PriceRuleForm))).toBeNull();
    expect((await stored('OFFICIAL_API')).maxAgeDays).toBe(14);
    expect(
      page(fixture)
        .rows()
        .find((row) => row.id === 'OFFICIAL_API')?.maxAgeDays
    ).toBe(14);
  });

  it('follows a change of rank: the rows are read again in the new order', async () => {
    const fixture = await boot('/products/price-rules/ADMIN');
    const form = fixture.debugElement.query(By.directive(PriceRuleForm))
      .componentInstance as PriceRuleForm;

    // Ahead of the leaflet, which is at 10.
    form.store.set('priority', '5');
    await form.submit();
    await settle(fixture);
    await settle(fixture);

    expect(page(fixture).rows()[0]).toMatchObject({ id: 'ADMIN', rank: 1 });
  });

  it('closes when its row is pressed again, and when another is opened', async () => {
    const fixture = await boot('/products/price-rules/ADMIN');
    const router = TestBed.inject(Router);

    q<HTMLButtonElement>(fixture, '[data-rule="ADMIN"]')?.click();
    await settle(fixture);
    expect(router.url).toBe('/products/price-rules');

    q<HTMLButtonElement>(fixture, '[data-rule="ADMIN"]')?.click();
    await settle(fixture);
    q<HTMLButtonElement>(fixture, '[data-rule="OFFICIAL_WEB"]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(router.url).toBe('/products/price-rules/OFFICIAL_WEB');
    const forms = fixture.debugElement.queryAll(By.directive(PriceRuleForm));
    expect(forms).toHaveLength(1);
    // The form of the rule that is open now, and not the one that was.
    expect(
      (forms[0].componentInstance as PriceRuleForm).store.row()
    ).toMatchObject({ sourceKind: 'OFFICIAL_WEB' });
  });
});

describe('toPriceRuleRows', () => {
  const policy = (
    sourceKind: string,
    priority: number,
    over: Partial<PricePolicy> = {}
  ) =>
    ({
      sourceKind,
      priority,
      maxAgeDays: null,
      enabled: true,
      ...over,
    }) as PricePolicy;

  it('ranks by the priority number, the lower first', () => {
    const rows = toPriceRuleRows(
      [policy('ADMIN', 40), policy('OFFICIAL_LEAFLET', 10)],
      (kind) => kind.toLowerCase()
    );

    expect(rows.map((row) => [row.rank, row.id, row.source])).toEqual([
      [1, 'OFFICIAL_LEAFLET', 'official_leaflet'],
      [2, 'ADMIN', 'admin'],
    ]);
  });

  it('keeps the order the gateway gave two rules with the same number', () => {
    const rows = toPriceRuleRows(
      [policy('USER_RECEIPT', 50), policy('USER_REPORTED', 50)],
      (kind) => kind
    );

    expect(rows.map((row) => row.id)).toEqual([
      'USER_RECEIPT',
      'USER_REPORTED',
    ]);
  });

  it('reads the limit and the switch as the gateway gave them', () => {
    const [row] = toPriceRuleRows(
      [policy('OFFICIAL_API', 20, { maxAgeDays: 7, enabled: false })],
      (kind) => kind
    );

    expect(row).toMatchObject({ maxAgeDays: 7, enabled: false });
  });
});
