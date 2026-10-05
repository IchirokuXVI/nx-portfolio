import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  ReferenceScope,
  ResourceRow,
  ScopeMarkView,
} from '@portfolio/luna-shopper-admin/models';
import {
  fieldMessage,
  type FieldMessage,
} from '@portfolio/luna-shopper-admin/models';
import { ScopeMark } from '../page/scope-mark';
import type { ReferenceLookup, ReferenceOption } from './reference-lookup';
import { ReferencePicker } from './reference-picker';
import { ReferencesControl } from './references-control';

/**
 * Several uuids, each chosen by name (admin plan 0028, section 3), one row
 * each (admin plan 0052, section 3.6).
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

async function settle(fixture: ComponentFixture<unknown>) {
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
    ordered?: boolean;
    addKey?: string;
    marks?: (target: ResourceRow) => ScopeMarkView | undefined;
    names?: (target: ResourceRow) => FieldMessage | undefined;
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
  if (options.ordered !== undefined) {
    fixture.componentRef.setInput('ordered', options.ordered);
  }
  if (options.marks !== undefined) {
    fixture.componentRef.setInput('marks', options.marks);
  }
  if (options.addKey !== undefined) {
    fixture.componentRef.setInput('addKey', options.addKey);
  }
  if (options.names !== undefined) {
    fixture.componentRef.setInput('names', options.names);
  }
  fixture.detectChanges();
  await settle(fixture);

  const emitted: (readonly string[])[] = [];
  fixture.componentInstance.valueChange.subscribe((ids) => emitted.push(ids));

  return { fixture, emitted };
}

function rows(fixture: ComponentFixture<unknown>): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('li.row')
  );
}

function names(fixture: ComponentFixture<unknown>): (string | undefined)[] {
  return rows(fixture).map((row) =>
    row.querySelector('.name')?.textContent?.trim()
  );
}

function removeOf(row: HTMLElement): HTMLButtonElement | null {
  return row.querySelector('[data-remove]');
}

function moveOf(row: HTMLElement, direction: 'up' | 'down'): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>(
    `[data-move="${direction}"]`
  );
  if (button === null) {
    throw new Error(`the row has no button that moves it ${direction}`);
  }
  return button;
}

describe('ReferencesControl', () => {
  it('names every id it holds, one row each, in the order it holds them', async () => {
    const { fixture } = await render(['ps_store', 'ps_region']);

    expect(names(fixture)).toEqual(['This shop', 'Córdoba']);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.chip')
    ).toBeNull();
  });

  it('removes an id through a real button named after the entry', async () => {
    const { fixture, emitted } = await render(['ps_store', 'ps_region']);

    const button = removeOf(rows(fixture)[1]);
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

    const [store, region] = rows(fixture);
    expect(removeOf(store)).toBeNull();
    expect(store.getAttribute('title')).toBe('resource.references.locked');
    expect(removeOf(region)).not.toBeNull();
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

    expect(removeOf(rows(fixture)[0])).toBeNull();
    expect(fixture.componentInstance.removable('ps_store')).toBe(false);

    answer(scopes[0]);
    await settle(fixture);

    expect(removeOf(rows(fixture)[0])).toBeNull();
    expect(fixture.componentInstance.isLocked('ps_store')).toBe(true);
  });

  it('lets any entry go when the field locks nothing', async () => {
    const { fixture } = await render(['ps_store'], { locks: null });

    expect(removeOf(rows(fixture)[0])).not.toBeNull();
  });

  it('removes an id that points at nothing, since there is nothing to keep', async () => {
    const { fixture } = await render(['ps_gone']);

    expect(rows(fixture)[0].querySelector('.missing')).not.toBeNull();
    expect(removeOf(rows(fixture)[0])).not.toBeNull();
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

  it('tells the picker under the rows what it adds', async () => {
    const promptOf = (fixture: ComponentFixture<ReferencesControl>) =>
      fixture.debugElement
        .query(By.directive(ReferencePicker))
        .componentInstance.prompt();

    // Read before the next render, which takes the first one down.
    const plain = await render([]);
    expect(promptOf(plain.fixture)).toBe('resource.references.add');

    const named = await render([], { addKey: 'catalog.categories.add' });
    expect(promptOf(named.fixture)).toBe('catalog.categories.add');
    expect(
      (named.fixture.nativeElement as HTMLElement)
        .querySelector('input')
        ?.getAttribute('placeholder')
    ).toBe('catalog.categories.add');
  });
});

describe('ReferencesControl where the order counts', () => {
  it('has no arrows and no Main where it does not', async () => {
    const { fixture } = await render(['ps_store', 'ps_region']);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-move]')).toBeNull();
    expect(host.querySelector('[data-main]')).toBeNull();
  });

  it('says Main on the first row and on no other', async () => {
    const { fixture } = await render(['ps_region', 'ps_local'], {
      ordered: true,
    });
    const [first, second] = rows(fixture);

    expect(first.querySelector('[data-main]')?.textContent?.trim()).toBe(
      'resource.references.main'
    );
    expect(second.querySelector('[data-main]')).toBeNull();
  });

  it('gives each row both arrows, each named after the row', async () => {
    const { fixture } = await render(['ps_region', 'ps_local'], {
      ordered: true,
    });

    for (const row of rows(fixture)) {
      expect(moveOf(row, 'up').getAttribute('aria-label')).toBe(
        'resource.references.moveUp'
      );
      expect(moveOf(row, 'down').getAttribute('aria-label')).toBe(
        'resource.references.moveDown'
      );
      expect(moveOf(row, 'up').getAttribute('type')).toBe('button');
    }
  });

  it('switches Move up off on the first row and Move down on the last', async () => {
    const { fixture } = await render(['ps_region', 'ps_local', 'ps_store'], {
      ordered: true,
    });
    const [first, middle, last] = rows(fixture);

    expect([
      moveOf(first, 'up').disabled,
      moveOf(first, 'down').disabled,
    ]).toEqual([true, false]);
    expect([
      moveOf(middle, 'up').disabled,
      moveOf(middle, 'down').disabled,
    ]).toEqual([false, false]);
    expect([
      moveOf(last, 'up').disabled,
      moveOf(last, 'down').disabled,
    ]).toEqual([false, true]);
  });

  it('emits the list with the row one place up, or one place down', async () => {
    const { fixture, emitted } = await render(
      ['ps_region', 'ps_local', 'ps_store'],
      { ordered: true }
    );

    moveOf(rows(fixture)[1], 'up').click();
    moveOf(rows(fixture)[1], 'down').click();

    expect(emitted).toEqual([
      ['ps_local', 'ps_region', 'ps_store'],
      ['ps_region', 'ps_store', 'ps_local'],
    ]);
  });

  it('does nothing for a step off either end', async () => {
    const { fixture, emitted } = await render(['ps_region', 'ps_local'], {
      ordered: true,
    });

    fixture.componentInstance.move('ps_region', -1);
    fixture.componentInstance.move('ps_local', 1);
    fixture.componentInstance.move('ps_nowhere', 1);

    expect(emitted).toEqual([]);
  });

  it('still moves a locked row, and still offers no removal for it', async () => {
    const { fixture, emitted } = await render(['ps_store', 'ps_region'], {
      ordered: true,
    });
    const [store] = rows(fixture);

    expect(removeOf(store)).toBeNull();
    moveOf(store, 'down').click();

    expect(emitted).toEqual([['ps_region', 'ps_store']]);
  });
});

/**
 * The focus after a move needs a parent that hands the new order back, which
 * is what a form does. The fixture alone would emit and keep the old rows.
 */
