import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  ReferenceScope,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import type { ReferenceLookup, ReferenceOption } from './reference-lookup';
import { ReferencePicker } from './reference-picker';
import { ReferencesControl } from './references-control';

/**
 * Several uuids, each chosen by name (admin plan 0028, section 3).
 *
 * Microtasks are drained by awaiting rather than by `whenStable`, as the
 * picker's own spec does.
 */

const scopes: ReferenceOption[] = [
  {
    id: 'ps_store',
    title: 'This shop',
    row: { id: 'ps_store', kind: 'STORE' },
  },
  {
    id: 'ps_region',
    title: 'Córdoba',
    row: { id: 'ps_region', kind: 'REGION' },
  },
  {
    id: 'ps_local',
    title: 'Warehouse 4661',
    row: { id: 'ps_local', kind: 'LOCAL_AREA' },
  },
];

function lookupOf(overrides: Partial<ReferenceLookup> = {}): ReferenceLookup {
  return {
    search: async () => scopes,
    resolve: async (_resource, id) =>
      scopes.find((scope) => scope.id === id) ?? null,
    ...overrides,
  };
}

const lockStores = (target: ResourceRow) => target['kind'] === 'STORE';

async function settle(fixture: ComponentFixture<ReferencesControl>) {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

async function render(
  value: readonly string[],
  options: {
    lookup?: ReferenceLookup;
    locks?: ((target: ResourceRow) => boolean) | null;
    scope?: ReferenceScope | null;
  } = {}
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ReferencesControl, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ReferencesControl);
  fixture.componentRef.setInput('controlId', 'field-priceScopeIds');
  fixture.componentRef.setInput('resource', 'price-scopes');
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('lookup', options.lookup ?? lookupOf());
  fixture.componentRef.setInput(
    'locks',
    options.locks === undefined ? lockStores : options.locks
  );
  if (options.scope !== undefined) {
    fixture.componentRef.setInput('scope', options.scope);
  }
  fixture.detectChanges();
  await settle(fixture);

  const emitted: (readonly string[])[] = [];
  fixture.componentInstance.valueChange.subscribe((ids) => emitted.push(ids));

  return { fixture, emitted };
}

function chips(fixture: ComponentFixture<ReferencesControl>): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('li.chip')
  );
}

describe('ReferencesControl', () => {
  it('names every id it holds, in the order it holds them', async () => {
    const { fixture } = await render(['ps_store', 'ps_region']);

    expect(
      chips(fixture).map((chip) => chip.querySelector('.name')?.textContent)
    ).toEqual(['This shop', 'Córdoba']);
  });

  it('removes an id through a real button named after the entry', async () => {
    const { fixture, emitted } = await render(['ps_store', 'ps_region']);

    const button = chips(fixture)[1].querySelector('button');
    expect(button?.getAttribute('type')).toBe('button');
    // The testing translator returns the key, so the observable half is which
    // key names the button; the name itself is what the key interpolates.
    expect(button?.getAttribute('aria-label')).toBe(
      'resource.references.remove'
    );
    expect(fixture.componentInstance.nameOf('ps_region')).toBe('Córdoba');

    button?.click();

    expect(emitted).toEqual([['ps_store']]);
  });

  it('adds what the picker chose', async () => {
    const { fixture, emitted } = await render(['ps_store']);

    fixture.debugElement
      .query(By.directive(ReferencePicker))
      .componentInstance.valueChange.emit('ps_local');

    expect(emitted).toEqual([['ps_store', 'ps_local']]);
  });

  it('refuses an id it already holds', async () => {
    const { fixture, emitted } = await render(['ps_store', 'ps_region']);

    fixture.debugElement
      .query(By.directive(ReferencePicker))
      .componentInstance.valueChange.emit('ps_region');

    expect(emitted).toEqual([]);
  });

  it('draws a locked id without a remove button, and says why', async () => {
    const { fixture, emitted } = await render(['ps_store', 'ps_region']);

    const [store, region] = chips(fixture);
    expect(store.querySelector('button')).toBeNull();
    expect(store.getAttribute('title')).toBe('resource.references.locked');
    expect(region.querySelector('button')).not.toBeNull();
    expect(region.getAttribute('title')).toBeNull();

    fixture.componentInstance.remove('ps_store');
    expect(emitted).toEqual([]);
  });

  it('offers no removal at all until the lookup has answered', async () => {
    let answer: (option: ReferenceOption | null) => void = () => undefined;
    const slow = lookupOf({
      resolve: () =>
        new Promise<ReferenceOption | null>((resolve) => (answer = resolve)),
    });

    const { fixture } = await render(['ps_store'], { lookup: slow });

    expect(chips(fixture)[0].querySelector('button')).toBeNull();
    expect(fixture.componentInstance.removable('ps_store')).toBe(false);

    answer(scopes[0]);
    await settle(fixture);

    expect(chips(fixture)[0].querySelector('button')).toBeNull();
    expect(fixture.componentInstance.isLocked('ps_store')).toBe(true);
  });

  it('lets any entry go when the field locks nothing', async () => {
    const { fixture } = await render(['ps_store'], { locks: null });

    expect(chips(fixture)[0].querySelector('button')).not.toBeNull();
  });

  it('removes an id that points at nothing, since there is nothing to keep', async () => {
    const { fixture } = await render(['ps_gone']);

    expect(chips(fixture)[0].querySelector('.missing')).not.toBeNull();
    expect(chips(fixture)[0].querySelector('button')).not.toBeNull();
  });

  it('sends the scope to the picker, and offers no picker without one', async () => {
    const scope = { supermarketId: 'sm_1', kind: ['REGION'] };
    const scoped = await render([], { scope });

    expect(
      scoped.fixture.debugElement
        .query(By.directive(ReferencePicker))
        .componentInstance.scope()
    ).toEqual(scope);

    const blocked = await render([], { scope: null });

    expect(
      blocked.fixture.debugElement.query(By.directive(ReferencePicker))
    ).toBeNull();
    expect(
      (blocked.fixture.nativeElement as HTMLElement).textContent
    ).toContain('resource.references.needsScope');
  });
});
