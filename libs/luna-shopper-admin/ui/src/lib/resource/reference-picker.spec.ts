import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { REFERENCE_NONE } from '@portfolio/luna-shopper-admin/models';
import type { ReferenceLookup, ReferenceOption } from './reference-lookup';
import { ReferencePicker } from './reference-picker';

/**
 * A uuid, chosen by name (plan 0004, section 6).
 *
 * Microtasks are drained by awaiting rather than by `whenStable`, which hangs in
 * a zoneless spec, and no fake timers are needed: the search is called directly
 * where the debounce would otherwise be the thing under test.
 */

const scopes: ReferenceOption[] = [
  { id: 'ps_1', title: 'Catalonia' },
  { id: 'ps_2', title: 'Madrid' },
];

function lookupOf(overrides: Partial<ReferenceLookup> = {}): ReferenceLookup {
  return {
    search: async (_resource, term) =>
      scopes.filter((scope) =>
        scope.title.toLowerCase().includes(term.toLowerCase())
      ),
    resolve: async (_resource, id) =>
      scopes.find((scope) => scope.id === id) ?? null,
    ...overrides,
  };
}

/** Lets every pending promise settle, then redraws. */
async function settle(fixture: ComponentFixture<ReferencePicker>) {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

async function render(
  value: string,
  options: { nullable?: boolean; none?: boolean; lookup?: ReferenceLookup } = {}
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ReferencePicker, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ReferencePicker);
  fixture.componentRef.setInput('controlId', 'field-priceScopeId');
  fixture.componentRef.setInput('resource', 'price-scopes');
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('lookup', options.lookup ?? lookupOf());
  fixture.componentRef.setInput('nullable', options.nullable ?? false);
  fixture.componentRef.setInput('none', options.none ?? false);
  fixture.detectChanges();
  await settle(fixture);

  return fixture;
}

/** The "none" choice in the list, if it is being offered. */
function noneButton(
  fixture: ComponentFixture<ReferencePicker>
): HTMLButtonElement | null {
  return fixture.nativeElement.querySelector('li button.none');
}

describe('ReferencePicker with a value', () => {
  it('shows what the id points at, by name', async () => {
    const fixture = await render('ps_1');

    expect(fixture.nativeElement.querySelector('.name')?.textContent).toContain(
      'Catalonia'
    );
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });

  /**
   * A reference can outlive what it points at, and that is a different problem
   * from an empty field. Only one of them is fixed by picking something.
   */
  it('says so when the target no longer exists', async () => {
    const fixture = await render('ps_gone');

    expect(fixture.nativeElement.querySelector('.missing')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.name')).toBeNull();
  });

  it('offers a way to empty it only where the column allows one', async () => {
    const fixed = await render('ps_1', { nullable: false });
    expect(fixed.nativeElement.textContent).not.toContain(
      'resource.reference.clear'
    );

    const clearable = await render('ps_1', { nullable: true });
    expect(clearable.nativeElement.textContent).toContain(
      'resource.reference.clear'
    );
  });

  it('emits nothing at all when it is emptied', async () => {
    const fixture = await render('ps_1', { nullable: true });
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((id) => emitted.push(id));

    const clear = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLElement) =>
        button.textContent?.includes('resource.reference.clear')
    ) as HTMLButtonElement | undefined;
    clear?.click();

    expect(emitted).toEqual(['']);
  });

  it('turns into a search box when the operator asks to change it', async () => {
    const fixture = await render('ps_1');

    fixture.componentInstance.startChanging();
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('input')).not.toBeNull();
    expect(fixture.componentInstance.options()).toHaveLength(2);
  });
});

describe('ReferencePicker with no value', () => {
  it('is a search box', async () => {
    const fixture = await render('');

    expect(fixture.nativeElement.querySelector('input')).not.toBeNull();
  });

  it('emits the id of whatever was chosen', async () => {
    const fixture = await render('');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((id) => emitted.push(id));

    fixture.componentInstance.choose(scopes[1]);

    expect(emitted).toEqual(['ps_2']);
  });

  /**
   * A picker that showed nothing until something was typed would hide the
   * answer from an operator who does not know what the options are called.
   */
  it('offers the first page before anything is typed', async () => {
    const fixture = await render('');

    fixture.componentInstance.startChanging();
    await settle(fixture);

    expect(fixture.componentInstance.options()).toHaveLength(2);
  });

  it('answers a failed search with nothing found rather than an exception', async () => {
    const fixture = await render('', {
      lookup: lookupOf({
        search: async () => {
          throw new Error('gateway is down');
        },
      }),
    });

    fixture.componentInstance.startChanging();
    await settle(fixture);

    expect(fixture.componentInstance.options()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain(
      'resource.reference.noResults'
    );
  });
});

/**
 * The rows that point at nothing (plan 0012, section 2).
 *
 * A filter over a nullable column can ask for them, and the way to ask is a
 * choice in the same list as the rows, offered while the search box is blank.
 */
describe('ReferencePicker offering none', () => {
  it('does not offer it unless asked to', async () => {
    const fixture = await render('');
    fixture.componentInstance.startChanging();
    await settle(fixture);

    expect(noneButton(fixture)).toBeNull();
  });

  it('lists it first, before anything is typed', async () => {
    const fixture = await render('', { none: true });
    fixture.componentInstance.startChanging();
    await settle(fixture);

    const buttons = [...fixture.nativeElement.querySelectorAll('li button')];
    expect(buttons[0]?.classList.contains('none')).toBe(true);
    expect(buttons).toHaveLength(3);
  });

  /**
   * A typed word is a search for a row by name, and the absence of a row has
   * no name to match. Under a term, "none" would read as "nothing matched".
   */
  it('withdraws it once something is typed', async () => {
    const fixture = await render('', { none: true });
    fixture.componentInstance.startChanging();
    await settle(fixture);

    fixture.componentInstance.term.set('mad');
    fixture.detectChanges();

    expect(noneButton(fixture)).toBeNull();
  });

  it('still offers it when the search itself found nothing', async () => {
    const fixture = await render('', {
      none: true,
      lookup: lookupOf({ search: async () => [] }),
    });
    fixture.componentInstance.startChanging();
    await settle(fixture);

    expect(noneButton(fixture)).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'resource.reference.noResults'
    );
  });

  it('emits the none literal when it is chosen', async () => {
    const fixture = await render('', { none: true });
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((id) => emitted.push(id));
    fixture.componentInstance.startChanging();
    await settle(fixture);

    noneButton(fixture)?.click();

    expect(emitted).toEqual([REFERENCE_NONE]);
  });

  /** There is nothing to look up, so nothing is looked up and nothing is missing. */
  it('draws a held none by name without resolving it', async () => {
    const resolved: string[] = [];
    const fixture = await render(REFERENCE_NONE, {
      none: true,
      nullable: true,
      lookup: lookupOf({
        resolve: async (_resource, id) => {
          resolved.push(id);
          return null;
        },
      }),
    });

    expect(resolved).toEqual([]);
    expect(fixture.nativeElement.querySelector('.name')?.textContent).toContain(
      'resource.reference.none'
    );
    expect(fixture.nativeElement.querySelector('.missing')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'resource.reference.clear'
    );
  });
});