@Component({
  imports: [ReferencesControl],
  template: `
    <lib-references-control
      (valueChange)="ids.set($event)"
      [lookup]="lookup"
      [ordered]="true"
      [value]="ids()"
      controlId="field-categoryIds"
      resource="categories"
    />
  `,
})
class Host {
  readonly ids = signal<readonly string[]>([
    'ps_region',
    'ps_local',
    'ps_store',
  ]);
  readonly lookup = lookupOf();
}

/** Admin plan 0056, section 2: the mark before a target, off its own row. */
describe('ReferencesControl with a mark for each target', () => {
  const byKind = (target: ResourceRow): ScopeMarkView | undefined =>
    target['kind'] === 'STORE'
      ? { level: 4, label: 'scope.kind.store' }
      : target['kind'] === 'REGION'
        ? { level: 2, label: 'scope.kind.region' }
        : undefined;

  it('draws the mark before the name of each row whose target has one', async () => {
    const { fixture } = await render(['ps_store', 'ps_region', 'ps_local'], {
      marks: byKind,
    });
    const marks = rows(fixture).map((row) => {
      const mark = fixture.debugElement
        .queryAll(By.directive(ScopeMark))
        .find((found) => row.contains(found.nativeElement));
      return mark === undefined
        ? null
        : (mark.componentInstance as ScopeMark).level();
    });

    expect(marks).toEqual([4, 2, null]);
    expect(rows(fixture)[0].firstElementChild?.tagName.toLowerCase()).toBe(
      'lib-scope-mark'
    );
  });

  it('draws no mark until the lookup has read the target', async () => {
    let answer: (option: ReferenceOption | null) => void = () => undefined;
    const { fixture } = await render(['ps_store'], {
      marks: byKind,
      lookup: lookupOf({
        resolve: () =>
          new Promise<ReferenceOption | null>((resolve) => (answer = resolve)),
      }),
    });

    expect(fixture.debugElement.query(By.directive(ScopeMark))).toBeNull();

    answer(scopes[0]);
    await settle(fixture);

    expect(fixture.debugElement.query(By.directive(ScopeMark))).not.toBeNull();
  });

  it('draws none for a field that states no mark', async () => {
    const { fixture } = await render(['ps_store', 'ps_region']);

    expect(fixture.debugElement.query(By.directive(ScopeMark))).toBeNull();
  });
});

