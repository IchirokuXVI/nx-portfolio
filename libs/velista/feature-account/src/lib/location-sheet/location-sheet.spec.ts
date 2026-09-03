import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeShoppingProfileStore,
  provideFakeShoppingProfileStore,
  type FakeShoppingProfileStore,
} from '@portfolio/velista/data-access';
import {
  fakeGeolocationReader,
  GEOLOCATION_READER,
  provideVelistaTesting,
  SheetNavigation,
  type LocationOutcome,
  type LocationPermission,
} from '@portfolio/velista/platform';
import { LocationSheet } from './location-sheet';

/**
 * Letting the device say where you shop (plan 0058, section 3).
 *
 * **Every one of these runs in jsdom with no geolocation API anywhere**, which is what
 * the token in `platform` exists for: jsdom has no `navigator.geolocation` at all, so
 * "what does this screen do when permission is denied" would otherwise be unanswerable
 * without a browser and a person willing to refuse a prompt.
 *
 * They assert on component inputs and on recorded calls rather than on rendered text
 * wherever a string is interpolated, because the testing translator echoes keys and does
 * not interpolate.
 */
interface Options {
  readonly permission?: LocationPermission;
  readonly outcome?: LocationOutcome;
  readonly resolvesTo?: string | null;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<LocationSheet>;
  store: FakeShoppingProfileStore;
  reader: ReturnType<typeof fakeGeolocationReader>;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const store = fakeShoppingProfileStore({
    resolvesTo: options.resolvesTo === undefined ? '14001' : options.resolvesTo,
  });
  const reader = fakeGeolocationReader({
    permission: options.permission,
    outcome: options.outcome,
  });
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  await TestBed.configureTestingModule({
    imports: [LocationSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      provideFakeShoppingProfileStore(store),
      { provide: GEOLOCATION_READER, useValue: reader.reader },
      { provide: SheetNavigation, useValue: sheets },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LocationSheet);
  fixture.detectChanges();
  await settle(fixture);

  return { fixture, store, reader, sheets };
}

/**
 * Let the pending promises resolve and redraw.
 *
 * `whenStable` hangs in a zoneless spec, so the microtask queue is drained by hand.
 */
async function settle(fixture: ComponentFixture<LocationSheet>): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

function query<T extends HTMLElement>(
  fixture: ComponentFixture<LocationSheet>,
  selector: string
): T | null {
  return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
}

function text(fixture: ComponentFixture<LocationSheet>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

/** Press the one primary button the current state offers. */
async function pressPrimary(
  fixture: ComponentFixture<LocationSheet>
): Promise<void> {
  query<HTMLButtonElement>(fixture, '.primary')?.click();
  await settle(fixture);
}

describe('LocationSheet', () => {
  describe('before anybody presses', () => {
    it('never asks the device, so the browser prompt cannot fire on load', async () => {
      // The acceptance criterion of section 3.1, in the only form it can be stated:
      // the prompt is raised by `read`, so the assertion is that `read` was not called.
      const { reader } = await render();

      expect(reader.state.reads).toBe(0);
    });

    it('says what it will do with the position before offering the button', async () => {
      const { fixture } = await render();

      expect(text(fixture)).toContain('profiles.location.explain');
      expect(text(fixture)).toContain('profiles.location.use');
    });

    it('asks only the permission, which prompts nobody', async () => {
      const { reader } = await render();

      expect(reader.state.queries).toBe(1);
      expect(reader.state.reads).toBe(0);
    });
  });

  describe('a refused permission (section 3.4)', () => {
    it('opens straight into the manual path when the browser already knows', async () => {
      const { fixture, reader } = await render({ permission: 'denied' });

      expect(text(fixture)).toContain('profiles.location.refused');
      expect(text(fixture)).toContain('profiles.location.typeInstead');
      // It is sticky and nothing here can change it, so offering the button that
      // raises the prompt would be offering a button that cannot work.
      expect(text(fixture)).not.toContain('profiles.location.use');
      expect(reader.state.reads).toBe(0);
    });

    it('does not ask again after somebody says no', async () => {
      const { fixture, reader } = await render({
        outcome: { state: 'denied' },
      });

      await pressPrimary(fixture);
      expect(reader.state.reads).toBe(1);
      expect(text(fixture)).toContain('profiles.location.refused');

      // The only control left is the one that leaves for the typed path.
      await pressPrimary(fixture);
      expect(reader.state.reads).toBe(1);
    });

    it('leaves without writing anything', async () => {
      const { fixture, store } = await render({ permission: 'denied' });

      await pressPrimary(fixture);

      expect(
        store.calls.filter((call) => call.method === 'addPostalCode')
      ).toEqual([]);
    });
  });

  describe('resolving', () => {
    it('sends the point once and writes nothing yet', async () => {
      const { fixture, store } = await render();

      await pressPrimary(fixture);

      expect(
        store.calls.filter((call) => call.method === 'resolvePostalCode')
      ).toEqual([
        { method: 'resolvePostalCode', latitude: 37.88, longitude: -4.78 },
      ]);
      // Section 3.3: the coordinates appear in exactly one request and in no write.
      expect(
        store.calls.filter((call) => call.method === 'addPostalCode')
      ).toEqual([]);
    });

    it('shows the code and announces it, rather than adopting it silently', async () => {
      // The server holds centroids and not boundaries, so somebody at the edge of a
      // large rural code can be resolved into the neighbouring one.
      const { fixture } = await render({ resolvesTo: '14001' });

      await pressPrimary(fixture);

      const region = query(fixture, '.resolved');
      expect(region?.getAttribute('role')).toBe('status');
      expect(query(fixture, '.resolved-code')?.textContent).toContain('14001');
    });

    it('ticks the nearby box, unlike the page’s own add control', async () => {
      const { fixture } = await render();

      await pressPrimary(fixture);

      expect(query<HTMLInputElement>(fixture, '.nearby input')?.checked).toBe(
        true
      );
    });

    it('writes the confirmed code as the device’s, with the neighbours', async () => {
      const { fixture, store, sheets } = await render({ resolvesTo: '14001' });

      await pressPrimary(fixture);
      await pressPrimary(fixture);

      expect(
        store.calls.find((call) => call.method === 'addPostalCode')
      ).toMatchObject({
        body: { postalCode: '14001', source: 'DEVICE', expandNearby: true },
      });
      expect(sheets.leaveTo).toHaveBeenCalled();
    });

    it('writes nothing when the answer is cancelled', async () => {
      const { fixture, store, sheets } = await render();

      await pressPrimary(fixture);
      query<HTMLButtonElement>(fixture, '.cancel')?.click();
      await settle(fixture);

      expect(
        store.calls.filter((call) => call.method === 'addPostalCode')
      ).toEqual([]);
      expect(sheets.leaveTo).not.toHaveBeenCalled();
    });

    it('offers the typed path when the server will not place the point', async () => {
      // Null is an answer and not a failure: it must not read as something broken,
      // and it is not worth retrying.
      const { fixture } = await render({ resolvesTo: null });

      await pressPrimary(fixture);

      expect(text(fixture)).toContain('profiles.location.unplaceable');
      expect(text(fixture)).toContain('profiles.location.typeInstead');
    });

    it('offers another try when the device could not place itself', async () => {
      const { fixture, reader } = await render({
        outcome: { state: 'unavailable' },
      });

      await pressPrimary(fixture);

      expect(text(fixture)).toContain('profiles.location.unavailable');
      // Unlike a refusal, this one is worth pressing again.
      await pressPrimary(fixture);
      expect(reader.state.reads).toBe(2);
    });

    it('treats a timeout as the same offer to try again', async () => {
      const { fixture } = await render({ outcome: { state: 'timed-out' } });

      await pressPrimary(fixture);

      expect(text(fixture)).toContain('profiles.location.unavailable');
    });
  });

  describe('a lookup that could not be made', () => {
    it('says so, and does not claim we cannot place them', async () => {
      // `fakeShoppingProfileStore` throws when no answer was stated, which is the
      // third case: not a refusal, and not the server declining to guess.
      const store = fakeShoppingProfileStore();
      const reader = fakeGeolocationReader();
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [LocationSheet, RokuTranslatorTestingModule.forTesting()],
        providers: [
          provideVelistaTesting({ basePath: '' }),
          provideFakeShoppingProfileStore(store),
          { provide: GEOLOCATION_READER, useValue: reader.reader },
          {
            provide: SheetNavigation,
            useValue: {
              dismiss: jest.fn().mockResolvedValue(undefined),
              leaveTo: jest.fn().mockResolvedValue(undefined),
            },
          },
          { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(LocationSheet);
      fixture.detectChanges();
      await settle(fixture);

      await pressPrimary(fixture);

      expect(text(fixture)).toContain('profiles.location.failed');
      expect(text(fixture)).not.toContain('profiles.location.unplaceable');
    });
  });
});
