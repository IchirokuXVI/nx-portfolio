import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { Switch } from './switch';

/** A yes or no, as a switch (admin plan 0052, section 3.4). */

function render(checked: boolean, disabled = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Switch, RokuTranslatorTestingModule.forTesting()],
  });

  const fixture = TestBed.createComponent(Switch);
  fixture.componentRef.setInput('checked', checked);
  fixture.componentRef.setInput('controlId', 'field-available');
  fixture.componentRef.setInput('label', 'On sale');
  fixture.componentRef.setInput('disabled', disabled);
  fixture.detectChanges();

  const emitted: boolean[] = [];
  fixture.componentInstance.checkedChange.subscribe((value) =>
    emitted.push(value)
  );
  const host = fixture.nativeElement as HTMLElement;
  const button = host.querySelector('button') as HTMLButtonElement;

  return { fixture, host, button, emitted };
}

describe('Switch', () => {
  it('is a button with the role of a switch, named by the label of the field', () => {
    const { button } = render(true);

    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.id).toBe('field-available');
    expect(button.getAttribute('aria-label')).toBe('On sale');
  });

  it('says its state to a screen reader', () => {
    expect(render(true).button.getAttribute('aria-checked')).toBe('true');
    expect(render(false).button.getAttribute('aria-checked')).toBe('false');
  });

  /** The state is never colour alone. */
  it('writes Yes or No beside it, for the eye only', () => {
    const on = render(true).host.querySelector('[data-word]');
    const off = render(false).host.querySelector('[data-word]');

    expect(on?.textContent?.trim()).toBe('resource.value.yes');
    expect(off?.textContent?.trim()).toBe('resource.value.no');
    expect(on?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says the other value when it is pressed, and keeps the one it was given', () => {
    const { fixture, button, emitted } = render(false);

    button.click();
    fixture.detectChanges();

    expect(emitted).toEqual([true]);
    // It writes nothing: the form holds the value, and hands it back.
    expect(button.getAttribute('aria-checked')).toBe('false');

    fixture.componentRef.setInput('checked', true);
    fixture.detectChanges();
    button.click();

    expect(emitted).toEqual([true, false]);
  });

  it('says nothing while it is switched off', () => {
    const { button, emitted } = render(false, true);

    button.click();

    expect(button.disabled).toBe(true);
    expect(emitted).toEqual([]);
  });
});
