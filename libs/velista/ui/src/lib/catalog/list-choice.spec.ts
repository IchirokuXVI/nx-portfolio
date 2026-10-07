import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type { AddTargetList } from '@portfolio/velista/models';
import { ListChoice } from './list-choice';

/**
 * Which list does the plus add to? (velista `0134`, section 4.3): every list the
 * person can write to, under the name of its group, and a press chooses.
 */
function list(
  listId: string,
  zoneId: string,
  name: string,
  zoneName: string,
  wanted: number
): AddTargetList {
  return { listId, zoneId, name, zoneName, wanted, permissions: ['WRITE'] };
}

const WEEKLY = list('l1', 'z1', 'Weekly shop', 'Home', 14);
const BARBECUE = list('l2', 'z1', 'Barbecue', 'Home', 0);
const OFFICE = list('l3', 'z2', 'Office snacks', 'Work', 1);

const LISTS: readonly AddTargetList[] = [WEEKLY, BARBECUE, OFFICE];

/** Every translator call of the render, to read the values a caption was given. */
let asked: jest.SpyInstance;

async function render(
  lists: readonly AddTargetList[] = LISTS,
  selectedId: string | null = null
): Promise<ComponentFixture<ListChoice>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ListChoice, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();
  asked = jest.spyOn(TestBed.inject(RokuTranslatorService), 't');

  const fixture = TestBed.createComponent(ListChoice);
  fixture.componentRef.setInput('lists', lists);
  fixture.componentRef.setInput('selectedId', selectedId);
  fixture.componentRef.setInput('labelledBy', 'sheet-title');
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function host(fixture: ComponentFixture<ListChoice>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function radios(fixture: ComponentFixture<ListChoice>): HTMLButtonElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];
}

function radio(
  fixture: ComponentFixture<ListChoice>,
  listId: string
): HTMLButtonElement {
  return host(fixture).querySelector(
    `[data-list="${listId}"]`
  ) as HTMLButtonElement;
}

/** The group names and the list names, as one reads them down the sheet. */
function outline(fixture: ComponentFixture<ListChoice>): string[] {
  return [...host(fixture).querySelectorAll('.group, .option .name')].map(
    (one) =>
      `${one.classList.contains('group') ? 'group' : 'list'}: ${one.textContent?.trim()}`
  );
}

describe('ListChoice', () => {
  it('draws each list under the name of its group, in the order given', async () => {
    const fixture = await render();

    expect(outline(fixture)).toEqual([
      'group: Home',
      'list: Weekly shop',
      'list: Barbecue',
      'group: Work',
      'list: Office snacks',
    ]);
  });

  it('names a group once, even when its lists do not arrive together', async () => {
    const fixture = await render([WEEKLY, OFFICE, BARBECUE]);

    expect(outline(fixture)).toEqual([
      'group: Home',
      'list: Weekly shop',
      'list: Barbecue',
      'group: Work',
      'list: Office snacks',
    ]);
  });

  it('keeps two groups of the same name apart', async () => {
    const fixture = await render([
      WEEKLY,
      list('l9', 'z9', 'Camping', 'Home', 2),
    ]);

    expect(outline(fixture)).toEqual([
      'group: Home',
      'list: Weekly shop',
      'group: Home',
      'list: Camping',
    ]);
  });

  it('draws nothing for no lists', async () => {
    const fixture = await render([]);

    expect(radios(fixture)).toHaveLength(0);
    expect(host(fixture).querySelector('.group')).toBeNull();
  });

  it('is one group of radios named by the sheet title', async () => {
    const fixture = await render();

    const group = host(fixture).querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-labelledby')).toBe('sheet-title');
    expect(group?.querySelectorAll('[role="radio"]')).toHaveLength(3);
  });

  it('checks the chosen list, and only that one', async () => {
    const fixture = await render(LISTS, 'l2');

    expect(
      radios(fixture).map((one) => one.getAttribute('aria-checked'))
    ).toEqual(['false', 'true', 'false']);
    expect(radio(fixture, 'l2').classList.contains('is-on')).toBe(true);
    expect(radio(fixture, 'l1').classList.contains('is-on')).toBe(false);
  });

  it('checks nothing while no list is chosen', async () => {
    const fixture = await render();

    expect(
      radios(fixture).map((one) => one.getAttribute('aria-checked'))
    ).toEqual(['false', 'false', 'false']);
  });

  it('moves the mark when the choice changes', async () => {
    const fixture = await render(LISTS, 'l1');

    fixture.componentRef.setInput('selectedId', 'l3');
    fixture.detectChanges();

    expect(
      radios(fixture).map((one) => one.getAttribute('aria-checked'))
    ).toEqual(['false', 'false', 'true']);
  });

  it('says how many lines each list still wants', async () => {
    const fixture = await render();

    for (const one of radios(fixture)) {
      expect(one.querySelector('.caption')?.textContent).toContain(
        'catalog.lists.toBuy'
      );
    }
    const counts = asked.mock.calls
      .filter((call) => call[0] === 'catalog.lists.toBuy')
      .map((call) => (call[3] as { count: number }).count);
    expect(new Set(counts)).toEqual(new Set([14, 0, 1]));
  });

  it('says which list was chosen', async () => {
    const fixture = await render(LISTS, 'l1');
    const picked: string[] = [];
    fixture.componentInstance.chosen.subscribe((id) => picked.push(id));

    radio(fixture, 'l3').click();

    expect(picked).toEqual(['l3']);
  });

  it('says the chosen list again on a press on it, so the sheet still closes', async () => {
    const fixture = await render(LISTS, 'l1');
    const picked: string[] = [];
    fixture.componentInstance.chosen.subscribe((id) => picked.push(id));

    radio(fixture, 'l1').click();

    expect(picked).toEqual(['l1']);
  });
});
