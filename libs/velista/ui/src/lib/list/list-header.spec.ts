import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ListHeaderVm } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ListHeader } from './list-header';

function header(overrides: Partial<ListHeaderVm> = {}): ListHeaderVm {
  return {
    listName: 'Weekly shop',
    zoneName: 'Home',
    wantedCount: 3,
    lineCount: 7,
    viewers: [],
    live: true,
    ...overrides,
  };
}

async function render(
  vm: ListHeaderVm = header()
): Promise<ComponentFixture<ListHeader>> {
  await TestBed.configureTestingModule({
    imports: [ListHeader, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ListHeader);
  fixture.componentRef.setInput('header', vm);
  fixture.detectChanges();

  return fixture;
}

function host(fixture: ComponentFixture<ListHeader>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('ListHeader', () => {
  describe('the not-live notice', () => {
    it('says nothing while the list is live', async () => {
      const fixture = await render();

      expect(host(fixture).querySelector('.stale')).toBeNull();
    });

    it('names the state, with its glyph, when the list is not live', async () => {
      // It stays beside the app bar's offline mark rather than being replaced by it
      // (plan 0035, section 5.3): this one is about **this list**, and it is true when
      // the zone room was refused while the socket is perfectly fine. The mark is about
      // the connection and this is about the screen.
      const fixture = await render(header({ live: false }));

      const notice = host(fixture).querySelector('.stale');
      expect(notice?.textContent).toContain('list.header.notLive');
      expect(notice?.querySelector('lib-offline-icon')).not.toBeNull();
    });
  });

  describe('the progress', () => {
    it('says a list with nothing on it is empty rather than 0 of 0', async () => {
      // "0 of 0 pending" describes progress through a shop nobody has written down,
      // and an empty bar under it describes nothing (plan 0019, section 3).
      const fixture = await render(header({ wantedCount: 0, lineCount: 0 }));

      expect(host(fixture).textContent).toContain('list.empty.short');
      expect(host(fixture).querySelector('.progress')).toBeNull();
    });

    it('fills the bar from the lines the page is holding', async () => {
      const fixture = await render(header({ wantedCount: 3, lineCount: 4 }));

      // One of the four is done, so the bar is a quarter full.
      expect(fixture.componentInstance.percent()).toBe(25);
      expect(
        host(fixture).querySelector<HTMLElement>('.progress-fill')?.style
          .inlineSize
      ).toBe('25%');
    });

    // Plan 0060. `wantedCount` counts what the household still wants, and the bar
    // used to divide by it directly: full before the shop and empty after it. The two
    // ends are where an inversion shows, and either of them is the assertion that
    // failed before the fix.
    it('draws an empty bar for a list nothing has been bought from', async () => {
      const fixture = await render(header({ wantedCount: 12, lineCount: 12 }));

      expect(fixture.componentInstance.percent()).toBe(0);
    });

    it('draws a full bar for a list that has been shopped', async () => {
      const fixture = await render(header({ wantedCount: 0, lineCount: 12 }));

      expect(fixture.componentInstance.percent()).toBe(100);
    });

    it('rounds the part way case', async () => {
      const fixture = await render(header({ wantedCount: 5, lineCount: 12 }));

      expect(fixture.componentInstance.percent()).toBe(58);
    });

    it('says the count is what is still pending', async () => {
      // The translator double returns the key, so this reads as a key name. The
      // interpolated number is not asserted here for the reason the testing translator
      // gives: it does not interpolate, so an assertion on "7 of 12 pending" would
      // pass on nothing.
      const fixture = await render(header({ wantedCount: 7, lineCount: 12 }));

      expect(
        host(fixture).querySelector('.progress-line')?.textContent?.trim()
      ).toBe('list.header.pending');
    });

    it('says "nothing left" rather than 0 of 12 pending', async () => {
      // Plan 0060, section 3.1. The bar is full behind it either way.
      const fixture = await render(header({ wantedCount: 0, lineCount: 12 }));

      expect(
        host(fixture).querySelector('.progress-line')?.textContent?.trim()
      ).toBe('list.header.done');
      expect(host(fixture).querySelector('.progress')).not.toBeNull();
    });
  });
});
