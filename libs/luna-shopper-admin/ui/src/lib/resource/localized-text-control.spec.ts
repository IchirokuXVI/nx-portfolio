import { TestBed } from '@angular/core/testing';
import { LocalizedTextControl } from './localized-text-control';

/**
 * One input per locale, and one whole object out (plan 0004, sections 2 and 8).
 */
async function render(value: Record<string, string>) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LocalizedTextControl],
  }).compileComponents();

  const fixture = TestBed.createComponent(LocalizedTextControl);
  fixture.componentRef.setInput('controlId', 'field-name');
  fixture.componentRef.setInput('locales', ['en', 'es']);
  fixture.componentRef.setInput('value', value);
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

  it('gives each input its own id, so each label points at one box', async () => {
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
});
