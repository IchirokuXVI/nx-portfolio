import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { TripRowVm } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { TripRow } from './trip-row';

function row(overrides: Partial<TripRowVm> = {}): TripRowVm {
  return {
    lineId: 'l-1',
    content: 'Bananas',
    left: 3,
    bought: 3,
    asked: 6,
    mark: 'partly',
    claimedBy: null,
    buyer: null,
    nowAsks: null,
    quiet: false,
    ...overrides,
  };
}

async function render(vm: TripRowVm): Promise<ComponentFixture<TripRow>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TripRow, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(TripRow);
  fixture.componentRef.setInput('row', vm);
  fixture.detectChanges();
  return fixture;
}

function button(fixture: ComponentFixture<TripRow>): HTMLButtonElement {
  const found = (fixture.nativeElement as HTMLElement).querySelector('button');
  if (found === null) {
    throw new Error('the row is not a button');
  }
  return found;
}

describe('TripRow (velista 0088)', () => {
  describe('the indicator (test 5)', () => {
    it.each([
      ['bought', 'line.indicator.bought', 'lib-check-icon'],
      ['partly', 'list.trips.row.partly', 'lib-check-icon'],
      ['notAvailable', 'list.trips.row.notAvailable', 'lib-x-circle-icon'],
      ['notBought', 'list.trips.row.notBought', null],
      ['claimed', 'line.indicator.claimed', '.dot'],
    ] as const)(
      'draws %s with its words and shape',
      async (mark, key, shape) => {
        const fixture = await render(row({ mark }));
        const marks = button(fixture).querySelector('.mark');

        expect(marks?.textContent).toContain(key);
        if (shape === null) {
          expect(
            marks?.querySelector('lib-check-icon, lib-x-circle-icon, .dot')
          ).toBeNull();
        } else {
          expect(marks?.querySelector(shape)).not.toBeNull();
        }
      }
    );

    it('names who is buying a claimed row, and the buyer of a loose purchase', async () => {
      const claimed = await render(
        row({ mark: 'claimed', claimedBy: 'Marta' })
      );
      expect(button(claimed).querySelector('.mark')?.textContent).toContain(
        'line.indicator.claimedBy'
      );

      const loose = await render(
        row({ mark: 'bought', buyer: 'Dani', asked: null, left: null })
      );
      expect(button(loose).querySelector('.mark')?.textContent).toContain(
        'list.trips.row.boughtBy'
      );
    });
  });

  describe('the numbers', () => {
    it('draws what the trip left, and what it bought out of what it asked', async () => {
      const fixture = await render(row());

      expect(button(fixture).querySelector('.left')?.textContent?.trim()).toBe(
        '3'
      );
      expect(button(fixture).querySelector('.bought')?.textContent).toContain(
        'list.trips.row.boughtOf'
      );
    });

    it('draws a loose row as bought alone, with a muted zero', async () => {
      const fixture = await render(
        row({ mark: 'bought', asked: null, left: null, bought: 2 })
      );

      const left = button(fixture).querySelector('.left');
      expect(left?.textContent?.trim()).toBe('0');
      expect(left?.classList.contains('zero')).toBe(true);
      expect(button(fixture).querySelector('.bought')?.textContent).toContain(
        'list.trips.row.bought'
      );
    });
  });

  describe('the list now asks for more (test 6)', () => {
    it('says so when the page gave it a number', async () => {
      const fixture = await render(row({ nowAsks: 4 }));

      expect(button(fixture).querySelector('.now-asks')?.textContent).toContain(
        'list.trips.row.nowAsks'
      );
    });

    it('says nothing otherwise', async () => {
      const fixture = await render(row());

      expect(button(fixture).querySelector('.now-asks')).toBeNull();
    });
  });

  it('is a button named by the line, the outcome and the numbers, and opens the line', async () => {
    const fixture = await render(row());
    const opened = jest.fn();
    fixture.componentInstance.opened.subscribe(opened);

    const label = button(fixture).getAttribute('aria-label') ?? '';
    expect(label.startsWith('Bananas, ')).toBe(true);
    expect(label).toContain('list.trips.row.partly');
    expect(label).toContain('list.trips.row.boughtOf');

    button(fixture).click();
    expect(opened).toHaveBeenCalledWith('l-1');
  });

  it('is quieter on a past trip', async () => {
    const fixture = await render(row({ quiet: true }));

    expect(button(fixture).classList.contains('quiet')).toBe(true);
  });
});
