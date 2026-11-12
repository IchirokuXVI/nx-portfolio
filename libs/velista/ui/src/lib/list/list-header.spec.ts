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
  // Velista `0130`: a header holds only a title, and the page's `PageHeader` holds it.
  // What is left here is the first block of the content.
  describe('content under the page header', () => {
    it('draws no heading, no header element and no button of its own', async () => {
      const fixture = await render();

      expect(host(fixture).querySelector('h1, header, button')).toBeNull();
      // The name is the page header's title, so it is not said a second time here.
      expect(host(fixture).textContent).not.toContain('Weekly shop');
    });

    it('says which group the list is in, as its first line', async () => {
      const fixture = await render();

      expect(host(fixture).firstElementChild?.matches('p.in-group')).toBe(true);
      expect(host(fixture).firstElementChild?.textContent?.trim()).toBe(
        'list.header.inGroup'
      );
    });

    it('starts on the viewers while the group is not known', async () => {
      const fixture = await render(header({ listName: null, zoneName: null }));

      expect(host(fixture).querySelector('.in-group')).toBeNull();
      expect(host(fixture).querySelector('.name-skeleton')).toBeNull();
      expect(host(fixture).firstElementChild?.matches('lib-list-viewers')).toBe(
        true
      );
    });
  });

  describe('the not-live notice', () => {
    it('says nothing while the list is live', async () => {
      const fixture = await render();

      expect(host(fixture).querySelector('.stale')).toBeNull();
    });

    it('names the state, with its glyph, when the zone room was refused', async () => {
      // `live` is false only for a refusal since plan 0168 (D7): this band is about
      // **this list**, and it is true when the zone room was refused while the socket
      // is perfectly fine. A plain disconnect is the page header's mark, on every
      // page, and the list page keeps `live` true for it (`list-page.spec.ts`).
      const fixture = await render(header({ live: false }));

      const notice = host(fixture).querySelector('.stale');
      expect(notice?.textContent).toContain('list.header.notLive');
      expect(notice?.querySelector('lib-offline-icon')).not.toBeNull();
    });
  });

  // Velista `0189`: the progress is drawn nowhere for now. The numbers stay in the
  // view model (decision K); only the drawing went.
  describe('no progress', () => {
    it('draws no count line, no cost and no bar, whatever the counts', async () => {
      for (const counts of [
        { wantedCount: 0, lineCount: 0 },
        { wantedCount: 7, lineCount: 12 },
        { wantedCount: 0, lineCount: 12 },
      ]) {
        TestBed.resetTestingModule();
        const fixture = await render(
          header({ ...counts, cost: '14,29 €', costEstimated: true })
        );

        expect(host(fixture).querySelector('.progress-line')).toBeNull();
        expect(host(fixture).querySelector('.progress')).toBeNull();
        expect(host(fixture).querySelector('.cost')).toBeNull();
        expect(host(fixture).textContent).not.toContain('14,29');
      }
    });
  });
});
