import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  pickRowLines,
  ShopList,
  type ShopGroup,
  type ShopListMode,
  type ShopRow,
} from './shop-list';

function shop(id: string, chain: string, name: string | null) {
  return {
    id,
    chain,
    name,
    where: 'Ronda de los Tejares 32, Córdoba',
    postalCode: '14008',
    excluded: false,
    excludedChain: false,
    failed: false,
  };
}

const GROUPS: readonly ShopGroup[] = [
  {
    key: '14008',
    heading: '14008',
    code: null,
    shops: [
      shop('loc-1', 'Mercadona', 'Ronda de los Tejares'),
      shop('loc-2', 'Mercadona', 'Avenida de Barcelona'),
    ],
  },
];

async function render(options: {
  readonly mode: ShopListMode;
  readonly pickedId?: string | null;
}): Promise<ComponentFixture<ShopList>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ShopList, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShopList);
  fixture.componentRef.setInput('groups', GROUPS);
  fixture.componentRef.setInput('mode', options.mode);
  fixture.componentRef.setInput('pickedId', options.pickedId ?? null);
  fixture.detectChanges();

  return fixture;
}

function controls(fixture: ComponentFixture<ShopList>): HTMLInputElement[] {
  return [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll('.checkbox'),
  ] as HTMLInputElement[];
}

/**
 * The pick mode velista `0078` adds, and the exclude mode it already had.
 *
 * The two are one component because the **row** is the same row: the chain leads,
 * the shop's own name follows, the address sits under both. What differs is the
 * question the control asks, and these tests are about that difference alone.
 */
describe('ShopList', () => {
  it('asks about exclusion with checkboxes by default', async () => {
    const fixture = await render({ mode: 'exclude' });

    expect(controls(fixture).map((input) => input.type)).toEqual([
      'checkbox',
      'checkbox',
    ]);
  });

  it('asks which shop with radios under `pick`', async () => {
    const fixture = await render({ mode: 'pick' });

    const inputs = controls(fixture);
    expect(inputs.map((input) => input.type)).toEqual(['radio', 'radio']);
    // One group, so choosing the second unchooses the first without anything in
    // this component having to say so.
    expect(new Set(inputs.map((input) => input.name))).toEqual(
      new Set(['shop-pick'])
    );
  });

  it('checks the picked row and nothing else', async () => {
    const fixture = await render({ mode: 'pick', pickedId: 'loc-2' });

    expect(controls(fixture).map((input) => input.checked)).toEqual([
      false,
      true,
    ]);
  });

  it('emits the shop that was picked, and never `toggle`', async () => {
    const fixture = await render({ mode: 'pick' });
    const picked: string[] = [];
    const toggled: string[] = [];
    fixture.componentInstance.pick.subscribe((id) => picked.push(id));
    fixture.componentInstance.toggled.subscribe((id) => toggled.push(id));

    controls(fixture)[1].click();

    expect(picked).toEqual(['loc-2']);
    expect(toggled).toEqual([]);
  });

  /**
   * The exclusion marks are a **profile's** preferences, and the picker is not a
   * screen about preferences: a dimmed row there would say the shop is refused when
   * what is being asked is where the reader is standing.
   */
  it('draws no exclusion marks under `pick`', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ShopList, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ShopList);
    fixture.componentRef.setInput('groups', [
      {
        ...GROUPS[0],
        shops: [{ ...shop('loc-1', 'Mercadona', null), excluded: true }],
      },
    ]);
    fixture.componentRef.setInput('mode', 'pick');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.mark')).toBeNull();
    expect(element.querySelector('.row.excluded')).toBeNull();
  });
});

/**
 * The pick row (velista `0124`, target 3): the title is the shop's own name or
 * its street, the chain and the address go under it, the logo leads only where
 * the chains are mixed, and the sections sit outside the label.
 */
describe('pickRowLines', () => {
  const base: ShopRow = {
    ...shop('loc-1', 'Mercadona', null),
    where: 'Calle Mayor 3, Córdoba',
    street: 'Calle Mayor 3',
    town: 'Córdoba',
  };

  it('leads with the street, and names the town under it, when the shop has no name', () => {
    expect(pickRowLines(base, true)).toEqual({
      title: 'Calle Mayor 3',
      detail: 'Mercadona · Córdoba',
    });
    expect(pickRowLines(base, false)).toEqual({
      title: 'Calle Mayor 3',
      detail: 'Córdoba',
    });
  });

  it('leads with the shop’s own name, and puts the whole address under it', () => {
    expect(pickRowLines({ ...base, name: 'Deza Ciudad Jardín' }, true)).toEqual(
      {
        title: 'Deza Ciudad Jardín',
        detail: 'Mercadona · Calle Mayor 3, Córdoba',
      }
    );
  });
});

describe('ShopList, the pick row', () => {
  async function renderRow(
    row: ShopRow,
    mixed: boolean
  ): Promise<ComponentFixture<ShopList>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ShopList, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ShopList);
    fixture.componentRef.setInput('groups', [
      { key: 'one', heading: '', code: null, shops: [row] },
    ]);
    fixture.componentRef.setInput('mode', 'pick');
    fixture.componentRef.setInput('grouped', false);
    fixture.componentRef.setInput('mixed', mixed);
    fixture.detectChanges();
    return fixture;
  }

  const row: ShopRow = {
    ...shop('loc-1', 'Mercadona', null),
    street: 'Calle Mayor 3',
    town: 'Córdoba',
    logo: { logoUrl: null, name: 'Mercadona', store: false },
    sections: [
      { id: 's1', name: 'Fruit and veg' },
      { id: 's2', name: 'Butcher' },
    ],
  };

  it('leads with the logo where the chains are mixed, and not inside one chain', async () => {
    const mixed = await renderRow(row, true);
    expect(
      (mixed.nativeElement as HTMLElement).querySelector(
        'label.row lib-chain-logo'
      )
    ).not.toBeNull();

    const single = await renderRow(row, false);
    expect(
      (single.nativeElement as HTMLElement).querySelector('lib-chain-logo')
    ).toBeNull();
  });

  it('draws the sections beside the label, never inside it', async () => {
    const fixture = await renderRow(row, true);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('label.row lib-section-chips')).toBeNull();
    expect(element.querySelector('.pick > lib-section-chips')).not.toBeNull();
  });

  it('draws no line of sections for a shop with none', async () => {
    const fixture = await renderRow({ ...row, sections: [] }, true);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('lib-section-chips')
    ).toBeNull();
  });

  /** Velista `0121`, target 1: the round button that opens the shop's page. */
  it('offers the shop’s own page beside the label, named for the shop', async () => {
    const fixture = await renderRow(row, false);
    const element = fixture.nativeElement as HTMLElement;
    const button = element.querySelector<HTMLButtonElement>(
      '.pick > .pick-about'
    );

    expect(element.querySelector('label.row .pick-about')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('shops.row.about');
    expect(button?.type).toBe('button');
  });

  it('opens the shop’s page from the button and never picks the shop', async () => {
    const fixture = await renderRow(row, false);
    const about: string[] = [];
    const picked: string[] = [];
    fixture.componentInstance.about.subscribe((id) => about.push(id));
    fixture.componentInstance.pick.subscribe((id) => picked.push(id));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.pick-about')
      ?.click();

    expect(about).toEqual(['loc-1']);
    expect(picked).toEqual([]);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.pick-radio'
      )?.checked
    ).toBe(false);
  });

  it('draws no button on the rows that ask about exclusion', async () => {
    const fixture = await render({ mode: 'exclude' });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.pick-about')
    ).toBeNull();
  });
});
