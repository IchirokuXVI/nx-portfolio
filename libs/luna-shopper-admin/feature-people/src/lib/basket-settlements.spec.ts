import { provideLocationMocks } from '@angular/common/testing';
import { Component, type Provider } from '@angular/core';
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
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { BasketDetailPage } from './basket-detail-page';
import { basketSettlements, toBasketSettlement } from './basket-settlements';
import { BASKETS } from './baskets';
import { USERS } from './users';

/**
 * A basket row's settlements (admin plan 0033; backend plan 0160): what each
 * one was, how many, what was paid or that nothing was, where, and by whom.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

const ALL = [USERS, BASKETS];

async function boot(url: string, providers: Provider[] = []) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(
        adminRoutes([{ key: 'shoppers', label: '', resources: ALL }])
      ),
      provideLocationMocks(),
      provideResources(...ALL),
      SessionStorage,
      SessionStore,
      DeploymentStore,
      ...providers,
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

function page(fixture: ComponentFixture<TestHost>): BasketDetailPage {
  return fixture.debugElement.query(By.directive(BasketDetailPage))
    .componentInstance as BasketDetailPage;
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

describe('a basket row’s settlements', () => {
  it('shows the price paid, the shop and who settled', async () => {
    const fixture = await boot('/shopping-lists/b-saturday');

    const [bought] = page(fixture).settlementsOf('line-bread');
    expect(bought.outcome).toBe('BOUGHT');
    expect(bought.quantity).toBe(1);
    expect(bought.paid).toContain('1.29');
    // The shop is not a resource this spec mounts, so its id stands.
    expect(bought.shop).toBe('loc_cordoba_centro');
    // The person is, and is named.
    expect(bought.by).toBe('rosa');
    expect(bought.byGuest).toBe(false);
  });

  it('says there was no price rather than drawing nothing', async () => {
    const fixture = await boot('/shopping-lists/b-saturday');

    const [none] = page(fixture).settlementsOf('line-milk');
    expect(none.outcome).toBe('NOT_AVAILABLE');
    expect(none.paid).toBe('');
    expect(none.byGuest).toBe(true);
    expect(text(fixture)).toContain('people.baskets.settlement.noPrice');
    expect(text(fixture)).toContain(
      'people.baskets.settlement.outcome.NOT_AVAILABLE'
    );
  });

  it('keeps a settlement that was taken back, marked as such', async () => {
    const fixture = await boot('/shopping-lists/b-saturday');

    const settled = page(fixture).settlementsOf('line-bread');
    expect(settled.map((one) => one.reverted)).toEqual([false, true]);
    expect(
      fixture.nativeElement.querySelectorAll('.settlements li.reverted')
    ).toHaveLength(1);
    expect(text(fixture)).toContain('people.baskets.settlement.reverted');
  });

  it('keeps every settlement when no name can be looked up', async () => {
    const fixture = await boot('/shopping-lists/b-saturday', [
      {
        provide: ResourceReferences,
        useValue: {
          resolve: async () => {
            throw new Error('down');
          },
        },
      },
    ]);

    const [bought] = page(fixture).settlementsOf('line-bread');
    expect(bought.by).toBe('11111111-1111-4111-8111-111111111111');
    expect(bought.paid).toContain('1.29');
  });

  it('says a row nobody settled has not been', async () => {
    const fixture = await boot('/shopping-lists/b-saturday');

    expect(page(fixture).settlementsOf('line-unknown')).toEqual([]);
  });
});

describe('a settlement off the wire', () => {
  it('turns cents into an amount and keeps "no price" as null', () => {
    expect(
      toBasketSettlement({ id: 's', outcome: 'BOUGHT', pricePaidCents: 129 })
    ).toMatchObject({ paid: 1.29, outcome: 'BOUGHT' });
    expect(
      toBasketSettlement({ id: 's', outcome: 'BOUGHT', pricePaidCents: null })
    ).toMatchObject({ paid: null });
  });

  it('reads an outcome it does not know as unknown, and drops a row with no id', () => {
    expect(toBasketSettlement({ id: 's', outcome: 'LOST' })?.outcome).toBe(
      'UNKNOWN'
    );
    expect(basketSettlements([{ outcome: 'BOUGHT' }, 'nonsense'])).toEqual([]);
    expect(basketSettlements(undefined)).toEqual([]);
  });
});
