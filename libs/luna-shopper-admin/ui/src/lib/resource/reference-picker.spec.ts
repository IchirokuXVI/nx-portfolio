import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { REFERENCE_NONE } from '@portfolio/luna-shopper-admin/models';
import type { ReferenceLookup, ReferenceOption } from './reference-lookup';
import { ReferencePicker, type ReferenceEmpty } from './reference-picker';

/**
 * A uuid, chosen by name (plan 0004, section 6), as a combobox (plan 0050).
 *
 * Microtasks are drained by awaiting rather than by `whenStable`, which hangs in
 * a zoneless spec. Only the spec of typing needs the debounce, and it runs the
 * timers by hand.
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
  await Promise.resolve();
  fixture.detectChanges();
}

async function render(
  value: string,
  options: {
    empty?: ReferenceEmpty;
    none?: boolean;
    label?: string;
    lookup?: ReferenceLookup;
  } = {}
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
  fixture.componentRef.setInput('empty', options.empty ?? null);
  fixture.componentRef.setInput('none', options.none ?? false);
  fixture.componentRef.setInput('label', options.label ?? null);
  fixture.detectChanges();
  await settle(fixture);

  return fixture;
}

function field(fixture: ComponentFixture<ReferencePicker>): HTMLInputElement {
  return fixture.nativeElement.querySelector('input');
}

function arrow(fixture: ComponentFixture<ReferencePicker>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('[data-arrow]');
}

function shown(fixture: ComponentFixture<ReferencePicker>): string[] {
  return [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="option"]'
    ),
  ].map((option) => option.textContent?.trim() ?? '');
}

function press(fixture: ComponentFixture<ReferencePicker>, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  field(fixture).dispatchEvent(event);
  fixture.detectChanges();
  return event;
}

/** Opens the list from the arrow and waits for the first page. */
async function open(fixture: ComponentFixture<ReferencePicker>) {
  arrow(fixture).click();
  await settle(fixture);
}

function collect(fixture: ComponentFixture<ReferencePicker>): string[] {
  const emitted: string[] = [];
  fixture.componentInstance.valueChange.subscribe((id) => emitted.push(id));
  return emitted;
}

describe('ReferencePicker with a value', () => {
  it('shows what the id points at, by name, in the field', async () => {
    const fixture = await render('ps_1');

    expect(field(fixture).value).toBe('Catalonia');
    expect(fixture.nativeElement.querySelector('.missing')).toBeNull();
  });

  /**
   * A reference can outlive what it points at, and that is a different problem
   * from an empty field. Only one of them is fixed by picking something.
   */
  it('says so when the target no longer exists', async () => {
    const fixture = await render('ps_gone');

    const missing: HTMLElement =
      fixture.nativeElement.querySelector('.missing');
    expect(missing).not.toBeNull();
    expect(field(fixture).value).toBe('');
    expect(field(fixture).getAttribute('aria-describedby')).toBe(missing.id);
  });

  it('marks the value held in the open list, and starts the keys there', async () => {
    const fixture = await render('ps_2');
    await open(fixture);

    const options: HTMLElement[] = [
      ...fixture.nativeElement.querySelectorAll('[role="option"]'),
    ];
    expect(
      options.map((option) => option.getAttribute('aria-selected'))
    ).toEqual(['false', 'true']);
    expect(field(fixture).getAttribute('aria-activedescendant')).toBe(
      options[1].id
    );
  });

  /**
   * The parent can put another id in the field. The name of the one before it
   * is not the name of this one, so the field says it is looking.
   */
  it('drops the old name while a new value is being read', async () => {
    let answer: (row: ReferenceOption | null) => void = () => undefined;
    const fixture = await render('ps_1', {
      lookup: lookupOf({
        resolve: (_resource, id) =>
          id === 'ps_1'
            ? Promise.resolve(scopes[0])
            : new Promise((resolve) => (answer = resolve)),
      }),
    });
    expect(field(fixture).value).toBe('Catalonia');

    fixture.componentRef.setInput('value', 'ps_2');
    fixture.detectChanges();
    await settle(fixture);

    expect(field(fixture).value).toBe('');
    expect(field(fixture).placeholder).toBe('resource.reference.resolving');
    expect(fixture.nativeElement.querySelector('.missing')).toBeNull();

    answer(scopes[1]);
    await settle(fixture);
    expect(field(fixture).value).toBe('Madrid');
  });

  it('closes its list when it is switched off', async () => {
    const fixture = await render('');
    await open(fixture);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.open()).toBe(false);
  });

  /** A value picked from the list is named from the list, with no second read. */
  it('does not read a row again that the list already showed', async () => {
    const resolved: string[] = [];
    const fixture = await render('', {
      lookup: lookupOf({
        resolve: async (_resource, id) => {
          resolved.push(id);
          return null;
        },
      }),
    });
    await open(fixture);

    fixture.componentRef.setInput('value', 'ps_2');
    await settle(fixture);

    expect(resolved).toEqual([]);
    expect(field(fixture).value).toBe('Madrid');
  });
});

