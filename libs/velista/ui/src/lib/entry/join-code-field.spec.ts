import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { isCompleteJoinCode } from './join-code';
import { JoinCodeField } from './join-code-field';

/**
 * Velista `0160`, item 5: a code pasted with a space in front kept losing its last
 * character, because `maxlength` cut the raw paste before the field could drop the
 * space. The host stands in for the join sheet, whose Ask to join enables at exactly
 * eight characters.
 */
@Component({
  imports: [JoinCodeField],
  template: `
    <lib-join-code-field [(value)]="code" fieldId="code" />
    <button [disabled]="!complete()" class="ask" type="button">Ask</button>
  `,
})
class Host {
  readonly code = signal('');
  complete(): boolean {
    return isCompleteJoinCode(this.code());
  }
}

async function render(): Promise<ComponentFixture<Host>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

function field(fixture: ComponentFixture<Host>): HTMLInputElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    'input'
  ) as HTMLInputElement;
}

function ask(fixture: ComponentFixture<Host>): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '.ask'
  ) as HTMLButtonElement;
}

/** What the browser does: the new raw value, then one input event naming how. */
function enter(
  fixture: ComponentFixture<Host>,
  raw: string,
  inputType: string
): void {
  const input = field(fixture);
  input.value = raw;
  const event = new Event('input', { bubbles: true });
  Object.defineProperty(event, 'inputType', { value: inputType });
  input.dispatchEvent(event);
  fixture.detectChanges();
}

describe('JoinCodeField', () => {
  it('lets the whole paste reach the field, so nothing is cut before it is cleaned', async () => {
    const fixture = await render();

    expect(field(fixture).hasAttribute('maxlength')).toBe(false);
  });

  it.each([' 6WQKCPKS', '6WQK CPKS', '6wqkcpks '])(
    'holds 6WQKCPKS after %p is pasted, and enables Ask to join',
    async (pasted) => {
      const fixture = await render();

      enter(fixture, pasted, 'insertFromPaste');

      expect(field(fixture).value).toBe('6WQKCPKS');
      expect(fixture.componentInstance.code()).toBe('6WQKCPKS');
      expect(ask(fixture).disabled).toBe(false);
    }
  );

  it('keeps the code of a pasted share link', async () => {
    const fixture = await render();

    enter(fixture, 'https://velista.app/en/join/6WQKCPKS', 'insertFromPaste');

    expect(field(fixture).value).toBe('6WQKCPKS');
  });

  it('ignores a ninth typed character, as a full field did before', async () => {
    const fixture = await render();

    enter(fixture, '6WQKCPKS', 'insertFromPaste');
    enter(fixture, '6WQKCPKSX', 'insertText');

    expect(field(fixture).value).toBe('6WQKCPKS');
    expect(fixture.componentInstance.code()).toBe('6WQKCPKS');
  });

  it('takes a character typed over a selected full code', async () => {
    const fixture = await render();

    enter(fixture, '6WQKCPKS', 'insertFromPaste');
    enter(fixture, 'h', 'insertText');

    expect(field(fixture).value).toBe('H');
  });
});
