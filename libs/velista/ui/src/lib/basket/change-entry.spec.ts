import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';
import { ChangeEntry, type ChangeEntryView } from './change-entry';

/**
 * One entry of the changes sheet (velista `0093`, section 6).
 *
 * The component decides nothing: the sentence, the name, the list and the time
 * are all resolved before they reach it. What is worth asserting is that it
 * **offers no control** and that its second line disappears rather than drawing
 * an empty muted row for a guest who is served none of the three.
 */
function view(over: Partial<ChangeEntryView> = {}): ChangeEntryView {
  return {
    id: 'chg-1',
    key: 'basket.changes.entry.renamed',
    args: { name: 'Milk', before: 'Leche' },
    who: 'Dani',
    list: 'in Weekly shop',
    origin: null,
    when: '1 Sep 2026, 09:00',
    unseen: false,
    ...over,
  };
}

async function render(entry: ChangeEntryView) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ChangeEntry, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ChangeEntry);
  fixture.componentRef.setInput('entry', entry);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ChangeEntry', () => {
  it('draws the sentence it was handed, and nothing to press', async () => {
    const host = await render(view());

    expect(host.querySelector('.what')?.textContent).toContain(
      'basket.changes.entry.renamed'
    );
    // A change is a fact, and the row it is about is one dismiss away.
    expect(host.querySelectorAll('button, a')).toHaveLength(0);
  });

  it('joins who, which list and when into one muted line', async () => {
    const host = await render(view());

    expect(host.querySelector('.meta')?.textContent?.trim()).toBe(
      'Dani · in Weekly shop · 1 Sep 2026, 09:00'
    );
  });

  it('draws no second line at all for a reader served none of the three', async () => {
    // A guest. An empty muted row under every entry is a sheet that looks
    // broken to the reader it is redacted for.
    const host = await render(view({ who: '', list: '', when: '' }));

    expect(host.querySelector('.meta')).toBeNull();
  });

  it('leaves the separator out where a piece is missing', async () => {
    const host = await render(view({ list: '' }));

    expect(host.querySelector('.meta')?.textContent?.trim()).toBe(
      'Dani · 1 Sep 2026, 09:00'
    );
  });

  it('wears the same tag a marked row does when the server says it is new', async () => {
    const host = await render(view({ unseen: true }));

    expect(host.querySelector('.tag')?.textContent).toContain(
      'basket.mark.added'
    );
    expect(host.querySelector('.tag-dot')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('wears none when the server says it has been seen', async () => {
    const host = await render(view({ unseen: false }));

    expect(host.querySelector('.tag')).toBeNull();
  });
});

/**
 * The sentences and the origin lines of a buy (velista `0142`, section 4), read
 * in both languages from the assets the app ships, so a key that is missing or
 * misspelt in one file fails here and not on somebody's phone.
 */
describe('ChangeEntry: a buy, in both languages (velista 0142)', () => {
  const FILES: Record<string, unknown> = { en, es };

  /** The asset's own string, with its `{{values}}` filled, as i18next fills them. */
  function translate(
    lang: string,
    key: string,
    values: Record<string, unknown> = {}
  ): string {
    const found = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          typeof node === 'object' && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        FILES[lang]
      );
    if (typeof found !== 'string') {
      throw new Error(`${lang} has no string at ${key}`);
    }
    return found.replace(/\{\{(\w+)\}\}/g, (_all, name: string) =>
      String(values[name])
    );
  }

  async function read(lang: string, entry: ChangeEntryView) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ChangeEntry, RokuTranslatorTestingModule.forTesting()],
      providers: [
        {
          provide: RokuTranslatorService,
          useValue: {
            locale: signal(lang),
            loaded: signal(true),
            t: (
              key: string,
              _ns?: string,
              _locale?: string,
              values?: Record<string, unknown>
            ) => translate(lang, key, values),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ChangeEntry);
    fixture.componentRef.setInput('entry', entry);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return {
      what: host.querySelector('.what')?.textContent?.trim(),
      meta: host.querySelector('.meta')?.textContent?.trim(),
    };
  }

  it.each([
    [
      'en',
      'basket.changes.entry.bought',
      { name: 'Milk', after: 2 },
      '“Milk” was bought. You need 2 now',
    ],
    [
      'es',
      'basket.changes.entry.bought',
      { name: 'Leche', after: 2 },
      'Se compró «Leche». Ahora necesitas 2',
    ],
    [
      'en',
      'basket.changes.entry.boughtAll',
      { name: 'Milk' },
      '“Milk” was bought. You do not need it now',
    ],
    [
      'es',
      'basket.changes.entry.boughtAll',
      { name: 'Leche' },
      'Se compró «Leche». Ya no lo necesitas',
    ],
    [
      'en',
      'basket.changes.entry.buyReverted',
      { name: 'Milk', after: 3 },
      'A buy of “Milk” was undone. You need 3 now',
    ],
    [
      'es',
      'basket.changes.entry.buyReverted',
      { name: 'Leche', after: 3 },
      'Se deshizo una compra de «Leche». Ahora necesitas 3',
    ],
  ])('reads %s %s as the sentence', async (lang, key, args, said) => {
    const { what } = await read(lang, view({ key, args }));

    expect(what).toBe(said);
  });

  it.each([
    [
      'en',
      'anotherBasket',
      { name: 'Ana' },
      'Modified from a shopping list of Ana',
    ],
    [
      'es',
      'anotherBasket',
      { name: 'Ana' },
      'Modificado desde una lista de la compra de Ana',
    ],
    [
      'en',
      'anotherBasketYours',
      {},
      'Modified from another shopping list of yours',
    ],
    [
      'es',
      'anotherBasketYours',
      {},
      'Modificado desde otra de tus listas de la compra',
    ],
    [
      'en',
      'anotherBasketSomeone',
      {},
      'Modified from a shopping list of someone',
    ],
    [
      'es',
      'anotherBasketSomeone',
      {},
      'Modificado desde la lista de la compra de alguien',
    ],
    ['en', 'list', { name: 'Ana' }, 'Bought from the list by Ana'],
    ['es', 'list', { name: 'Ana' }, 'Comprado desde la lista por Ana'],
    ['en', 'listYou', {}, 'Bought from the list by you'],
    ['es', 'listYou', {}, 'Comprado desde la lista por ti'],
    ['en', 'listSomeone', {}, 'Bought from the list by someone'],
    ['es', 'listSomeone', {}, 'Comprado desde la lista por alguien'],
  ])(
    'reads %s origin %s in place of who and the list',
    async (lang, key, args, said) => {
      const { meta } = await read(
        lang,
        view({
          key: 'basket.changes.entry.bought',
          args: { name: 'Milk', after: 1 },
          who: 'Dani',
          list: 'in Weekly shop',
          origin: { key: `basket.changes.origin.${key}`, args },
          when: '1 Sep 2026, 09:00',
        })
      );

      expect(meta).toBe(`${said} · 1 Sep 2026, 09:00`);
    }
  );

  /** A guest is served no owner and no buyer, and is told someone. */
  it('tells a guest someone, and names no list', async () => {
    const { meta } = await read(
      'en',
      view({
        key: 'basket.changes.entry.boughtAll',
        args: { name: 'Milk' },
        who: '',
        list: '',
        origin: { key: 'basket.changes.origin.anotherBasketSomeone', args: {} },
        when: '',
      })
    );

    expect(meta).toBe('Modified from a shopping list of someone');
  });
});
