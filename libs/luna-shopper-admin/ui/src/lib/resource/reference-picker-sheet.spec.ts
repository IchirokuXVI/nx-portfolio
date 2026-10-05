import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { recordIdIn } from '@portfolio/luna-shopper-admin/models';
import { PopoverSheet } from '../page/popover-sheet';
import { Viewport } from '../viewport';
import type { ReferenceLookup, ReferenceOption } from './reference-lookup';
import { ReferencePicker, type ReferenceEmpty } from './reference-picker';

/**
 * The typeahead on a phone: a button, and a sheet from the bottom edge (admin
 * plan 0052, section 3.5). It replaced the list that opened under the field,
 * which opened behind the keyboard.
 *
 * Microtasks are drained by awaiting, as the picker's own spec does.
 */
const MADRID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const NOBODY = '11111111-2222-4333-8444-555555555555';

const scopes: ReferenceOption[] = [
  { id: '0a0a0a0a-1111-4111-8111-000000000001', title: 'Catalonia' },
  { id: MADRID, title: 'Madrid' },
];

/** Answers as the app's lookup does: an ID finds its one row, or nothing. */
const lookup: ReferenceLookup = {
  search: async (_resource, term) => {
    const id = recordIdIn(term);
    return id === null
      ? scopes.filter((scope) =>
          scope.title.toLowerCase().includes(term.toLowerCase())
        )
      : scopes.filter((scope) => scope.id === id);
  },
  resolve: async (_resource, id) =>
    scopes.find((scope) => scope.id === id) ?? null,
};

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
    label?: string | null;
    compact?: boolean;
    inputs?: Record<string, unknown>;
  } = {}
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ReferencePicker, RokuTranslatorTestingModule.forTesting()],
    providers: [
      {
        provide: Viewport,
        useValue: { compact: signal(options.compact ?? true) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ReferencePicker);
  fixture.componentRef.setInput('controlId', 'field-brandId');
  fixture.componentRef.setInput('resource', 'brands');
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('lookup', lookup);
  fixture.componentRef.setInput('empty', options.empty ?? null);
  fixture.componentRef.setInput(
    'label',
    options.label === undefined ? 'Brand' : options.label
  );
  for (const [name, held] of Object.entries(options.inputs ?? {})) {
    fixture.componentRef.setInput(name, held);
  }
  // In the document, because an element outside it cannot hold the focus.
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await settle(fixture);

  const emitted: string[] = [];
  fixture.componentInstance.valueChange.subscribe((id) => emitted.push(id));

  return { fixture, host: fixture.nativeElement as HTMLElement, emitted };
}

function button(host: HTMLElement): HTMLButtonElement {
  return host.querySelector('[data-picker-button]') as HTMLButtonElement;
}

function search(host: HTMLElement): HTMLInputElement {
  return host.querySelector('[data-picker-search]') as HTMLInputElement;
}

function options(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[role="option"]')].map(
    (option) => option.textContent?.trim() ?? ''
  );
}

async function open(fixture: ComponentFixture<ReferencePicker>) {
  button(fixture.nativeElement).click();
  fixture.detectChanges();
  await settle(fixture);
}