describe('ReferencePicker opening', () => {
  it('is one closed combobox until it is asked', async () => {
    const fixture = await render('');

    expect(field(fixture).getAttribute('role')).toBe('combobox');
    expect(field(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'resource.reference.noResults'
    );
  });

  /**
   * The defect this plan removes: the list was read only after typing, so a
   * picker nobody had touched said that nothing matched.
   */
  it('shows the first page from the arrow, with nothing typed', async () => {
    const fixture = await render('');
    await open(fixture);

    expect(shown(fixture)).toEqual(['Catalonia', 'Madrid']);
    expect(field(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(field(fixture).getAttribute('aria-controls')).toBe(
      fixture.nativeElement.querySelector('[role="listbox"]').id
    );
  });

  it('opens from the arrow keys and from a click in the field', async () => {
    const byKey = await render('');
    press(byKey, 'ArrowDown');
    await settle(byKey);
    expect(shown(byKey)).toHaveLength(2);

    const byClick = await render('');
    field(byClick).click();
    await settle(byClick);
    expect(shown(byClick)).toHaveLength(2);
  });

  it('closes again from the arrow', async () => {
    const fixture = await render('');
    await open(fixture);

    arrow(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeNull();
  });

  /** The arrow is a second way to the same list, not a second stop. */
  it('keeps the arrow out of the tab order and gives it a name', async () => {
    const fixture = await render('');

    expect(arrow(fixture).tabIndex).toBe(-1);
    expect(arrow(fixture).getAttribute('aria-label')).toBe(
      'resource.reference.open'
    );
  });

  it('says nothing matched only after a read that found nothing', async () => {
    const fixture = await render('', {
      lookup: lookupOf({ search: async () => [] }),
    });
    await open(fixture);

    expect(fixture.nativeElement.textContent).toContain(
      'resource.reference.noResults'
    );
  });

  it('answers a failed search with nothing found rather than an exception', async () => {
    const fixture = await render('', {
      lookup: lookupOf({
        search: async () => {
          throw new Error('gateway is down');
        },
      }),
    });
    await open(fixture);

    expect(fixture.componentInstance.options()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain(
      'resource.reference.noResults'
    );
  });

  it('opens nothing while it is disabled', async () => {
    const fixture = await render('');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    fixture.componentInstance.show();
    await settle(fixture);

    expect(fixture.componentInstance.open()).toBe(false);
    expect(arrow(fixture).disabled).toBe(true);
  });

  it('takes its name from the use that has no label element', async () => {
    const named = await render('', { label: 'Chain' });
    expect(field(named).getAttribute('aria-label')).toBe('Chain');

    const labelled = await render('');
    expect(field(labelled).hasAttribute('aria-label')).toBe(false);
  });
});

describe('ReferencePicker choosing', () => {
  it('emits the id of the option that was pressed, and closes', async () => {
    const fixture = await render('');
    const emitted = collect(fixture);
    await open(fixture);

    const options: HTMLElement[] = [
      ...fixture.nativeElement.querySelectorAll('[role="option"]'),
    ];
    options[1].click();
    fixture.detectChanges();

    expect(emitted).toEqual(['ps_2']);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('moves through the list with the arrow keys, around the ends', async () => {
    const fixture = await render('');
    await open(fixture);
    const ids = [
      ...fixture.nativeElement.querySelectorAll('[role="option"]'),
    ].map((option: HTMLElement) => option.id);

    press(fixture, 'ArrowDown');
    expect(field(fixture).getAttribute('aria-activedescendant')).toBe(ids[0]);
    press(fixture, 'ArrowDown');
    expect(field(fixture).getAttribute('aria-activedescendant')).toBe(ids[1]);
    press(fixture, 'ArrowDown');
    expect(field(fixture).getAttribute('aria-activedescendant')).toBe(ids[0]);
    press(fixture, 'ArrowUp');
    expect(field(fixture).getAttribute('aria-activedescendant')).toBe(ids[1]);
  });

  it('chooses the active option on Enter, and keeps Enter from the form', async () => {
    const fixture = await render('');
    const emitted = collect(fixture);
    await open(fixture);

    press(fixture, 'ArrowDown');
    const enter = press(fixture, 'Enter');

    expect(emitted).toEqual(['ps_1']);
    expect(enter.defaultPrevented).toBe(true);
  });

  /** A closed field is an ordinary field: Enter belongs to the form around it. */
  it('leaves Enter alone while the list is closed', async () => {
    const fixture = await render('ps_1');
    const emitted = collect(fixture);

    const enter = press(fixture, 'Enter');

    expect(enter.defaultPrevented).toBe(false);
    expect(emitted).toEqual([]);
  });

  /**
   * Escape closes the list and nothing else. The panel or the dialog the field
   * sits in listens for the same key on the document.
   */
  it('closes on Escape without letting the key reach what is around it', async () => {
    const fixture = await render('ps_1');
    const emitted = collect(fixture);
    const heard: string[] = [];
    const listen = (event: KeyboardEvent) => heard.push(event.key);
    document.addEventListener('keydown', listen);
    await open(fixture);

    press(fixture, 'Escape');
    expect(fixture.componentInstance.open()).toBe(false);
    expect(heard).toEqual([]);

    press(fixture, 'Escape');
    document.removeEventListener('keydown', listen);

    expect(heard).toEqual(['Escape']);
    expect(emitted).toEqual([]);
    expect(field(fixture).value).toBe('Catalonia');
  });
});

describe('ReferencePicker typing', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function type(
    fixture: ComponentFixture<ReferencePicker>,
    text: string
  ) {
    field(fixture).value = text;
    field(fixture).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    jest.advanceTimersByTime(300);
    await settle(fixture);
  }

  it('searches what was typed and puts the keys on the first match', async () => {
    const fixture = await render('');
    const emitted = collect(fixture);

    await type(fixture, 'mad');
    expect(shown(fixture)).toEqual(['Madrid']);

    press(fixture, 'Enter');
    expect(emitted).toEqual(['ps_2']);
  });

  /**
   * A search that lands after newer typing answers a text the field no longer
   * holds. Enter on its first row would pick a record nobody asked for.
   */
  it('drops the first page that lands after something was typed', async () => {
    let answerFirstPage: (rows: readonly ReferenceOption[]) => void = () =>
      undefined;
    const fixture = await render('', {
      lookup: lookupOf({
        search: (_resource, term) =>
          term === ''
            ? new Promise((resolve) => (answerFirstPage = resolve))
            : Promise.resolve(
                scopes.filter((scope) =>
                  scope.title.toLowerCase().includes(term.toLowerCase())
                )
              ),
      }),
    });
    const emitted = collect(fixture);

    field(fixture).click();
    fixture.detectChanges();
    field(fixture).value = 'mad';
    field(fixture).dispatchEvent(new Event('input'));
    answerFirstPage(scopes);
    await settle(fixture);

    expect(shown(fixture)).toEqual([]);
    press(fixture, 'Enter');
    expect(emitted).toEqual([]);

    jest.advanceTimersByTime(300);
    await settle(fixture);
    press(fixture, 'Enter');
    expect(emitted).toEqual(['ps_2']);
  });

  it('drops the answer for a shorter text that lands after a longer one', async () => {
    const answers = new Map<
      string,
      (rows: readonly ReferenceOption[]) => void
    >();
    const fixture = await render('', {
      lookup: lookupOf({
        search: (_resource, term) =>
          new Promise((resolve) => answers.set(term, resolve)),
      }),
    });
    const emitted = collect(fixture);

    field(fixture).value = 'a';
    field(fixture).dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(300);
    field(fixture).value = 'ad';
    field(fixture).dispatchEvent(new Event('input'));
    answers.get('a')?.(scopes);
    await settle(fixture);

    expect(shown(fixture)).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain(
      'resource.reference.searching'
    );
    press(fixture, 'Enter');
    expect(emitted).toEqual([]);
  });

  /** A page may hold the picker inside a native form with a submit button. */
  it('keeps Enter from the form while the list is open and nothing is active', async () => {
    const fixture = await render('');

    field(fixture).value = 'mad';
    field(fixture).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const enter = press(fixture, 'Enter');

    expect(fixture.componentInstance.open()).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
  });

  /**
   * Text that was typed and not chosen changes nothing. In a form, a field
   * emptied by a slip of the hand would be a saved null.
   */
  it('throws typed text away when the field is left, and keeps the value', async () => {
    const fixture = await render('ps_1', { empty: 'none' });
    const emitted = collect(fixture);

    await type(fixture, '');
    field(fixture).dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(emitted).toEqual([]);
    expect(field(fixture).value).toBe('Catalonia');
    expect(fixture.componentInstance.open()).toBe(false);
  });

  /**
   * A typed word is a search for a row by name, and neither leading choice has
   * a name to match. Under a term, "none" would read as "nothing matched".
   */
  it('withdraws both leading choices once something is typed', async () => {
    const fixture = await render('', { empty: 'any', none: true });
    await open(fixture);
    expect(shown(fixture)).toHaveLength(4);

    await type(fixture, 'cat');

    expect(shown(fixture)).toEqual(['Catalonia']);
  });
});

/** The choice that clears the value (plan 0050, section 2). */
describe('ReferencePicker offering the empty choice', () => {
  it('does not offer it unless asked to', async () => {
    const fixture = await render('ps_1');
    await open(fixture);

    expect(shown(fixture)).toEqual(['Catalonia', 'Madrid']);
    expect(field(fixture).placeholder).toBe('resource.field.choose');
  });

  it('lists it first and reads None in a form', async () => {
    const fixture = await render('ps_1', { empty: 'none' });
    await open(fixture);

    expect(shown(fixture)).toEqual([
      'resource.reference.none',
      'Catalonia',
      'Madrid',
    ]);
  });

  it('reads Any in a filter, in the list and in the empty field', async () => {
    const fixture = await render('', { empty: 'any' });
    await open(fixture);

    expect(shown(fixture)[0]).toBe('resource.filter.any');
    expect(field(fixture).placeholder).toBe('resource.filter.any');
  });

  it('emits nothing at all when it is chosen', async () => {
    const fixture = await render('ps_1', { empty: 'none' });
    const emitted = collect(fixture);
    await open(fixture);

    fixture.nativeElement.querySelector('[role="option"]').click();

    expect(emitted).toEqual(['']);
  });
});

/**
 * The rows that point at nothing (plan 0012, section 2).
 *
 * A filter over a nullable column can ask for them, and the way to ask is a
 * choice in the same list as the rows, offered while nothing is typed.
 */
describe('ReferencePicker offering none', () => {
  it('lists it after the choice that clears, before the rows', async () => {
    const fixture = await render('', { empty: 'any', none: true });
    await open(fixture);

    expect(shown(fixture)).toEqual([
      'resource.filter.any',
      'resource.reference.none',
      'Catalonia',
      'Madrid',
    ]);
  });

  it('still offers it when the search itself found nothing', async () => {
    const fixture = await render('', {
      none: true,
      lookup: lookupOf({ search: async () => [] }),
    });
    await open(fixture);

    expect(shown(fixture)).toEqual(['resource.reference.none']);
    expect(fixture.nativeElement.textContent).not.toContain(
      'resource.reference.noResults'
    );
  });

  it('emits the none literal when it is chosen', async () => {
    const fixture = await render('', { none: true });
    const emitted = collect(fixture);
    await open(fixture);

    fixture.nativeElement.querySelector('[role="option"]').click();

    expect(emitted).toEqual([REFERENCE_NONE]);
  });

  /** There is nothing to look up, so nothing is looked up and nothing is missing. */
  it('draws a held none by name without resolving it', async () => {
    const resolved: string[] = [];
    const fixture = await render(REFERENCE_NONE, {
      none: true,
      empty: 'any',
      lookup: lookupOf({
        resolve: async (_resource, id) => {
          resolved.push(id);
          return null;
        },
      }),
    });

    expect(resolved).toEqual([]);
    expect(field(fixture).value).toBe('resource.reference.none');
    expect(fixture.nativeElement.querySelector('.missing')).toBeNull();
  });
});
