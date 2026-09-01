import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type { BasketLine, BasketParticipant } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { BasketLineRow } from './basket-line-row';

/**
 * The row's status control (plan 0052, section 6).
 *
 * What this is really asserting is that the control **says what pressing it does**,
 * differently for each of the four states, and that the row's own button is still the
 * control it always was with the composed label it always had. A row that grew a
 * second button and lost the first would pass a test that only counted glyphs.
 *
 * Assertions are on `aria-label` keys rather than on rendered English, because the
 * testing translator echoes keys: the question is which sentence was chosen and what
 * it was given, never how it reads after a copy edit.
 */

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: 'line-1',
    content: 'Milk',
    quantity: 3,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    ...overrides,
  };
}

/** A finished line, which is the pair of states the report is really about. */
const bought = () =>
  line({ settled: 3, touchedBy: 'p-1', lastOutcome: 'BOUGHT' });
const unavailable = () =>
  line({ settled: 3, touchedBy: 'p-1', lastOutcome: 'NOT_AVAILABLE' });

async function render(row: BasketLine, options: { canReopen?: boolean } = {}) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketLineRow, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketLineRow);
  fixture.componentRef.setInput('line', row);
  fixture.componentRef.setInput('people', new Map<string, BasketParticipant>());
  fixture.componentRef.setInput('products', new Map());
  fixture.componentRef.setInput('canReopen', options.canReopen ?? false);
  fixture.detectChanges();

  return fixture;
}

const status = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement).querySelector('.status');

const body = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement).querySelector('.body');

describe('BasketLineRow: the status control', () => {
  it('offers to get the whole thing on a line nobody has touched', async () => {
    const fixture = await render(line());

    const control = status(fixture);
    expect(control?.tagName).toBe('BUTTON');
    expect(control?.getAttribute('aria-label')).toContain('basket.status.got');
  });

  it('offers the rest on a line somebody got some of', async () => {
    // A different sentence, because a person who has already got two of three is not
    // being asked the same question as somebody starting the line.
    const fixture = await render(line({ settled: 1 }));

    expect(status(fixture)?.getAttribute('aria-label')).toContain(
      'basket.status.rest'
    );
  });

  it('offers to undo a purchase on a finished line', async () => {
    const fixture = await render(bought(), { canReopen: true });

    expect(status(fixture)?.getAttribute('aria-label')).toContain(
      'basket.status.undoGot'
    );
  });

  it('does not call a shop that had none a purchase', async () => {
    // The reason the fourth state exists at all. `NOT_AVAILABLE` closes the
    // outstanding amount exactly as a purchase does, so these two lines have
    // identical numbers, and a tick on this one would claim a purchase that never
    // happened.
    const fixture = await render(unavailable(), { canReopen: true });

    expect(status(fixture)?.getAttribute('aria-label')).toContain(
      'basket.status.undoNone'
    );
  });

  it('draws a different shape for each of the four states', async () => {
    // Never colour alone (`0044`, section 7). The shape is what survives a bright
    // aisle and a reader who does not distinguish the hues.
    const glyphs = await Promise.all(
      [line(), line({ settled: 1 }), bought(), unavailable()].map(
        async (row) => {
          const fixture = await render(row, { canReopen: true });
          return status(fixture)?.firstElementChild?.tagName ?? '';
        }
      )
    );

    expect(new Set(glyphs).size).toBe(4);
    expect(glyphs).not.toContain('');
  });
});

describe('BasketLineRow: what a tap does', () => {
  it('asks for the whole outstanding amount, and never opens the sheet', async () => {
    // One tap is the whole point: settling everything used to cost a tap, a sheet, a
    // tap and a dismissal.
    const fixture = await render(line());
    const settled: unknown[] = [];
    const opened: unknown[] = [];
    fixture.componentInstance.settle.subscribe(() => settled.push(1));
    fixture.componentInstance.open.subscribe(() => opened.push(1));

    (status(fixture) as HTMLButtonElement).click();

    expect(settled).toHaveLength(1);
    expect(opened).toHaveLength(0);
  });

  it('reopens a finished line rather than settling it again', async () => {
    const fixture = await render(bought(), { canReopen: true });
    const reopened: unknown[] = [];
    const settled: unknown[] = [];
    fixture.componentInstance.reopen.subscribe(() => reopened.push(1));
    fixture.componentInstance.settle.subscribe(() => settled.push(1));

    (status(fixture) as HTMLButtonElement).click();

    expect(reopened).toHaveLength(1);
    expect(settled).toHaveLength(0);
  });
});

describe('BasketLineRow: a backend with no reopen route', () => {
  it('states what a finished line is instead of offering an act that would 404', async () => {
    // Plan 0052, section 10. A control you may not use is not drawn (`0030`), so this
    // is a mark and not a disabled button: nothing has been taken away from this
    // reader, and a dimmed control would say something about them that is not true.
    const fixture = await render(bought(), { canReopen: false });

    const control = status(fixture);
    expect(control?.tagName).toBe('SPAN');
    expect(control?.getAttribute('aria-label')).toContain(
      'basket.status.isGot'
    );
  });

  it('still lets an unfinished line be settled in one tap', async () => {
    // The settle direction works in full from the first commit, and it is most of the
    // value: only the reopen half waits on luna `0054`.
    const fixture = await render(line(), { canReopen: false });

    expect(status(fixture)?.tagName).toBe('BUTTON');
  });
});

describe('BasketLineRow: the row itself', () => {
  it('still opens the sheet, and still carries the whole line in its name', async () => {
    // `0044`'s composed label is not a casualty of the split: the quantity and the
    // attribution are separate lines visually, and a reader moving by button would
    // otherwise hear only the content.
    const fixture = await render(line({ quantity: 3 }));
    const opened: unknown[] = [];
    fixture.componentInstance.open.subscribe(() => opened.push(1));

    const control = body(fixture) as HTMLButtonElement;
    control.click();

    expect(opened).toHaveLength(1);
    const label = control.getAttribute('aria-label') ?? '';
    expect(label).toContain('Milk');
    expect(label).toContain('basket.line.wanted');
  });

  it('is a container rather than a control, so it may hold two buttons', async () => {
    // A button cannot contain a button, which is what splits the row in the first
    // place. The row keeping its own `button` role would be an invalid tree that
    // renders anyway and announces wrongly.
    const fixture = await render(line());

    const row = (fixture.nativeElement as HTMLElement).querySelector('.row');
    expect(row?.tagName).toBe('DIV');
    expect(row?.querySelectorAll('button')).toHaveLength(2);
  });
});
