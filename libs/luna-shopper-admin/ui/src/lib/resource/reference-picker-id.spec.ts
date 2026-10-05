import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { recordIdIn } from '@portfolio/luna-shopper-admin/models';
import type { ReferenceLookup, ReferenceOption } from './reference-lookup';
import { ReferencePicker } from './reference-picker';

/**
 * A record ID typed or pasted into the typeahead (admin plan 0051).
 *
 * The lookup here does what the app's does: a term that is an ID answers the
 * one row that has it, or nothing. What this spec holds is the picker's half:
 * a found record is chosen at once, and a missing one is said in a sentence
 * that is not "Nothing matched."
 */
const MADRID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const NOBODY = '11111111-2222-4333-8444-555555555555';

const scopes: ReferenceOption[] = [
  { id: '0a0a0a0a-1111-4111-8111-000000000001', title: 'Catalonia' },
  { id: MADRID, title: 'Madrid' },
];

function lookupOf(overrides: Partial<ReferenceLookup> = {}): ReferenceLookup {
  return {
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
    ...overrides,
  };
}

async function settle(fixture: ComponentFixture<ReferencePicker>) {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();
}

async function render(lookup: ReferenceLookup = lookupOf(), value = '') {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ReferencePicker, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ReferencePicker);
  fixture.componentRef.setInput('controlId', 'field-priceScopeId');
  fixture.componentRef.setInput('resource', 'price-scopes');
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('lookup', lookup);
  fixture.detectChanges();
  await settle(fixture);

  const emitted: string[] = [];
  fixture.componentInstance.valueChange.subscribe((id) => emitted.push(id));
  return { fixture, emitted };
}

function field(fixture: ComponentFixture<ReferencePicker>): HTMLInputElement {
  return fixture.nativeElement.querySelector('input');
}

/** Puts text in the field, as a paste does, without waiting for anything. */
function paste(fixture: ComponentFixture<ReferencePicker>, text: string) {
  field(fixture).value = text;
  field(fixture).dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function notFound(fixture: ComponentFixture<ReferencePicker>): string | null {
  const line = (fixture.nativeElement as HTMLElement).querySelector(
    '[data-id-not-found]'
  );
  return line === null ? null : (line.textContent?.trim() ?? '');
}

describe('ReferencePicker with a typed record ID', () => {
  it('chooses the record that has the ID, with no click and no wait', async () => {
    const { fixture, emitted } = await render();

    paste(fixture, `  ${MADRID.toUpperCase()} `);
    await settle(fixture);

    expect(emitted).toEqual([MADRID]);
    expect(fixture.componentInstance.open()).toBe(false);

    // The parent holds the value now, and the field shows it by name.
    fixture.componentRef.setInput('value', MADRID);
    fixture.detectChanges();
    await settle(fixture);
    expect(field(fixture).value).toBe('Madrid');
  });

  it('says that no record has the ID, and chooses nothing', async () => {
    const { fixture, emitted } = await render(
      lookupOf({ nounOf: () => 'scopes.one' })
    );

    paste(fixture, NOBODY);
    await settle(fixture);

    expect(emitted).toEqual([]);
    expect(notFound(fixture)).toBe('resource.id.notFound');
    expect(fixture.nativeElement.textContent).not.toContain(
      'resource.reference.noResults'
    );
    // The value the field held is still the value.
    expect(fixture.componentInstance.open()).toBe(true);
  });

  it('says it without the noun when the lookup has none to give', async () => {
    const { fixture } = await render();

    paste(fixture, NOBODY);
    await settle(fixture);

    expect(notFound(fixture)).toBe('resource.id.notFoundHere');
  });

  it('keeps "Nothing matched." for a word that matched nothing', async () => {
    jest.useFakeTimers();
    try {
      const { fixture } = await render();

      paste(fixture, 'zzz');
      jest.advanceTimersByTime(300);
      await settle(fixture);

      expect(notFound(fixture)).toBeNull();
      expect(fixture.nativeElement.textContent).toContain(
        'resource.reference.noResults'
      );
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * The read of an ID is still out when the text changes. Its record must not
   * be chosen for a field that no longer holds the ID.
   */
  it('drops the read of an ID the field no longer holds', async () => {
    jest.useFakeTimers();
    try {
      let answer: (rows: readonly ReferenceOption[]) => void = () => undefined;
      const { fixture, emitted } = await render(
        lookupOf({
          search: (_resource, term) =>
            recordIdIn(term) === null
              ? Promise.resolve([scopes[0]])
              : new Promise((resolve) => (answer = resolve)),
        })
      );

      paste(fixture, MADRID);
      await settle(fixture);
      paste(fixture, 'cat');
      answer([scopes[1]]);
      await settle(fixture);

      expect(emitted).toEqual([]);

      jest.advanceTimersByTime(300);
      await settle(fixture);
      expect(emitted).toEqual([]);
      expect(fixture.componentInstance.options()).toEqual([scopes[0]]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not let Enter submit the form while the ID is being read', async () => {
    const { fixture } = await render(
      lookupOf({ search: () => new Promise(() => undefined) })
    );

    paste(fixture, MADRID);
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    field(fixture).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('does not call a failed read a missing record', async () => {
    const { fixture, emitted } = await render(
      lookupOf({ search: () => Promise.reject(new Error('down')) })
    );

    paste(fixture, MADRID);
    await settle(fixture);

    expect(emitted).toEqual([]);
    expect(notFound(fixture)).toBeNull();
  });

  /**
   * A resource with no read by ID answers a page of rows for any term. The
   * picker shows them and chooses none: an answer that is not exactly the
   * record with the ID is not a record found by ID.
   */
  it('chooses nothing when the answer is not the one record', async () => {
    const { fixture, emitted } = await render(
      lookupOf({ search: async () => scopes })
    );

    paste(fixture, NOBODY);
    await settle(fixture);

    expect(emitted).toEqual([]);
    expect(notFound(fixture)).toBeNull();
    expect(
      fixture.nativeElement.querySelectorAll('[role="option"]')
    ).toHaveLength(2);
  });
});
