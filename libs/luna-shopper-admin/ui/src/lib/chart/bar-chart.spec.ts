import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { BarChart } from './bar-chart';
import type { ChartBar, ChartSeriesInfo } from './chart-types';

/**
 * The bar chart, and mostly the two pieces of geometry a reader notices before
 * they notice anything else: the strip of surface between touching marks, and
 * the rounding that belongs to the data end and to no other corner.
 *
 * The rounding is why a segment's drawn height is four more than its true one.
 * An SVG rectangle rounds all four corners or none, so the top segment is drawn
 * past its own bottom edge and clipped back to it, which leaves the two corners
 * that sit on the baseline square. The specs below subtract that four when they
 * measure, which is the honest way to assert on it.
 */

const RADIUS = 4;

function bar(key: string, values: number[]): ChartBar {
  return { key, label: `label:${key}`, values };
}

function info(key: string, colour: number): ChartSeriesInfo {
  return { key, label: `label:${key}`, colour };
}

async function render(
  bars: readonly ChartBar[],
  series: readonly ChartSeriesInfo[]
): Promise<ComponentFixture<BarChart>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BarChart, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(BarChart);
  fixture.componentRef.setInput('bars', bars);
  fixture.componentRef.setInput('series', series);
  fixture.componentRef.setInput('title', 'Runs by status');
  fixture.detectChanges();
  return fixture;
}

const all = (fixture: ComponentFixture<unknown>, selector: string) =>
  Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ) as Element[];

const one = (fixture: ComponentFixture<unknown>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector(selector);

const box = (rect: Element) => ({
  x: Number(rect.getAttribute('x')),
  y: Number(rect.getAttribute('y')),
  width: Number(rect.getAttribute('width')),
  height: Number(rect.getAttribute('height')),
  radius: Number(rect.getAttribute('rx')),
});

describe('BarChart', () => {
  it('stacks two series per category, first at the baseline, with a two pixel gap', async () => {
    const fixture = await render(
      [bar('one', [10, 5]), bar('two', [4, 8])],
      [info('a', 1), info('b', 2)]
    );

    const segments = all(fixture, '.segment');
    expect(segments).toHaveLength(4);

    const bottom = box(segments[0]);
    const top = box(segments[1]);

    expect(top.y).toBeLessThan(bottom.y);
    expect(bottom.y - (top.y + top.height - RADIUS)).toBeCloseTo(2, 6);
    // Only the data end is rounded, and the segment under it is not.
    expect(top.radius).toBe(RADIUS);
    expect(bottom.radius).toBe(0);
  });

  /**
   * Thirty stacks of one day each is what this exists for. Every label drawn
   * would collide into a grey band, and a band of unreadable text says less than
   * ten readable dates with the rest one hover away.
   */
  it('thins the category labels past ten, and leaves five alone', async () => {
    const many = await render(
      Array.from({ length: 30 }, (_value, index) =>
        bar(`d${index}`, [index + 1])
      ),
      [info('a', 1)]
    );
    expect(all(many, '.tick.x')).toHaveLength(10);

    const few = await render(
      Array.from({ length: 5 }, (_value, index) =>
        bar(`d${index}`, [index + 1])
      ),
      [info('a', 1)]
    );
    expect(all(few, '.tick.x')).toHaveLength(5);
  });

  /**
   * Colour is identity between the series of a stack. With one series there is
   * nothing to tell apart, so the number a caller passed would be a hue chosen
   * for a reason nobody can recover, and the legend would restate the title.
   */
  it('draws a single series in the first colour and shows no legend', async () => {
    const fixture = await render(
      [bar('one', [3]), bar('two', [7])],
      [info('a', 4)]
    );

    expect(one(fixture, '.legend')).toBeNull();
    expect(
      all(fixture, '.segment').map((rect) => rect.getAttribute('fill'))
    ).toEqual(['var(--admin-chart-1)', 'var(--admin-chart-1)']);
  });

  it('names the hovered category and every series value, and forgets it on leave', async () => {
    const fixture = await render(
      [bar('one', [10, 5]), bar('two', [4, 8])],
      [info('a', 1), info('b', 2)]
    );

    const hits = all(fixture, '.hit');
    hits[1].dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(one(fixture, '.tooltip .day')?.textContent?.trim()).toBe(
      'label:two'
    );
    expect(
      all(fixture, '.tooltip dd').map((node) => node.textContent?.trim())
    ).toEqual(['4', '8']);

    hits[1].dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(one(fixture, '.tooltip')).toBeNull();
  });

  it('reveals a row per category and a cell per series, in series order', async () => {
    const fixture = await render(
      [bar('one', [10, 5]), bar('two', [4, 8])],
      [info('a', 1), info('b', 2)]
    );

    (one(fixture, '.toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const rows = all(fixture, 'tbody tr');
    expect(rows).toHaveLength(2);
    expect(
      Array.from(rows[1].querySelectorAll('td')).map((cell) =>
        cell.textContent?.trim()
      )
    ).toEqual(['4', '8']);
  });

  it.each<[string, readonly ChartBar[]]>([
    ['every category at zero', [bar('one', [0]), bar('two', [0])]],
    ['no categories at all', []],
  ])('keeps the axes and says so for %s', async (_case, bars) => {
    const fixture = await render(bars, [info('a', 1)]);

    expect(one(fixture, '.empty')?.textContent?.trim()).toBe('chart.empty');
    expect(all(fixture, '.grid').length).toBeGreaterThan(0);
    expect(one(fixture, '.baseline')).not.toBeNull();
    expect(all(fixture, '.segment')).toHaveLength(0);
  });
});