function sheetOf(fixture: ComponentFixture<ReferencePicker>): PopoverSheet {
  return fixture.debugElement.query(By.directive(PopoverSheet))
    .componentInstance;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('ReferencePicker on a phone', () => {
  it('is a button that shows the name, with the arrow, and no list under it', async () => {
    const { host } = await render(MADRID);

    expect(button(host).getAttribute('type')).toBe('button');
    expect(button(host).id).toBe('field-brandId');
    expect(button(host).textContent?.trim()).toBe('Madrid');
    expect(button(host).querySelector('lib-chevron-left-icon')).not.toBeNull();
    expect(button(host).getAttribute('aria-haspopup')).toBe('dialog');
    expect(button(host).getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.box input')).toBeNull();
    expect(host.querySelector('.popup')).toBeNull();
  });

  /** The label names the button, so the value is what describes it. */
  it('is named by the label and described by the value it holds', async () => {
    const { host } = await render(MADRID);
    const described = button(host).getAttribute('aria-describedby') ?? '';

    expect(button(host).getAttribute('aria-label')).toBe('Brand');
    expect(
      host.ownerDocument.getElementById(described)?.textContent?.trim()
    ).toBe('Madrid');
  });

  it('says what an empty field says where it holds nothing', async () => {
    expect(button((await render('')).host).textContent?.trim()).toBe(
      'resource.field.choose'
    );
    expect(
      button((await render('', { empty: 'none' })).host).textContent?.trim()
    ).toBe('resource.reference.none');
  });

  it('opens a sheet from the bottom edge, headed by the label', async () => {
    const { fixture, host } = await render('');

    await open(fixture);

    expect(sheetOf(fixture).sheet()).toBe(true);
    expect(sheetOf(fixture).heading()).toBe('Brand');
    expect(button(host).getAttribute('aria-expanded')).toBe('true');
  });

  it('heads the sheet with what the empty field says when it has no label', async () => {
    const { fixture } = await render('', { label: null });

    await open(fixture);

    expect(sheetOf(fixture).heading()).toBe('resource.field.choose');
  });

  it('holds the search field first, then the list, with the empty choice first', async () => {
    const { fixture, host } = await render('', { empty: 'none' });

    await open(fixture);

    const body = host.querySelector('lib-popover-sheet .body') as HTMLElement;
    expect(body.firstElementChild?.querySelector('input')).toBe(search(host));
    expect(search(host).getAttribute('role')).toBe('combobox');
    expect(search(host).getAttribute('aria-controls')).toBe(
      host.querySelector('[role="listbox"]')?.id
    );
    expect(options(host)).toEqual([
      'resource.reference.none',
      'Catalonia',
      'Madrid',
    ]);
  });

  it('searches what is typed in the sheet', async () => {
    jest.useFakeTimers();
    try {
      const { fixture, host } = await render('');
      await open(fixture);

      search(host).value = 'mad';
      search(host).dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(300);
      await settle(fixture);

      expect(options(host)).toEqual(['Madrid']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes on a choice, emits it, and puts the focus back on the button', async () => {
    const { fixture, host, emitted } = await render('');
    await open(fixture);

    (host.querySelectorAll('[role="option"]')[1] as HTMLElement).click();
    fixture.detectChanges();
    await settle(fixture);

    expect(emitted).toEqual([MADRID]);
    expect(host.querySelector('lib-popover-sheet')).toBeNull();
    expect(document.activeElement).toBe(button(host));
  });

  it('closes on Escape and changes nothing', async () => {
    const { fixture, host, emitted } = await render(MADRID);
    await open(fixture);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    await settle(fixture);

    expect(host.querySelector('lib-popover-sheet')).toBeNull();
    expect(emitted).toEqual([]);
    expect(button(host).textContent?.trim()).toBe('Madrid');
    expect(document.activeElement).toBe(button(host));
  });

  it('closes on a press on the scrim and changes nothing', async () => {
    const { fixture, host, emitted } = await render(MADRID);
    await open(fixture);

    (host.querySelector('[data-sheet-scrim]') as HTMLElement).click();
    fixture.detectChanges();
    await settle(fixture);

    expect(host.querySelector('lib-popover-sheet')).toBeNull();
    expect(emitted).toEqual([]);
  });

  /** A press on the heading takes the focus from the search field. */
  it('stays open when the search field loses the focus', async () => {
    const { fixture, host } = await render('');
    await open(fixture);

    search(host).dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    await settle(fixture);

    expect(host.querySelector('lib-popover-sheet')).not.toBeNull();
  });

  /** Admin plan 0051: a typed record ID chooses its record, in the sheet too. */
  it('chooses the record of a typed ID at once', async () => {
    const { fixture, host, emitted } = await render('');
    await open(fixture);

    search(host).value = MADRID;
    search(host).dispatchEvent(new Event('input'));
    await settle(fixture);

    expect(emitted).toEqual([MADRID]);
    expect(host.querySelector('lib-popover-sheet')).toBeNull();
  });

  it('says so in the sheet when no record has the typed ID, and keeps the value', async () => {
    const { fixture, host, emitted } = await render('');
    await open(fixture);

    search(host).value = NOBODY;
    search(host).dispatchEvent(new Event('input'));
    await settle(fixture);

    expect(host.querySelector('[data-id-not-found]')).not.toBeNull();
    expect(emitted).toEqual([]);
  });

  it('opens nothing while it is switched off', async () => {
    const { fixture, host } = await render('', {
      inputs: { disabled: true },
    });

    await open(fixture);

    expect(button(host).disabled).toBe(true);
    expect(host.querySelector('lib-popover-sheet')).toBeNull();
  });

  it('carries a refusal on the button', async () => {
    const { host } = await render('', {
      inputs: { invalid: true, describedBy: 'field-brandId-error-0' },
    });

    expect(button(host).getAttribute('aria-invalid')).toBe('true');
    expect(button(host).getAttribute('aria-describedby')).toContain(
      'field-brandId-error-0'
    );
  });
});

describe('ReferencePicker on a wide screen', () => {
  it('is the combobox, with no button for a sheet', async () => {
    const { host } = await render(MADRID, { compact: false });

    expect(host.querySelector('[data-picker-button]')).toBeNull();
    expect(host.querySelector('input')?.getAttribute('role')).toBe('combobox');
  });

  it('carries a refusal on the field', async () => {
    const { host } = await render('', {
      compact: false,
      inputs: { invalid: true, describedBy: 'field-brandId-error-0' },
    });
    const field = host.querySelector('input');

    expect(field?.getAttribute('aria-invalid')).toBe('true');
    expect(field?.getAttribute('aria-describedby')).toBe(
      'field-brandId-error-0'
    );
  });

  it('says nothing about a refusal while there is none', async () => {
    const field = (await render('', { compact: false })).host.querySelector(
      'input'
    );

    expect(field?.getAttribute('aria-invalid')).toBeNull();
    expect(field?.getAttribute('aria-describedby')).toBeNull();
  });

  it('says what it is asked to in place of Choose', async () => {
    const { host } = await render('', {
      compact: false,
      inputs: { prompt: 'catalog.categories.add' },
    });

    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe(
      'catalog.categories.add'
    );
  });
});
