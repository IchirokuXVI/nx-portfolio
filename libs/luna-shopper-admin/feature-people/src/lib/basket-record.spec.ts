import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  RecordPage,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { BASKETS } from './baskets';
import { madeAt } from './people-format';
import { BASKET_SEED, USER_SEED, ZONE_SEED } from './people-seed';
import {
  bootShoppers,
  currentUrl,
  find,
  findAll,
  settle,
  ShoppersTestHost,
  textOf,
} from './shoppers.testing';

/**
 * A shopping list on the record page (admin plan 0058, target 8).
 *
 * It only reads: the resource has no action, so the page has no "Edit" and
 * nothing in its More menu. `basket-settlements.spec.ts` holds the cases
 * about what a row was settled as.
 */

const [ROSA, MARC] = USER_SEED;
const [KITCHEN] = ZONE_SEED;
const [SATURDAY] = BASKET_SEED;

const PEOPLE = '/shoppers/people';
const ZONES = '/shoppers/zones';

const address = `${PEOPLE}/${ROSA.userId}/shopping-lists/${SATURDAY.id}`;

type Fixture = ComponentFixture<ShoppersTestHost>;

const recordPage = (fixture: Fixture): RecordPage =>
  fixture.debugElement.query(By.directive(RecordPage)).componentInstance;

describe('a shopping list', () => {
  it('is the record page, with one section and its rows as a panel', async () => {
    const fixture = await bootShoppers(address);

    expect(find(fixture, 'lib-record-page .page-title')?.textContent).toBe(
      'Saturday'
    );
    expect(
      findAll(fixture, 'lib-record-page lib-record-section h2').map((heading) =>
        heading.textContent?.trim()
      )
    ).toEqual([
      'people.baskets.section.list',
      'people.baskets.record.lines',
      'record.facts.heading',
    ]);
    expect(
      findAll(fixture, 'lib-record-view .sections lib-field-row').length
    ).toBe(4);
  });

  it('shows its rows and what was bought of each', async () => {
    const fixture = await bootShoppers(address);

    expect(find(fixture, 'lib-basket-lines-panel')?.textContent).toContain(
      'Bread'
    );
    expect(textOf(fixture)).toContain('people.baskets.status.OPEN');
    // The kind is drawn beside it, because an `OPEN` basket that never ends
    // and one nobody finished read the same without it.
    expect(textOf(fixture)).toContain('people.baskets.kind.GENERATED');
    expect(textOf(fixture)).toContain('people.baskets.bought');
  });

  it('goes back to the Shopping lists tab of its owner', async () => {
    const fixture = await bootShoppers(address);

    expect(
      find(fixture, 'lib-record-page .page-back')?.getAttribute('href')
    ).toBe(`${PEOPLE}/${ROSA.userId}/shopping-lists`);
  });

  /** The resource has no action, so the page offers none. */
  it('has no Edit and nothing in the More menu, and says why behind the info button', async () => {
    const fixture = await bootShoppers(address);

    expect(recordPage(fixture).store().mode()).toBe('read');
    expect(find(fixture, 'lib-record-page [data-edit]')).toBeNull();
    expect(find(fixture, 'lib-record-page [data-delete]')).toBeNull();
    expect(find(fixture, 'lib-record-page [data-action]')).toBeNull();
    expect(
      findAll(fixture, 'lib-record-page [pageMoreAction], [pageMoreDanger]')
    ).toEqual([]);
    expect(find(fixture, 'lib-field-control')).toBeNull();
    expect(find(fixture, 'lib-save-bar')).toBeNull();

    find<HTMLButtonElement>(
      fixture,
      'lib-record-page lib-info-button button'
    )?.click();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('people.baskets.info.record');
    expect(textOf(fixture)).toContain('people.baskets.info.correct');
  });

  /** An address that asks for the form gets the page that reads. */
  it('opens no form for an address that asks for one', async () => {
    const fixture = await bootShoppers(`${address}?edit=1`);
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(address);
    expect(recordPage(fixture).store().mode()).toBe('read');
  });

  it('says in the Record block when it was made, the zones it draws from, and no "by"', async () => {
    const fixture = await bootShoppers(address);
    await settle(fixture);

    const made = find(fixture, '[data-fact="added"]');
    expect(made?.textContent).toContain('people.baskets.record.made');
    expect(made?.querySelector('[data-by]')).toBeNull();
    expect(find(fixture, '[data-fact="changed"]')).toBeNull();
    expect(find(fixture, '[data-fact="id"]')?.textContent).toContain(
      SATURDAY.id
    );

    const zone = find(fixture, '[data-fact="zoneIds"] a');
    expect(zone?.textContent?.trim()).toBe('Kitchen');
    expect(zone?.getAttribute('href')).toBe(`${ZONES}/${KITCHEN.id}`);
  });

  /**
   * Most shopping lists have no name, and an ID is not one (admin plan 0051).
   * The day it was made, with the time, is what the row in the list is
   * called, and the heading of the page is that same title.
   */
  it('is headed by the day it was made when it has no name', async () => {
    const fixture = await bootShoppers(PEOPLE);
    await TestBed.inject(ResourceRegistry)
      .gatewayFor(BASKETS)
      .update(SATURDAY.id, { name: null });

    await TestBed.inject(Router).navigateByUrl(address);
    await settle(fixture);
    await settle(fixture);

    const heading = find(fixture, 'lib-record-page .page-title')?.textContent;
    expect(heading).toBe(
      madeAt(SATURDAY.generatedAt, TestBed.inject(ContentLocaleStore).order())
    );
    expect(heading).not.toContain(SATURDAY.id);
  });

  /**
   * A shopping list is read by its own id, so an address under another
   * person goes to the address under its owner.
   */
  it('goes to its owner when the address names another person', async () => {
    const fixture = await bootShoppers(
      `${PEOPLE}/${MARC.userId}/shopping-lists/${SATURDAY.id}`
    );
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(address);
  });
});
