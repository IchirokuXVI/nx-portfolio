import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  ChainPriceStep,
  PriceHistoryRange,
} from '@portfolio/velista/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PriceHistory, type PriceHistoryLine } from './price-history';

/**
 * How the price of one product has moved at each supermarket (velista `0134`,
 * section 6): a legend that is the readout, one stepped line for each chain, a
 * range input over the plot for the day the chart is read at, and three ranges.
 */
const DAY = 24 * 60 * 60 * 1000;

/** Midday, so the day is the same day in every time zone a machine may run in. */
const TO = Date.UTC(2026, 9, 8, 12);
const QUARTER = 91;
const FROM = TO - QUARTER * DAY;

function chain(
  id: string,
  name: string,
  slot: number,
  steps: readonly ChainPriceStep[]
): PriceHistoryLine {
  return { id, name, slot, steps };
}

/** Went up thirty days ago. */
const CARREFOUR = chain('s1', 'Carrefour', 0, [
  { at: FROM, price: 1.09 },
  { at: TO - 30 * DAY, price: 1.19 },
]);
/** One price over the whole window. */
const MERCADONA = chain('s2', 'Mercadona', 1, [{ at: FROM, price: 1.25 }]);
/** Showed nothing until ten days ago. */
const LIDL = chain('s3', 'Lidl', 2, [
  { at: FROM, price: null },
  { at: TO - 10 * DAY, price: 0.99 },
]);

const LINES: readonly PriceHistoryLine[] = [CARREFOUR, MERCADONA, LIDL];

interface Inputs {
  readonly lines?: readonly PriceHistoryLine[];
  readonly range?: PriceHistoryRange;
  readonly from?: number;
}

/** Every translator call of the render, to read the values a string was given. */
let asked: jest.SpyInstance;

async function render(
  inputs: Inputs = {}
): Promise<ComponentFixture<PriceHistory>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [PriceHistory, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();
  asked = jest.spyOn(TestBed.inject(RokuTranslatorService), 't');

  const fixture = TestBed.createComponent(PriceHistory);
  fixture.componentRef.setInput('lines', inputs.lines ?? LINES);
  fixture.componentRef.setInput('from', inputs.from ?? FROM);
  fixture.componentRef.setInput('to', TO);
  fixture.componentRef.setInput('range', inputs.range ?? 'quarter');
  fixture.componentRef.setInput('locale', 'en');
  fixture.componentRef.setInput('product', 'Whole milk');
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function host(fixture: ComponentFixture<PriceHistory>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function entries(fixture: ComponentFixture<PriceHistory>): HTMLButtonElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLButtonElement>('.legend .entry'),
  ];
}

function entry(
  fixture: ComponentFixture<PriceHistory>,
  id: string
): HTMLButtonElement {
  return host(fixture).querySelector(
    `.legend .entry[data-chain="${id}"]`
  ) as HTMLButtonElement;
}

/** What the legend says each chain charged, in the order drawn. Null is no value. */
function values(fixture: ComponentFixture<PriceHistory>): (string | null)[] {
  return entries(fixture).map(
    (one) => one.querySelector('.entry-value')?.textContent ?? null
  );
}

function drawing(fixture: ComponentFixture<PriceHistory>): SVGElement | null {
  return host(fixture).querySelector<SVGElement>('svg');
}

function paths(fixture: ComponentFixture<PriceHistory>): SVGPathElement[] {
  return [...host(fixture).querySelectorAll<SVGPathElement>('svg path.line')];
}

/** The colour slot of each line on show, in the order drawn. */
function slots(fixture: ComponentFixture<PriceHistory>): (string | null)[] {
  return paths(fixture).map((one) => one.getAttribute('data-slot'));
}

function dots(fixture: ComponentFixture<PriceHistory>): SVGCircleElement[] {
  return [...host(fixture).querySelectorAll<SVGCircleElement>('svg .dot')];
}

function day(fixture: ComponentFixture<PriceHistory>): HTMLInputElement {
  return host(fixture).querySelector('input.day') as HTMLInputElement;
}

/** Read the chart so many days before its last one, the way a drag does. */
function readBack(fixture: ComponentFixture<PriceHistory>, days: number): void {
  const input = day(fixture);
  input.value = String(Number(input.max) - days);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();
}

function reading(fixture: ComponentFixture<PriceHistory>): string {
  return host(fixture).querySelector('.reading')?.textContent ?? '';
}

