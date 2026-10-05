import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { LocalizedTextControl } from './localized-text-control';

/**
 * One input per locale, and one whole object out (plan 0004, sections 2 and 8).
 */
async function render(
  value: Record<string, string>,
  inputs: Record<string, unknown> = {}
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LocalizedTextControl, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(LocalizedTextControl);
  fixture.componentRef.setInput('controlId', 'field-name');
  fixture.componentRef.setInput('locales', ['en', 'es']);
  fixture.componentRef.setInput('value', value);
  for (const [name, held] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, held);
  }
  fixture.detectChanges();

  return fixture;
}

describe('LocalizedTextControl', () => {
  it('renders one input per locale', async () => {
    const fixture = await render({ en: 'Milk', es: 'Leche' });
    const inputs = fixture.nativeElement.querySelectorAll(
      'input'
    ) as NodeListOf<HTMLInputElement>;

    expect(inputs).toHaveLength(2);
    expect([...inputs].map((input) => input.value)).toEqual(['Milk', 'Leche']);
  });

  it('gives each input its own id', async () => {
    const fixture = await render({ en: '', es: '' });
    const inputs = fixture.nativeElement.querySelectorAll(
      'input'
    ) as NodeListOf<HTMLInputElement>;

    expect([...inputs].map((input) => input.id)).toEqual([
      'field-name-en',
      'field-name-es',
    ]);
  });

  /**
   * The whole object, never the one locale that changed. The value is a single
   * column, and emitting a partial object would erase the other language the
   * moment the form submitted.
   */
  it('emits every locale when one of them changes', async () => {
    const fixture = await render({ en: 'Milk', es: 'Leche' });
    const emitted: Record<string, string>[] = [];
    fixture.componentInstance.valueChange.subscribe((value) =>
      emitted.push({ ...value })
    );

    const spanish = fixture.nativeElement.querySelectorAll('input')[1];
    spanish.value = 'Leche entera';
    spanish.dispatchEvent(new Event('input'));

    expect(emitted).toEqual([{ en: 'Milk', es: 'Leche entera' }]);
  });

  it('shows an empty box for a locale the value does not have', async () => {
    const fixture = await render({ en: 'Milk' });
    const inputs = fixture.nativeElement.querySelectorAll(
      'input'
    ) as NodeListOf<HTMLInputElement>;

    expect([...inputs].map((input) => input.value)).toEqual(['Milk', '']);
  });

  /**
   * Admin plan 0052, section 3.7. The tag is the code of the language, for
   * the eye. The box is named in words, by one key that takes the label of
   * the field and the language. The testing translator answers the key.
   */
  it('hides the tag from a screen reader and names each box in words', async () => {
    const fixture = await render({ en: '', es: '' }, { label: 'Name' });
    const host = fixture.nativeElement as HTMLElement;
    const tags = [...host.querySelectorAll('.locale')];

    expect(tags.map((tag) => tag.textContent?.trim())).toEqual(['en', 'es']);
    expect(tags.map((tag) => tag.getAttribute('aria-hidden'))).toEqual([
      'true',
      'true',
    ]);
    expect(host.querySelector('label')).toBeNull();
    expect(
      [...host.querySelectorAll('input')].map((input) =>
        input.getAttribute('aria-label')
      )
    ).toEqual(['record.localized.in', 'record.localized.in']);
  });

  it('names the box of a list in words too', async () => {
    const fixture = await render({ en: '', es: '' }, { list: true });

    expect(
      [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll('textarea'),
      ].map((box) => box.getAttribute('aria-label'))
    ).toEqual(['record.localized.in', 'record.localized.in']);
  });

  /** A refusal is about the field, and one box is where it is tied. */
  it('puts a refusal on the box of the first language', async () => {
    const fixture = await render(
      { en: '', es: '' },
      { invalid: true, describedBy: 'field-name-error-0' }
    );
    const [first, second] = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('input'),
    ];

    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(first.getAttribute('aria-describedby')).toBe('field-name-error-0');
    expect(second.getAttribute('aria-invalid')).toBeNull();
    expect(second.getAttribute('aria-describedby')).toBeNull();
  });

  it('says nothing about a refusal while there is none', async () => {
    const fixture = await render({ en: '', es: '' });
    const first = (fixture.nativeElement as HTMLElement).querySelector('input');

    expect(first?.getAttribute('aria-invalid')).toBeNull();
    expect(first?.getAttribute('aria-describedby')).toBeNull();
  });
});
