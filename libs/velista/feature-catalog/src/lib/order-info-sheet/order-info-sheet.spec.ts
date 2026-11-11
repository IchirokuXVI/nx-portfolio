import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderInfoSheet } from './order-info-sheet';

/**
 * The sheet behind the info button of Similar products (velista `0187`, U6): a
 * title, two paragraphs and one close control, which dismisses onto the product
 * page it covers.
 */
interface Harness {
  readonly fixture: ComponentFixture<OrderInfoSheet>;
  readonly sheets: { dismiss: jest.Mock };
}

async function render(basePath = '/velista'): Promise<Harness> {
  TestBed.resetTestingModule();
  const sheets = { dismiss: jest.fn().mockResolvedValue(undefined) };

  await TestBed.configureTestingModule({
    imports: [OrderInfoSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath }),
      { provide: SheetNavigation, useValue: sheets },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            parent: { paramMap: convertToParamMap({ itemId: 'item-milk' }) },
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrderInfoSheet);
  fixture.detectChanges();
  await settle(fixture);
  return { fixture, sheets };
}

/** Lets every pending promise run, then draws. */
async function settle(fixture: ComponentFixture<OrderInfoSheet>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

function host(fixture: ComponentFixture<OrderInfoSheet>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('OrderInfoSheet', () => {
  it('draws a title and the two paragraphs, labelled by its title', async () => {
    const { fixture } = await render();

    const title = host(fixture).querySelector('h2#order-info-title');
    expect(title?.textContent?.trim()).toBe('catalog.similar.about.title');
    expect(
      [...host(fixture).querySelectorAll('p.say')].map((one) =>
        one.textContent?.trim()
      )
    ).toEqual(['catalog.similar.about.order', 'catalog.similar.about.line']);
    expect(
      host(fixture)
        .querySelector('[aria-labelledby="order-info-title"]')
        ?.getAttribute('aria-labelledby')
    ).toBe('order-info-title');
  });

  it('has one close control, which dismisses onto the product page', async () => {
    const { fixture, sheets } = await render();

    const buttons = host(fixture).querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent?.trim()).toBe(
      'catalog.similar.about.close'
    );
    buttons[0]?.click();
    await settle(fixture);

    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.dismiss).toHaveBeenCalledWith(
      '/velista/en/catalog/products/item-milk'
    );
  });

  it('dismisses on Escape too, onto the product page of a standalone build', async () => {
    const { fixture, sheets } = await render('');

    host(fixture)
      .querySelector('lib-sheet-shell')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    await settle(fixture);

    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.dismiss).toHaveBeenCalledWith(
      '/en/catalog/products/item-milk'
    );
  });

  it('has every string in both languages, with no number inside a key and no dash', () => {
    for (const locale of ['en', 'es']) {
      const file = join(
        __dirname,
        '../../../../ui/assets/i18n',
        `${locale}.json`
      );
      const similar = JSON.parse(readFileSync(file, 'utf8')).catalog.similar;

      expect(typeof similar.aboutLabel).toBe('string');
      for (const key of ['title', 'order', 'line', 'close']) {
        expect([key, typeof similar.about[key]]).toEqual([key, 'string']);
        expect(similar.about[key]).not.toMatch(/[–—]| - |\{\{/);
      }
    }
  });
});
