import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  ListHeaderVm,
  ListRowVm,
  ZoneCardVm,
} from '@portfolio/velista/models';
import { ZoneCard } from './home/zone-card';
import { ListHeader } from './list/list-header';
import { ListRow } from './zone/list-row';

/**
 * Plan 0019, section 3. An empty list rendered "0 of 0 ready", which is a sentence
 * about progress through a shop nobody has written down: arithmetically true and read
 * as a bug.
 *
 * The three surfaces are tested together because the rule is one rule and applying it
 * to two of them would be a fresh inconsistency rather than a fix. The resume card is
 * not here: its progress block already sits behind a computed that returns null at
 * zero lines, so it draws neither bar nor sentence and needed no change.
 *
 * The assertion that matters in every case is the **pair**: zero says the list is
 * empty, and `undefined` still says nothing at all. Collapsing the two into one falsy
 * check is the mistake this file exists to catch, and it would pass a test that only
 * looked at zero.
 *
 * The translator double returns the key, so these read as key names rather than copy.
 */

async function render<T>(component: new (...args: never[]) => T) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [component, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  return TestBed.createComponent(component);
}

function text(fixture: ComponentFixture<unknown>, selector: string): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ).map((element) => element.textContent?.trim() ?? '');
}

function listRow(overrides: Partial<ListRowVm> = {}): ListRowVm {
  return { id: 'l1', name: 'Weekly shop', ...overrides };
}

function card(lists: readonly ListRowVm[]): ZoneCardVm {
  return {
    id: 'z1',
    name: 'Flat 3B',
    initial: 'F',
    role: 'OWNER',
    membership: 'APPROVED',
    memberCount: 3,
    listCount: lists.length,
    lists,
    tappable: true,
  };
}

function header(overrides: Partial<ListHeaderVm> = {}): ListHeaderVm {
  return {
    listName: 'Weekly shop',
    zoneName: 'Flat 3B',
    readyCount: 0,
    lineCount: 0,
    live: true,
    ...overrides,
  };
}

describe('an empty list says so, and an unknown one says nothing', () => {
  describe('a list inside a zone card', () => {
    async function renderCard(lists: readonly ListRowVm[]) {
      const fixture = await render(ZoneCard);
      fixture.componentRef.setInput('zone', card(lists));
      fixture.detectChanges();
      return fixture;
    }

    it('reads "list is empty" at zero lines', async () => {
      const fixture = await renderCard([
        listRow({ lineCount: 0, readyCount: 0 }),
      ]);

      expect(text(fixture, '.list-progress')).toEqual(['list.empty.short']);
    });

    it('reads the progress when there is something to be through', async () => {
      const fixture = await renderCard([
        listRow({ lineCount: 12, readyCount: 7 }),
      ]);

      expect(text(fixture, '.list-progress')).toEqual(['home.progress.ready']);
    });

    it('renders nothing while the counts have not arrived', async () => {
      const fixture = await renderCard([listRow()]);

      expect(text(fixture, '.list-progress')).toEqual([]);
      expect(text(fixture, '.list-meta')).toEqual([]);
    });
  });

  describe('a list row on the group page', () => {
    async function renderRow(list: ListRowVm) {
      const fixture = await render(ListRow);
      fixture.componentRef.setInput('list', list);
      fixture.detectChanges();
      return fixture;
    }

    it('reads "list is empty" at zero lines', async () => {
      const fixture = await renderRow(listRow({ lineCount: 0, readyCount: 0 }));

      expect(text(fixture, '.meta')).toEqual(['list.empty.short']);
    });

    it('reads the progress when there is something to be through', async () => {
      const fixture = await renderRow(
        listRow({ lineCount: 12, readyCount: 7 })
      );

      expect(text(fixture, '.meta')).toEqual(['home.progress.ready']);
    });

    it('renders nothing while the counts have not arrived', async () => {
      const fixture = await renderRow(listRow());

      expect(text(fixture, '.meta')).toEqual([]);
    });
  });

  describe('the list page header', () => {
    async function renderHeader(vm: ListHeaderVm) {
      const fixture = await render(ListHeader);
      fixture.componentRef.setInput('header', vm);
      fixture.detectChanges();
      return fixture;
    }

    it('reads "list is empty" and draws no bar', async () => {
      const fixture = await renderHeader(header({ lineCount: 0 }));

      expect(text(fixture, '.progress-line')).toEqual(['list.empty.short']);
      // An empty bar under an empty list is decoration that describes nothing.
      expect(text(fixture, '.progress')).toEqual([]);
    });

    it('reads the progress and draws the bar once there are lines', async () => {
      const fixture = await renderHeader(
        header({ lineCount: 12, readyCount: 7 })
      );

      expect(text(fixture, '.progress-line')).toEqual(['list.header.ready']);
      expect(text(fixture, '.progress')).toHaveLength(1);
    });
  });
});
