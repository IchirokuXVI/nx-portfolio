import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ChartSeries } from './chart-types';
import { LineChart } from './line-chart';

/**
 * The line chart, drawn in jsdom, which has no `ResizeObserver` (plan 0015,
 * section 4). That is the case these specs run in on purpose: the width falls
 * back to the default and every tick, path and label is still computed from a
 * real number, so the geometry asserted here is the geometry a browser draws at
 * that width.
 *
 * The assertions are on what is in the SVG rather than on interpolated copy. The
 * translator double answers with the key it was asked for, so a legend label is
 * asserted through the input that produced it.
 */

const DAYS = [
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
  '2026-01-04',
  '2026-01-05',
];

function series(key: string, colour: number, values: number[]): ChartSeries {
  return {
    key,
    label: `label:${key}`,
    colour,
    points: DAYS.map((day, index) => ({ day, value: values[index] ?? 0 })),
  };
}

async function render(
  input: readonly ChartSeries[]
): Promise<ComponentFixture<LineChart>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [LineChart, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(LineChart);
  fixture.componentRef.setInput('series', input);
  fixture.componentRef.setInput('title', 'Sign ups');
  fixture.detectChanges();
  return fixture;
}

const all = (fixture: ComponentFixture<unknown>, selector: string) =>
  Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ) as HTMLElement[];

const one = (fixture: ComponentFixture<unknown>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector(selector);

describe('LineChart', () => {
  /**
   * One series names itself through the title, so a legend box beside it would
   * restate the title and spend a line of the card saying nothing.
   */
  it('draws one line, with no legend and no direct label, for one series', async () => {
    const fixture = await render([series('a', 1, [1, 2, 3, 4, 5])]);

    expect(all(fixture, 'svg path')).toHaveLength(1);
    expect(one(fixture, '.legend')).toBeNull();
    expect(all(fixture, '.direct')).toHaveLength(0);
  });

  it('draws a legend and a direct label per line for two series', async () => {
    const fixture = await render([
      series('a', 1, [1, 2, 3, 4, 5]),
      series('b', 2, [5, 4, 3, 2, 1]),
    ]);

    expect(all(fixture, 'svg path')).toHaveLength(2);
    expect(all(fixture, '.legend li')).toHaveLength(2);
    expect(
      all(fixture, '.direct').map((node) => node.textContent?.trim())
    ).toEqual(['label:a', 'label:b']);
  });

  /**
   * Two lines that finish on the same value put their two labels in the same
   * place, where neither can be read. Each one that had to move keeps a hairline
   * back to the point it names, so it still belongs to a line.
   */
  it('separates two direct labels that would land on top of each other', async () => {
    const fixture = await render([
      series('a', 1, [1, 2, 3, 4, 20]),
      series('b', 2, [9, 8, 7, 6, 20]),
    ]);

    const labels = all(fixture, '.direct').map((node) =>
      Number(node.getAttribute('y'))
    );
    expect(Math.abs(labels[0] - labels[1])).toBeGreaterThanOrEqual(14);

    const leaders = all(fixture, '.leader');
    expect(leaders).toHaveLength(2);
    // One of the two stayed where its line ends and the other was pushed off it,
    // which is exactly what the connector is there to say.
    const moved = leaders.filter(
      (leader) => leader.getAttribute('y1') !== leader.getAttribute('y2')
    );
    expect(moved).toHaveLength(1);
  });

  /**
   * Five ends that need labelling converge into a stack of text nobody reads, so
   * past four the legend carries identity on its own.
   */
  it('drops the direct labels, but not the legend, past four series', async () => {
    const fixture = await render(
      [1, 2, 3, 4, 5].map((slot) =>
        series(`s${slot}`, slot, [slot, slot, slot, slot, slot])
      )
    );

    expect(all(fixture, 'svg path')).toHaveLength(5);
    expect(all(fixture, '.legend li')).toHaveLength(5);
    expect(all(fixture, '.direct')).toHaveLength(0);
  });

  it('reveals a row per day and a cell per series, in series order', async () => {
    const fixture = await render([
      series('a', 1, [1, 2, 3, 4, 5]),
      series('b', 2, [10, 20, 30, 40, 50]),
    ]);

    expect(one(fixture, 'table')).toBeNull();

    (one(fixture, '.toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const rows = all(fixture, 'tbody tr');
    expect(rows).toHaveLength(DAYS.length);
    expect(
      Array.from(rows[2].querySelectorAll('td')).map((cell) =>
        cell.textContent?.trim()
      )
    ).toEqual(['3', '30']);
  });

  /**
   * Mouse events and not pointer events: jsdom has no `PointerEvent`, and a hover
   * nothing can assert is a hover that breaks without anyone noticing. jsdom also
   * reports every bounding box as zero, so `clientX` is the plot coordinate here.
   */
  it('shows the day nearest the pointer, and hides it again on leave', async () => {
    const fixture = await render([
      series('a', 1, [1, 2, 3, 4, 5]),
      series('b', 2, [10, 20, 30, 40, 50]),
    ]);

    // Two series put the right margin at 96, so the plot is 500 wide over five
    // days: one day every 125 pixels, and 260 is nearest the third.
    const hit = one(fixture, '.hit') as Element;
    hit.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 }));
    fixture.detectChanges();

    const expected = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date('2026-01-03T00:00:00.000Z'));

    expect(one(fixture, '.tooltip .day')?.textContent?.trim()).toBe(expected);
    expect(
      all(fixture, '.tooltip dd').map((node) => node.textContent?.trim())
    ).toEqual(['3', '30']);
    expect(one(fixture, '.crosshair')).not.toBeNull();

    hit.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(one(fixture, '.tooltip')).toBeNull();
  });

  /**
   * A window in which nothing happened and a window nobody asked for draw the
   * same thing, and both keep their axes. A chart that vanished at zero would be
   * read as a chart that failed.
   */
  it.each<[string, readonly ChartSeries[]]>([
    ['a series of zeros', [series('a', 1, [0, 0, 0, 0, 0])]],
    ['no series at all', []],
  ])('keeps the axes and says so for %s', async (_case, input) => {
    const fixture = await render(input);

    expect(one(fixture, '.empty')?.textContent?.trim()).toBe('chart.empty');
    expect(all(fixture, '.grid').length).toBeGreaterThan(0);
    expect(one(fixture, '.baseline')).not.toBeNull();
    expect(all(fixture, 'svg path')).toHaveLength(0);
  });

  it('names itself to a screen reader and offers the data as a table', async () => {
    const fixture = await render([series('a', 1, [1, 2, 3, 4, 5])]);

    const svg = one(fixture, 'svg') as Element;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Sign ups');
    expect(one(fixture, '.toggle')?.textContent?.trim()).toBe(
      'chart.showTable'
    );
  });
});
