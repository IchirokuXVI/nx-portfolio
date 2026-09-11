import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ShopList, type ShopGroup, type ShopListMode } from './shop-list';

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
