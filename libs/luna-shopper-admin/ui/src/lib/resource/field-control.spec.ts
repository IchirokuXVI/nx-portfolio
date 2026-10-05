import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  FieldDescriptor,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { Switch } from '../record/switch';
import { FieldControl } from './field-control';
import { LocalizedTextControl } from './localized-text-control';
import { ReferencePicker } from './reference-picker';
import { ReferencesControl } from './references-control';

/**
 * Whether a reference field of a form offers "None" (admin plan 0050,
 * section 2). The descriptor decides, and the picker is told and told nothing
 * else.
 */

function emptyOf(overrides: Partial<FieldDescriptor<ResourceRow>>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FieldControl, RokuTranslatorTestingModule.forTesting()],
  });

  const fixture = TestBed.createComponent(FieldControl);
  fixture.componentRef.setInput('field', {
    kind: 'reference',
    name: 'productGroupId',
    label: 'field.group',
    resource: 'product-groups',
    ...overrides,
  });
  fixture.componentRef.setInput('value', '');
  fixture.componentRef.setInput('controlId', 'field-productGroupId');
  fixture.detectChanges();

  const picker: ReferencePicker = fixture.debugElement.query(
    By.directive(ReferencePicker)
  ).componentInstance;
  return picker.empty();
}

/** One field of any kind, drawn. */
function render(
  field: Partial<FieldDescriptor<ResourceRow>> & { kind: string },
  value: unknown,
  inputs: Record<string, unknown> = {}
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FieldControl, RokuTranslatorTestingModule.forTesting()],
  });

  const fixture = TestBed.createComponent(FieldControl);
  fixture.componentRef.setInput('field', {
    name: 'value',
    label: 'field.label',
    ...field,
  });
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('controlId', 'field-value');
  for (const [name, held] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, held);
  }
  fixture.detectChanges();

  const emitted: unknown[] = [];
  fixture.componentInstance.valueChange.subscribe((next) => emitted.push(next));

  return { fixture, host: fixture.nativeElement as HTMLElement, emitted };
}

/** Admin plan 0052, section 3.3. */
describe('a yes or no of a form', () => {
  it('is a switch, named by the label of the field, and no check box', () => {
    const { fixture, host } = render({ kind: 'boolean' }, true);
    const toggle: Switch = fixture.debugElement.query(
      By.directive(Switch)
    ).componentInstance;

    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(toggle.checked()).toBe(true);
    expect(toggle.label()).toBe('field.label');
    expect(host.querySelector('[role="switch"]')?.id).toBe('field-value');
  });

  /** It says what was pressed. The form holds the value until Save. */
  it('emits the other value when the switch is pressed', () => {
    const { host, emitted } = render({ kind: 'boolean' }, false);

    (host.querySelector('[role="switch"]') as HTMLButtonElement).click();

    expect(emitted).toEqual([true]);
  });

  it('keeps the select of three answers where the column has three', () => {
    const { host, emitted } = render({ kind: 'boolean', nullable: true }, null);
    const select = host.querySelector('select') as HTMLSelectElement;

    expect(host.querySelector('[role="switch"]')).toBeNull();
    expect([...select.options].map((option) => option.value)).toEqual([
      '',
      'true',
      'false',
    ]);

    select.value = 'false';
    select.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([false]);
  });
});

describe('a control that was refused', () => {
  const refused = {
    invalid: true,
    describedBy: 'field-value-error-0 field-value-help',
  };

  const kinds: readonly (readonly [
    string,
    Record<string, unknown>,
    unknown,
  ])[] = [
    ['input', { kind: 'text' }, 'x'],
    ['textarea', { kind: 'text', multiline: true }, 'x'],
    ['textarea', { kind: 'json' }, '{}'],
    ['input', { kind: 'number' }, '1'],
    ['input', { kind: 'money', decimals: 2 }, '1.35'],
    ['input', { kind: 'date' }, '2026-10-09'],
    ['select', { kind: 'enum', options: [] }, ''],
    ['select', { kind: 'boolean', nullable: true }, null],
    ['input', { kind: 'reference', resource: 'brands' }, ''],
    ['input', { kind: 'references', resource: 'categories' }, []],
    ['input', { kind: 'localized-text', locales: ['es', 'en'] }, {}],
  ];

  it('says so on the control, and names the lines that say why', () => {
    for (const [selector, field, value] of kinds) {
      const control = render(
        field as { kind: string },
        value,
        refused
      ).host.querySelector(selector);

      expect([
        field['kind'],
        control?.getAttribute('aria-invalid'),
        control?.getAttribute('aria-describedby'),
      ]).toEqual([field['kind'], 'true', refused.describedBy]);
    }
  });

  it('says neither while nothing was refused', () => {
    for (const [selector, field, value] of kinds) {
      const control = render(
        field as { kind: string },
        value
      ).host.querySelector(selector);

      expect([
        field['kind'],
        control?.getAttribute('aria-invalid'),
        control?.getAttribute('aria-describedby'),
      ]).toEqual([field['kind'], null, null]);
    }
  });

  it('carries required on the control itself', () => {
    const input = (required: boolean) =>
      render({ kind: 'text', required }, '').host.querySelector(
        'input'
      ) as HTMLInputElement;

    expect(input(true).required).toBe(true);
    expect(input(false).required).toBe(false);
  });
});