function rangeButton(
  fixture: ComponentFixture<PriceHistory>,
  range: PriceHistoryRange
): HTMLButtonElement {
  return host(fixture).querySelector(
    `.ranges [data-range="${range}"]`
  ) as HTMLButtonElement;
}

/** Where the dashed line of the day stands, in the units of the view box. */
function cursorX(fixture: ComponentFixture<PriceHistory>): number {
  const d = host(fixture).querySelector('svg .cursor')?.getAttribute('d') ?? '';
  return Number(/^M([\d.]+) /.exec(d)?.[1]);
}

/** The values the last call for a key was given. */
function valuesOf(key: string): Record<string, unknown> | undefined {
  const calls = asked.mock.calls.filter((call) => call[0] === key);
  return calls[calls.length - 1]?.[3];
}

function chosen(fixture: ComponentFixture<PriceHistory>): PriceHistoryRange[] {
  const heard: PriceHistoryRange[] = [];
  fixture.componentInstance.rangeChosen.subscribe((range) => heard.push(range));
  return heard;
}

describe('PriceHistory', () => {
  describe('the legend', () => {
    it('has one entry for each chain, in the order given, with its price today', async () => {
      const fixture = await render();

      expect(
        entries(fixture).map(
          (one) => one.querySelector('.entry-name')?.textContent
        )
      ).toEqual(['Carrefour', 'Mercadona', 'Lidl']);
      expect(values(fixture)).toEqual(['€1.19', '€1.25', '€0.99']);
    });

    it('is buttons that say they are pressed while their line is on show', async () => {
      const fixture = await render();

      for (const one of entries(fixture)) {
        expect(one.tagName).toBe('BUTTON');
        expect(one.getAttribute('type')).toBe('button');
        expect(one.getAttribute('aria-pressed')).toBe('true');
        expect(one.classList.contains('is-off')).toBe(false);
      }
    });

    it('wears the colour of its chain, on a mark a screen reader skips', async () => {
      const fixture = await render();

      expect(
        entries(fixture).map((one) =>
          one.querySelector('.swatch')?.getAttribute('data-slot')
        )
      ).toEqual(['0', '1', '2']);
      for (const one of entries(fixture)) {
        expect(one.querySelector('.swatch')?.getAttribute('aria-hidden')).toBe(
          'true'
        );
      }
    });

    it('writes each value as text, so the colour is never the only sign', async () => {
      const fixture = await render();

      expect(entry(fixture, 's1').textContent).toContain('Carrefour');
      expect(entry(fixture, 's1').textContent).toContain('€1.19');
    });

    it('says the prices are today, and how to hide a line', async () => {
      const fixture = await render();

      expect(reading(fixture)).toContain('catalog.history.today');
      expect(reading(fixture)).not.toContain('catalog.history.on');
      expect(reading(fixture)).toContain('catalog.history.hide');
    });
  });

  describe('hiding a chain', () => {
    it('hides its line and its value, and says it is not pressed', async () => {
      const fixture = await render();

      entry(fixture, 's1').click();
      fixture.detectChanges();

      expect(entry(fixture, 's1').getAttribute('aria-pressed')).toBe('false');
      expect(entry(fixture, 's1').classList.contains('is-off')).toBe(true);
      expect(entry(fixture, 's1').querySelector('.entry-value')).toBeNull();
      expect(paths(fixture)).toHaveLength(2);
      expect(dots(fixture)).toHaveLength(2);
      // The entry stays, with its name, so the line can be brought back.
      expect(
        entry(fixture, 's1').querySelector('.entry-name')?.textContent
      ).toBe('Carrefour');
    });

    it('leaves the other chains their colour', async () => {
      const fixture = await render();
      expect(slots(fixture)).toEqual(['0', '1', '2']);

      entry(fixture, 's1').click();
      fixture.detectChanges();

      // Mercadona and Lidl do not move up to the first two colours.
      expect(slots(fixture)).toEqual(['1', '2']);
      expect(dots(fixture).map((one) => one.getAttribute('data-slot'))).toEqual(
        ['1', '2']
      );
      expect(
        entries(fixture).map((one) =>
          one.querySelector('.swatch')?.getAttribute('data-slot')
        )
      ).toEqual(['0', '1', '2']);
    });

    it('leaves the other chains their value and their pressed state', async () => {
      const fixture = await render();

      entry(fixture, 's2').click();
      fixture.detectChanges();

      expect(values(fixture)).toEqual(['€1.19', null, '€0.99']);
      expect(
        entries(fixture).map((one) => one.getAttribute('aria-pressed'))
      ).toEqual(['true', 'false', 'true']);
    });

    it('does not move the lines that stay: the axis holds every chain', async () => {
      const fixture = await render();
      const before = paths(fixture).map((one) => one.getAttribute('d'));
      const ticks = [...host(fixture).querySelectorAll('svg text.tick')].map(
        (one) => one.textContent?.trim()
      );

      // Lidl is the lowest price, so an axis of what is on show would move.
      entry(fixture, 's3').click();
      fixture.detectChanges();

      expect(paths(fixture).map((one) => one.getAttribute('d'))).toEqual(
        before.slice(0, 2)
      );
      expect(
        [...host(fixture).querySelectorAll('svg text.tick')].map((one) =>
          one.textContent?.trim()
        )
      ).toEqual(ticks);
    });

    it('brings the line back on a second press, in the colour it had', async () => {
      const fixture = await render();

      entry(fixture, 's1').click();
      fixture.detectChanges();
      entry(fixture, 's1').click();
      fixture.detectChanges();

      expect(entry(fixture, 's1').getAttribute('aria-pressed')).toBe('true');
      expect(values(fixture)).toEqual(['€1.19', '€1.25', '€0.99']);
      expect(slots(fixture)).toEqual(['0', '1', '2']);
    });

    it('can hide every chain, and still draws the chart to bring one back', async () => {
      const fixture = await render();

      for (const one of entries(fixture)) {
        one.click();
      }
      fixture.detectChanges();

      expect(paths(fixture)).toHaveLength(0);
      expect(drawing(fixture)).not.toBeNull();
      expect(entries(fixture)).toHaveLength(3);
    });
  });

  describe('the day the chart is read at', () => {
    it('is a range input over the plot, named, that opens on the last day', async () => {
      const fixture = await render();

      const input = day(fixture);
      expect(input.type).toBe('range');
      expect(input.min).toBe('0');
      expect(input.max).toBe(String(QUARTER));
      expect(input.step).toBe('1');
      expect(input.value).toBe(String(QUARTER));
      expect(input.getAttribute('aria-label')).toBe('catalog.history.day');
      // The day in words, for a reader who would otherwise hear "91".
      expect(input.getAttribute('aria-valuetext')).toMatch(/8/);
      expect(input.getAttribute('aria-valuetext')).toMatch(/October/);
    });

    it('changes the values of the legend to those of the day', async () => {
      const fixture = await render();

      // Forty days back: before Carrefour went up, and before Lidl showed a price.
      readBack(fixture, 40);

      expect(values(fixture)).toEqual(['€1.09', '€1.25', null]);
    });

    it('changes the sentence from today to the day', async () => {
      const fixture = await render();

      readBack(fixture, 40);

      expect(reading(fixture)).toContain('catalog.history.on');
      expect(reading(fixture)).not.toContain('catalog.history.today');
      expect(reading(fixture)).toContain('catalog.history.hide');
      const said = String(valuesOf('catalog.history.on')?.['day']);
      expect(said).toMatch(/29/);
      expect(said).toMatch(/August/);
      expect(day(fixture).getAttribute('aria-valuetext')).toBe(said);
    });

    it('says today again when the input goes back to the last day', async () => {
      const fixture = await render();

      readBack(fixture, 40);
      readBack(fixture, 0);

      expect(reading(fixture)).toContain('catalog.history.today');
      expect(values(fixture)).toEqual(['€1.19', '€1.25', '€0.99']);
    });

    it('reads the day in the reader language', async () => {
      const fixture = await render();
      fixture.componentRef.setInput('locale', 'es');
      fixture.detectChanges();

      readBack(fixture, 40);

      expect(String(valuesOf('catalog.history.on')?.['day'])).toMatch(/agosto/);
    });

    it('moves the dashed line to the day, and the dots with it', async () => {
      const fixture = await render();
      // At the last day the line stands at the right end of the plot.
      expect(cursorX(fixture)).toBe(288);
      expect(dots(fixture)).toHaveLength(3);

      readBack(fixture, 40);

      // 51 of 91 days along a plot that runs from 36 to 288.
      expect(cursorX(fixture)).toBeCloseTo(36 + (51 / 91) * 252, 3);
      // Lidl showed nothing that day, so it has no dot.
      expect(dots(fixture).map((one) => one.getAttribute('data-slot'))).toEqual(
        ['0', '1']
      );
      for (const dot of dots(fixture)) {
        expect(Number(dot.getAttribute('cx'))).toBeCloseTo(cursorX(fixture), 6);
      }
    });

    it('stands at the left end of the plot on the first day', async () => {
      const fixture = await render();

      readBack(fixture, QUARTER);

      expect(cursorX(fixture)).toBe(36);
      expect(values(fixture)).toEqual(['€1.09', '€1.25', null]);
    });

    it('writes the day under the dashed line, but not on top of an end label', async () => {
      const fixture = await render();
      const marks = (): Element[] => [
        ...host(fixture).querySelectorAll('svg text.end[text-anchor="middle"]'),
      ];
      expect(marks()).toHaveLength(0);

      readBack(fixture, 40);
      expect(marks()).toHaveLength(1);
      expect(marks()[0]?.textContent).toMatch(/29/);
      expect(Number(marks()[0]?.getAttribute('x'))).toBeCloseTo(
        cursorX(fixture),
        6
      );

      readBack(fixture, 2);
      expect(marks()).toHaveLength(0);
    });

    it('keeps the day of a hidden chain out of the legend while the day moves', async () => {
      const fixture = await render();

      entry(fixture, 's1').click();
      fixture.detectChanges();
      readBack(fixture, 5);

      expect(values(fixture)).toEqual([null, '€1.25', '€0.99']);
    });
  });

  describe('the drawing', () => {
    it('is an image named for the product, the range and how many chains', async () => {
      const fixture = await render();

      const svg = drawing(fixture);
      expect(svg?.getAttribute('role')).toBe('img');
      expect(svg?.getAttribute('aria-label')).toBe(
        'catalog.history.chart.quarter'
      );
      expect(valuesOf('catalog.history.chart.quarter')).toEqual({
        name: 'Whole milk',
        count: 3,
      });
    });

    it('names the range it was given', async () => {
      const fixture = await render({ range: 'year', from: TO - 365 * DAY });

      expect(drawing(fixture)?.getAttribute('aria-label')).toBe(
        'catalog.history.chart.year'
      );
    });

    it('draws each line as steps: flat, then straight up or down, never a slope', async () => {
      const fixture = await render();

      for (const path of paths(fixture)) {
        expect(path.getAttribute('d')).toMatch(
          /^M[\d.]+ [\d.]+H[\d.]+(V[\d.]+H[\d.]+)*$/
        );
      }
      // Carrefour changed once: one flat run, one jump, one flat run.
      expect(paths(fixture)[0]?.getAttribute('d')).toMatch(
        /^M36 [\d.]+H[\d.]+V[\d.]+H288$/
      );
      // Mercadona never changed: one flat run across the whole plot.
      expect(paths(fixture)[1]?.getAttribute('d')).toMatch(/^M36 [\d.]+H288$/);
    });

    it('starts a line where the chain first showed a price', async () => {
      const fixture = await render();

      // Ten days before the end of 91: 81 of 91 along a plot from 36 to 288.
      const start = Math.round((36 + (81 / 91) * 252) * 10) / 10;
      expect(paths(fixture)[2]?.getAttribute('d')).toMatch(
        new RegExp(`^M${start} [\\d.]+H288$`)
      );
    });

    it('draws a dearer price higher', async () => {
      const fixture = await render();
      const level = (index: number): number =>
        Number(
          /^M[\d.]+ ([\d.]+)/.exec(
            paths(fixture)[index]?.getAttribute('d') ?? ''
          )?.[1]
        );

      // Carrefour opens at 1.09, Mercadona at 1.25, Lidl at 0.99. A smaller y is
      // higher on the page.
      expect(level(1)).toBeLessThan(level(0));
      expect(level(0)).toBeLessThan(level(2));
      for (const index of [0, 1, 2]) {
        expect(level(index)).toBeGreaterThanOrEqual(20);
        expect(level(index)).toBeLessThanOrEqual(150);
      }
    });

    it('ends each line in its value as text', async () => {
      const fixture = await render();

      expect(
        [...host(fixture).querySelectorAll('svg text.end')].map((one) =>
          one.textContent?.trim()
        )
      ).toEqual(['1.19', '1.25', '0.99']);
    });

    it('keeps two values apart when two lines end on the same price', async () => {
      const fixture = await render({
        lines: [
          CARREFOUR,
          chain('s2', 'Mercadona', 1, [
            { at: FROM, price: 1.3 },
            { at: TO - 5 * DAY, price: 1.19 },
          ]),
        ],
      });

      const ys = [...host(fixture).querySelectorAll('svg text.end')].map(
        (one) => Number(one.getAttribute('y'))
      );
      expect(ys).toHaveLength(2);
      expect(Math.abs(ys[0] - ys[1])).toBeGreaterThanOrEqual(11);
    });

    it('writes the first day and today under the plot', async () => {
      const fixture = await render();

      const text = drawing(fixture)?.textContent ?? '';
      expect(text).toContain('catalog.history.axisToday');
      // 91 days before 8 October.
      expect(text).toMatch(/Jul/);
    });

    it('lays the input over the plot the drawing uses, from its first day to its last', async () => {
      const fixture = await render();

      // The drawing says where the plot is: its view box, and the ends of a grid line.
      const [, , width] = (drawing(fixture)?.getAttribute('viewBox') ?? '')
        .split(' ')
        .map(Number);
      const grid =
        host(fixture).querySelector('svg .grid')?.getAttribute('d') ?? '';
      const [, left, right] = /^M([\d.]+) [\d.]+H([\d.]+)/.exec(grid) ?? [];

      const scss = readFileSync(join(__dirname, 'price-history.scss'), 'utf8');
      expect(scss).toContain(
        `inset-inline-start: calc(${left} / ${width} * 100%);`
      );
      expect(scss).toContain(
        `inline-size: calc(${Number(right) - Number(left)} / ${width} * 100%);`
      );
    });
  });

  describe('the ranges', () => {
    it('is a named group of three buttons, with the range in use pressed', async () => {
      const fixture = await render();

      const group = host(fixture).querySelector('.ranges');
      expect(group?.getAttribute('role')).toBe('group');
      expect(group?.getAttribute('aria-label')).toBe(
        'catalog.history.rangeLabel'
      );
      const buttons = [
        ...(group?.querySelectorAll<HTMLButtonElement>('button') ?? []),
      ];
      expect(buttons.map((one) => one.dataset['range'])).toEqual([
        'month',
        'quarter',
        'year',
      ]);
      expect(buttons.map((one) => one.getAttribute('aria-pressed'))).toEqual([
        'false',
        'true',
        'false',
      ]);
      expect(buttons.map((one) => one.textContent?.trim())).toEqual([
        'catalog.history.range.month',
        'catalog.history.range.quarter',
        'catalog.history.range.year',
      ]);
    });

    it('says which range was chosen', async () => {
      const fixture = await render();
      const heard = chosen(fixture);

      rangeButton(fixture, 'year').click();
      rangeButton(fixture, 'month').click();

      expect(heard).toEqual(['year', 'month']);
    });

    it('says nothing for the range it already shows', async () => {
      const fixture = await render();
      const heard = chosen(fixture);

      rangeButton(fixture, 'quarter').click();

      expect(heard).toEqual([]);
    });

    it('does not change the range by itself: the page hands the new window in', async () => {
      const fixture = await render();

      rangeButton(fixture, 'year').click();
      fixture.detectChanges();

      expect(rangeButton(fixture, 'quarter').getAttribute('aria-pressed')).toBe(
        'true'
      );
      expect(day(fixture).max).toBe(String(QUARTER));
    });

    it('reads a new window at today again', async () => {
      const fixture = await render();
      readBack(fixture, 40);

      rangeButton(fixture, 'year').click();
      fixture.componentRef.setInput('range', 'year');
      fixture.componentRef.setInput('from', TO - 365 * DAY);
      fixture.detectChanges();

      expect(rangeButton(fixture, 'year').getAttribute('aria-pressed')).toBe(
        'true'
      );
      expect(reading(fixture)).toContain('catalog.history.today');
      expect(day(fixture).max).toBe('365');
      expect(day(fixture).value).toBe('365');
      expect(cursorX(fixture)).toBe(288);
      expect(values(fixture)).toEqual(['€1.19', '€1.25', '€0.99']);
    });

    it('keeps a hidden chain hidden in a new window', async () => {
      const fixture = await render();
      entry(fixture, 's1').click();
      fixture.detectChanges();

      fixture.componentRef.setInput('range', 'year');
      fixture.componentRef.setInput('from', TO - 365 * DAY);
      fixture.detectChanges();

      expect(entry(fixture, 's1').getAttribute('aria-pressed')).toBe('false');
      expect(slots(fixture)).toEqual(['1', '2']);
    });
  });

  describe('fewer than two prices', () => {
    it('draws one sentence and no chart for one price', async () => {
      const fixture = await render({ lines: [MERCADONA] });

      expect(drawing(fixture)).toBeNull();
      expect(host(fixture).querySelector('.legend')).toBeNull();
      expect(host(fixture).querySelector('input.day')).toBeNull();
      expect(host(fixture).querySelector('.reading')).toBeNull();
      expect(host(fixture).querySelector('.none')?.textContent).toContain(
        'catalog.history.none.quarter'
      );
    });

    it('draws the sentence for no chain at all', async () => {
      const fixture = await render({ lines: [] });

      expect(drawing(fixture)).toBeNull();
      expect(host(fixture).querySelector('.none')).not.toBeNull();
    });

    it('does not count a stretch with nothing shown as a price', async () => {
      const fixture = await render({ lines: [LIDL] });

      expect(drawing(fixture)).toBeNull();
      expect(host(fixture).querySelector('.none')).not.toBeNull();
    });

    it('names the range in the sentence', async () => {
      const fixture = await render({
        lines: [MERCADONA],
        range: 'month',
        from: TO - 30 * DAY,
      });

      expect(host(fixture).querySelector('.none')?.textContent).toContain(
        'catalog.history.none.month'
      );
    });

    it('keeps the ranges, because a longer one may hold a movement', async () => {
      const fixture = await render({ lines: [MERCADONA] });
      const heard = chosen(fixture);

      expect(host(fixture).querySelectorAll('.ranges button')).toHaveLength(3);
      rangeButton(fixture, 'year').click();

      expect(heard).toEqual(['year']);
    });

    it('draws the chart for two prices, whether one chain has both or two have one each', async () => {
      const moved = await render({ lines: [CARREFOUR] });
      expect(drawing(moved)).not.toBeNull();
      expect(host(moved).querySelector('.none')).toBeNull();

      const two = await render({
        lines: [MERCADONA, chain('s4', 'DIA', 3, [{ at: FROM, price: 1.1 }])],
      });
      expect(drawing(two)).not.toBeNull();
      expect(slots(two)).toEqual(['1', '3']);
    });
  });

  describe('the strings and the colours', () => {
    it('has every string of the chart in both languages', () => {
      // The testing translator answers the key, so the strings are read off the
      // files the real one loads.
      for (const locale of ['en', 'es']) {
        const file = join(__dirname, '../../../assets/i18n', `${locale}.json`);
        const history = JSON.parse(readFileSync(file, 'utf8')).catalog.history;

        for (const key of ['today', 'on', 'hide', 'day', 'axisToday']) {
          expect([key, typeof history[key]]).toEqual([key, 'string']);
        }
        expect(history.on).toContain('{{day}}');
        expect(typeof history.rangeLabel).toBe('string');
        for (const range of ['month', 'quarter', 'year']) {
          expect([range, typeof history.range[range]]).toEqual([
            range,
            'string',
          ]);
          // One supermarket is not "1 supermarkets", so the name has two forms.
          for (const form of ['one', 'other']) {
            expect(history.chart[`${range}_${form}`]).toContain('{{name}}');
          }
          expect([range, typeof history.none[range]]).toEqual([
            range,
            'string',
          ]);
        }
      }
    });

    it('gives each of the five slots a series colour that both themes define', () => {
      const scss = readFileSync(join(__dirname, 'price-history.scss'), 'utf8');
      const themes = readFileSync(
        join(__dirname, '../styles/_themes.scss'),
        'utf8'
      );
      const primitives = readFileSync(
        join(__dirname, '../styles/_primitives.scss'),
        'utf8'
      );

      for (const slot of [0, 1, 2, 3, 4]) {
        const series = slot + 1;
        expect(scss).toMatch(
          new RegExp(
            `\\[data-slot='${slot}'\\]\\s*\\{\\s*--series:\\s*var\\(--app-chart-series-${series}\\);`
          )
        );
        // Once for Night and once for Day, each from its own primitive.
        expect(themes).toContain(
          `--app-chart-series-${series}: var(--app-chart-night-${series});`
        );
        expect(themes).toContain(
          `--app-chart-series-${series}: var(--app-chart-day-${series});`
        );
        expect(primitives).toMatch(
          new RegExp(`--app-chart-day-${series}:\\s*#[0-9a-f]{6};`)
        );
        expect(primitives).toMatch(
          new RegExp(`--app-chart-night-${series}:\\s*#[0-9a-f]{6};`)
        );
      }
    });
  });
});
