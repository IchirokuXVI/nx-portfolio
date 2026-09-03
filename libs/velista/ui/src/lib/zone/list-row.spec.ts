import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ListRowVm } from '@portfolio/velista/models';
import { ListRow } from './list-row';

/**
 * Plan 0060. The row reports how far the shop has got, and it reported it backwards:
 * the number is `wantedCount`, which is what the household still wants, and the key it
 * was passed to said "ready".
 *
 * The assertions are on the **key**, never on the sentence. The testing translator
 * returns the key without interpolating, so an assertion on "7 of 12 pending" would
 * pass whatever the template did.
 */

function listRow(overrides: Partial<ListRowVm> = {}): ListRowVm {
  return { id: 'l1', name: 'Weekly shop', viewers: [], ...overrides };
}

async function render(list: ListRowVm): Promise<ComponentFixture<ListRow>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ListRow, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ListRow);
  fixture.componentRef.setInput('list', list);
  fixture.detectChanges();

  return fixture;
}

function meta(fixture: ComponentFixture<ListRow>): string {
  const element = (fixture.nativeElement as HTMLElement).querySelector('.meta');

  return element?.textContent?.trim() ?? '';
}

describe('ListRow', () => {
  describe('the progress it reports', () => {
    it('counts what is still pending', async () => {
      const fixture = await render(listRow({ lineCount: 12, wantedCount: 7 }));

      expect(meta(fixture)).toBe('home.progress.pending');
    });

    it('says nothing is left rather than 0 of 12 pending', async () => {
      const fixture = await render(listRow({ lineCount: 12, wantedCount: 0 }));

      expect(meta(fixture)).toBe('home.progress.done');
    });

    it('still says the list is empty at zero lines', async () => {
      // A shopped list and a list with nothing on it both have nothing pending, and
      // they stay different sentences (plan 0019, section 3).
      const fixture = await render(listRow({ lineCount: 0, wantedCount: 0 }));

      expect(meta(fixture)).toBe('list.empty.short');
    });

    it('says nothing while the counts have not arrived', async () => {
      // `undefined` is a count that has not been served, and it must not fall into
      // the branch that reads a zero.
      const fixture = await render(listRow());

      expect(meta(fixture)).toBe('');
    });
  });
});
