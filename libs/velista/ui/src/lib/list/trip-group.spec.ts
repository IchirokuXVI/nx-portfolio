import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { TripGroupVm, TripRowVm } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { TripGroup } from './trip-group';
import { TripRow } from './trip-row';

function row(overrides: Partial<TripRowVm> = {}): TripRowVm {
  return {
    lineId: 'l-1',
    content: 'Milk',
    left: 0,
    bought: 6,
    asked: 6,
    mark: 'bought',
    claimedBy: null,
    buyer: null,
    nowAsks: null,
    quiet: true,
    ...overrides,
  };
}

function group(overrides: Partial<TripGroupVm> = {}): TripGroupVm {
  return {
    key: 'BASKET:b-1',
    kind: 'BASKET',
    live: false,
    name: 'Weekend shop',
    date: 'Sat 12 Sep',
    countKey: 'list.trips.bought',
    countArgs: { bought: 3, total: 5 },
    liveBy: null,
    open: false,
    rows: null,
    skeletonCount: 5,
    ...overrides,
  };
}

async function render(vm: TripGroupVm): Promise<ComponentFixture<TripGroup>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TripGroup, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(TripGroup);
  fixture.componentRef.setInput('group', vm);
  fixture.detectChanges();
  return fixture;
}

function host(fixture: ComponentFixture<TripGroup>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('TripGroup (velista 0088)', () => {
  describe('the head (test 7)', () => {
    it('is a button inside a heading, naming its region', async () => {
      const fixture = await render(group());
      const button = host(fixture).querySelector('h2 > button');
      const region = host(fixture).querySelector('.fold');

      expect(button?.getAttribute('aria-expanded')).toBe('false');
      expect(button?.getAttribute('aria-controls')).toBe(region?.id);
      expect(region?.id).toBe('trip-BASKET-b-1');
    });

    it('keeps a closed region inert and an open one live', async () => {
      const closed = await render(group());
      expect(host(closed).querySelector('.fold')?.hasAttribute('inert')).toBe(
        true
      );

      const open = await render(group({ open: true }));
      const fold = host(open).querySelector('.fold');
      expect(fold?.hasAttribute('inert')).toBe(false);
      expect(fold?.classList.contains('open')).toBe(true);
      expect(
        host(open).querySelector('h2 > button')?.getAttribute('aria-expanded')
      ).toBe('true');
    });

    it('asks the container to toggle when pressed', async () => {
      const fixture = await render(group());
      const toggled = jest.fn();
      fixture.componentInstance.toggled.subscribe(toggled);

      host(fixture).querySelector<HTMLButtonElement>('h2 > button')?.click();

      expect(toggled).toHaveBeenCalledWith('BASKET:b-1');
    });

    it('puts the count inside the button, so it is part of its name', async () => {
      const fixture = await render(group());

      expect(
        host(fixture).querySelector('h2 > button .count')?.textContent
      ).toContain('list.trips.bought');
    });
  });

  describe('the label (test 4)', () => {
    it('draws a named trip with its name and date', async () => {
      const fixture = await render(group());

      expect(host(fixture).querySelector('.name')?.textContent).toContain(
        'list.trips.labelNamed'
      );
    });

    it('draws an unnamed trip as its date alone', async () => {
      const fixture = await render(group({ name: null }));

      expect(host(fixture).querySelector('.name')?.textContent?.trim()).toBe(
        'Sat 12 Sep'
      );
    });

    it('draws a loose trip as Loose buys and its date', async () => {
      const fixture = await render(
        group({
          kind: 'SESSION',
          name: null,
          countKey: 'list.trips.lines',
          countArgs: { count: 2 },
        })
      );

      expect(host(fixture).querySelector('.name')?.textContent).toContain(
        'list.trips.labelNamed'
      );
      expect(host(fixture).querySelector('.count')?.textContent).toContain(
        'list.trips.lines'
      );
    });

    it('says who is buying on a live trip, and the nameless form without an owner', async () => {
      const named = await render(group({ live: true, liveBy: 'Marta' }));
      expect(host(named).querySelector('.live-chip')?.textContent).toContain(
        'list.trips.liveBy'
      );

      const nameless = await render(group({ live: true }));
      expect(host(nameless).querySelector('.live-chip')?.textContent).toContain(
        'list.trips.live'
      );

      const past = await render(group());
      expect(host(past).querySelector('.live-chip')).toBeNull();
    });
  });

  describe('the rows', () => {
    it('holds one skeleton row per line until the rows arrive', async () => {
      const fixture = await render(group({ open: true, skeletonCount: 5 }));

      expect(host(fixture).querySelectorAll('.skeleton')).toHaveLength(5);
      expect(fixture.debugElement.queryAll(By.directive(TripRow))).toHaveLength(
        0
      );
    });

    it('draws a trip row per row once they have arrived', async () => {
      const fixture = await render(
        group({
          open: true,
          rows: [row(), row({ lineId: 'l-2', content: 'Eggs' })],
        })
      );

      expect(host(fixture).querySelectorAll('.skeleton')).toHaveLength(0);
      expect(fixture.debugElement.queryAll(By.directive(TripRow))).toHaveLength(
        2
      );
    });
  });
});