describe('ReferencesControl after a move', () => {
  async function host() {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Host, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(Host);
    // In the document, because an element outside it cannot hold the focus.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await settle(fixture);

    return fixture;
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('keeps the focus on the button that was pressed, on the row at its new place', async () => {
    const fixture = await host();

    const down = moveOf(rows(fixture)[0], 'down');
    down.focus();
    down.click();
    await settle(fixture);

    expect(names(fixture)).toEqual(['Warehouse 4661', 'Córdoba', 'This shop']);
    expect(document.activeElement).toBe(moveOf(rows(fixture)[1], 'down'));
  });

  /** The button that was pressed is off there, so the row keeps the focus. */
  it('moves the focus to the other arrow of a row that reached an end', async () => {
    const fixture = await host();

    const up = moveOf(rows(fixture)[1], 'up');
    up.focus();
    up.click();
    await settle(fixture);

    expect(names(fixture)).toEqual(['Warehouse 4661', 'Córdoba', 'This shop']);
    expect(moveOf(rows(fixture)[0], 'up').disabled).toBe(true);
    expect(document.activeElement).toBe(moveOf(rows(fixture)[0], 'down'));
  });
});

describe('ReferencesControl, what the field calls a target', () => {
  /** A fact about the record and the target, which the title cannot say. */
  it('says the name of the field in place of the title, and keeps the title of the rest', async () => {
    const { fixture } = await render(['ps_store', 'ps_region', 'ps_local'], {
      names: (target) =>
        target['kind'] === 'STORE'
          ? fieldMessage('shops.own')
          : target['kind'] === 'LOCAL_AREA'
            ? { kind: 'text', text: 'Near here' }
            : undefined,
    });

    expect(names(fixture)).toEqual(['shops.own', 'Córdoba', 'Near here']);
  });

  it('says the title of every target for a field that names none', async () => {
    const { fixture } = await render(['ps_store', 'ps_region']);

    expect(names(fixture)).toEqual(['This shop', 'Córdoba']);
  });
});
