import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ShopMapStore } from '@portfolio/velista/data-access';
import { settle, shopMapTesting } from '../shop-map.testing';
import { PlaceSheet } from './place-sheet';

const SHOP = 'loc-tejares';

async function render(
  params: Record<string, string>,
  options: { query?: Record<string, string>; open?: boolean } = {}
) {
  TestBed.resetTestingModule();
  const harness = shopMapTesting({
    params: { locationId: SHOP, ...params },
    query: options.query,
  });
  await TestBed.configureTestingModule({
    imports: [PlaceSheet, RokuTranslatorTestingModule.forTesting()],
    providers: harness.providers,
  }).compileComponents();
  const maps = TestBed.inject(ShopMapStore);
  // The map page opens the map; the sheet reads what it holds.
  if (options.open !== false) {
    await maps.open(SHOP, null);
  }
  const map = maps.map();
  const fixture = TestBed.createComponent(PlaceSheet);
  fixture.detectChanges();
  await settle(() => fixture.detectChanges());
  return { fixture, map, ...harness };
}

function text(fixture: ComponentFixture<PlaceSheet>, selector: string) {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/** The areas of the memory map, to pick the ones the sheet is for. */
async function areasOfTheMap() {
  const { map } = await render({ areaId: 'none' });
  if (map === null) {
    throw new Error('the memory map must read');
  }
  return map;
}

/** Velista `0129`, target 6: a place that is not a section the shop knows. */
describe('PlaceSheet', () => {
  it('names an area by the name the mapper gave it, with the word for its kind under it', async () => {
    const map = await areasOfTheMap();
    // A shelf of a section, which the page sends here when the shop does not
    // list that section.
    const named = map.document.areas.find(
      (area) => (area.label ?? area.section ?? '').trim() !== ''
    );
    if (named === undefined) {
      throw new Error('the memory map must hold a named area');
    }

    const { fixture } = await render({ areaId: named.id });

    expect(text(fixture, '.title')).toEqual([named.label ?? named.section]);
    expect(text(fixture, '.detail')).toEqual([
      `shopMap.place.kind.${named.kind}`,
    ]);
    expect(text(fixture, '.note')).toEqual([]);
  });

  it('names an area with no name by the word for its kind, once', async () => {
    const map = await areasOfTheMap();
    const bare = map.document.areas.find(
      (area) =>
        area.label === undefined &&
        area.section === undefined &&
        area.kind !== 'path' &&
        area.kind !== 'blocked'
    );
    if (bare === undefined) {
      throw new Error('the memory map must hold an area with no name');
    }

    const { fixture } = await render({ areaId: bare.id });

    expect(text(fixture, '.title')).toEqual([
      `shopMap.place.kind.${bare.kind}`,
    ]);
    expect(text(fixture, '.detail')).toEqual([]);
  });

  it('shows a note’s text under the word Note', async () => {
    const map = await areasOfTheMap();
    const note = map.notes[0];

    const { fixture } = await render({ noteId: note.id });

    expect(text(fixture, '.title')).toEqual(['shopMap.place.note']);
    expect(text(fixture, '.note-text')).toEqual([note.text]);
    expect(text(fixture, '.detail')).toEqual([]);
  });

  it('says a place that is gone is not on the map', async () => {
    const gone = await render({ areaId: 'gone' });
    expect(text(gone.fixture, '.title')).toEqual(['shopMap.place.missing']);

    const noNote = await render({ noteId: 'gone' });
    expect(text(noNote.fixture, '.title')).toEqual(['shopMap.place.missing']);
  });

  it('says nothing yet while the map is still being read', async () => {
    const { fixture } = await render({ areaId: 'a' }, { open: false });

    expect(text(fixture, '.title')).toEqual(['']);
  });

  it('falls back to the map it covers, keeping the basket it counts from', async () => {
    const plain = await render({ areaId: 'a' });
    await plain.fixture.componentInstance.dismiss();
    expect(plain.sheets.dismiss).toHaveBeenCalledWith(`/en/shops/${SHOP}/map`);

    const counted = await render(
      { areaId: 'a' },
      { query: { basket: 'live' } }
    );
    await counted.fixture.componentInstance.dismiss();
    expect(counted.sheets.dismiss).toHaveBeenCalledWith(
      `/en/shops/${SHOP}/map?basket=live`
    );
  });
});