describe('a text field of a form, by its format', () => {
  it('sets a code in the mono face, in a short box', () => {
    const input = render(
      { kind: 'text', format: 'code' },
      '8480000'
    ).host.querySelector('input');

    expect(input?.classList).toContain('mono');
    expect(input?.classList).toContain('short');
  });

  it('sets plain text in neither', () => {
    const input = render({ kind: 'text' }, 'Sevilla').host.querySelector(
      'input'
    );

    expect(input?.classList).not.toContain('mono');
    expect(input?.classList).not.toContain('short');
  });

  it('draws a number, an amount and a date in a short box', () => {
    for (const field of [
      { kind: 'number' },
      { kind: 'money', decimals: 2 },
      { kind: 'date' },
    ]) {
      expect([
        field.kind,
        render(field, '')
          .host.querySelector('input')
          ?.classList.contains('short'),
      ]).toEqual([field.kind, true]);
    }
  });

  it('draws the picture of an address beside the field once it loads', () => {
    const { fixture, host } = render(
      { kind: 'text', format: 'image' },
      'https://cdn/x.png'
    );
    const picture = host.querySelector('[data-picture]') as HTMLImageElement;

    expect(picture.getAttribute('src')).toBe('https://cdn/x.png');
    expect(picture.getAttribute('alt')).toBe('');
    expect(picture.classList).not.toContain('loaded');

    picture.dispatchEvent(new Event('load'));
    fixture.detectChanges();

    expect(picture.classList).toContain('loaded');
    // The field is still the control: the picture is beside it.
    expect((host.querySelector('input') as HTMLInputElement).value).toBe(
      'https://cdn/x.png'
    );
  });

  it('draws no picture for an address that does not load, or for none', () => {
    const { fixture, host } = render(
      { kind: 'text', format: 'image' },
      'https://cdn/x.png'
    );
    const picture = host.querySelector('[data-picture]') as HTMLImageElement;

    picture.dispatchEvent(new Event('load'));
    picture.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(picture.classList).not.toContain('loaded');
    expect(
      render({ kind: 'text', format: 'image' }, '').host.querySelector(
        '[data-picture]'
      )
    ).toBeNull();
    expect(
      render({ kind: 'text' }, 'https://cdn/x.png').host.querySelector(
        '[data-picture]'
      )
    ).toBeNull();
  });
});

describe('several references of a form', () => {
  it('tells the rows whether their order counts', () => {
    const orderedOf = (field: Record<string, unknown>) =>
      render({ kind: 'references', resource: 'categories', ...field }, [])
        .fixture.debugElement.query(By.directive(ReferencesControl))
        .componentInstance.ordered();

    expect(orderedOf({ ordered: true })).toBe(true);
    expect(orderedOf({})).toBe(false);
  });
});

describe('a text in several languages of a form', () => {
  it('hands the label of the field to the boxes, for their names', () => {
    const control: LocalizedTextControl = render(
      { kind: 'localized-text', locales: ['es', 'en'] },
      {}
    ).fixture.debugElement.query(
      By.directive(LocalizedTextControl)
    ).componentInstance;

    expect(control.label()).toBe('field.label');
  });
});

describe('a reference field of a form', () => {
  it('offers None where the column takes null', () => {
    expect(emptyOf({ nullable: true })).toBe('none');
  });

  /** The server refuses the row without it, so the list has no way to empty it. */
  it('offers no empty choice where it does not', () => {
    expect(emptyOf({})).toBeNull();
    expect(emptyOf({ required: true })).toBeNull();
  });

  it('lets the descriptor overrule the column, both ways', () => {
    expect(emptyOf({ nullable: true, emptyOption: false })).toBeNull();
    expect(emptyOf({ emptyOption: true })).toBe('none');
  });
});
