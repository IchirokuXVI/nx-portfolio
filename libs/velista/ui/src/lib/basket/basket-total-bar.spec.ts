import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { BasketTotal } from '@portfolio/velista/models';
import { boughtShare } from './basket-total-amounts';
import { BasketTotalBar } from './basket-total-bar';

const MOCK: BasketTotal = {
  lines: 12,
  withProduct: 9,
  withPrice: 7,
  boughtCents: 1160,
  leftCents: 1247,
  totalCents: 2407,
  currency: 'EUR',
};

async function render(
  total: BasketTotal = MOCK
): Promise<ComponentFixture<BasketTotalBar>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [BasketTotalBar, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketTotalBar);
  fixture.componentRef.setInput('total', total);
  fixture.componentRef.setInput('locale', 'es');
  fixture.detectChanges();
  return fixture;
}

function host(fixture: ComponentFixture<BasketTotalBar>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function fill(fixture: ComponentFixture<BasketTotalBar>): HTMLElement {
  return host(fixture).querySelector('.fill') as HTMLElement;
}

/** The bar under the chips (velista `0132`, section 4). */
describe('BasketTotalBar', () => {
  it('names the track as an image, with one sentence', async () => {
    const fixture = await render();
    const track = host(fixture).querySelector('.track');

    expect(track?.getAttribute('role')).toBe('img');
    expect(track?.getAttribute('aria-label')).toBe('basket.total.barLabel');
  });

  it('hides the two captions from a reader who has heard the track', async () => {
    const fixture = await render();
    const ends = host(fixture).querySelector('.ends');

    expect(ends?.getAttribute('aria-hidden')).toBe('true');
    expect(ends?.querySelector('.bought')?.textContent?.trim()).toBe(
      'basket.total.boughtEnd'
    );
    expect(ends?.querySelector('.left')?.textContent?.trim()).toBe(
      'basket.total.leftEnd'
    );
    // Bought at the leading end, left at the trailing one.
    expect(ends?.firstElementChild?.classList).toContain('bought');
    expect(ends?.lastElementChild?.classList).toContain('left');
  });

  it('draws the bought part as wide as its share of the total', async () => {
    const fixture = await render({
      ...MOCK,
      boughtCents: 600,
      leftCents: 1800,
      totalCents: 2400,
    });

    expect(fill(fixture).style.inlineSize).toBe('25%');

    fixture.componentRef.setInput('total', {
      ...MOCK,
      boughtCents: 1800,
      leftCents: 600,
      totalCents: 2400,
    });
    fixture.detectChanges();

    expect(fill(fixture).style.inlineSize).toBe('75%');
  });

  it('is an empty track when nothing is bought', async () => {
    const fixture = await render({ ...MOCK, boughtCents: 0, leftCents: 2407 });

    expect(fill(fixture).style.inlineSize).toBe('0%');
  });

  it('is no live region, because the number moves under a thumb', async () => {
    const fixture = await render();

    expect(
      host(fixture).querySelector('[role="status"], [aria-live]')
    ).toBeNull();
  });
});

describe('boughtShare', () => {
  it('is the bought cents over the total, as a percentage', () => {
    expect(boughtShare({ ...MOCK, boughtCents: 1200, totalCents: 2400 })).toBe(
      50
    );
  });

  it('is zero for a total of zero, and never a division by it', () => {
    expect(boughtShare({ ...MOCK, boughtCents: 0, totalCents: 0 })).toBe(0);
  });

  it('never leaves the track', () => {
    expect(boughtShare({ ...MOCK, boughtCents: 3000, totalCents: 2400 })).toBe(
      100
    );
    expect(boughtShare({ ...MOCK, boughtCents: -5, totalCents: 2400 })).toBe(0);
  });
});
