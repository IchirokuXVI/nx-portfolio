import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { SaveBarState } from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '../viewport';
import { SaveBar } from './save-bar';

/**
 * The one place Save and Cancel live (admin plan 0052, section 3.10). One
 * case for each state of the table there. The testing translator answers the
 * key, so the words are asserted by their key.
 */

function render(state: SaveBarState, compact = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [SaveBar, RokuTranslatorTestingModule.forTesting()],
    providers: [{ provide: Viewport, useValue: { compact: signal(compact) } }],
  });

  const fixture = TestBed.createComponent(SaveBar);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('saveLabel', 'Save');
  fixture.detectChanges();

  const said: string[] = [];
  fixture.componentInstance.save.subscribe(() => said.push('save'));
  fixture.componentInstance.cancel.subscribe(() => said.push('cancel'));
  fixture.componentInstance.goToFirst.subscribe(() => said.push('goToFirst'));

  const host = fixture.nativeElement as HTMLElement;

  return {
    host,
    said,
    words: host.querySelector('[data-save-words]') as HTMLElement,
    save: host.querySelector('[data-save]') as HTMLButtonElement,
    cancel: host.querySelector('[data-cancel]') as HTMLButtonElement,
    first: host.querySelector<HTMLButtonElement>('[data-go-to-first]'),
  };
}

/** What one state draws: the words, and which of the two buttons are on. */
function drawn(state: SaveBarState) {
  const bar = render(state);

  return {
    words: bar.words.textContent?.trim(),
    role: bar.words.getAttribute('role'),
    save: !bar.save.disabled,
    cancel: !bar.cancel.disabled,
    saveSays: bar.save.textContent?.trim(),
  };
}

describe('SaveBar', () => {
  it('says there is nothing to save, and offers only Cancel', () => {
    expect(drawn({ kind: 'clean' })).toEqual({
      words: 'record.save.clean',
      role: 'status',
      save: false,
      cancel: true,
      saveSays: 'Save',
    });
  });

  it('counts the unsaved changes, and offers both', () => {
    expect(drawn({ kind: 'dirty', changes: 2 })).toEqual({
      words: 'record.save.dirty',
      role: 'status',
      save: true,
      cancel: true,
      saveSays: 'Save',
    });
  });

  it('counts the required fields still empty, and keeps Save off', () => {
    expect(drawn({ kind: 'missing', required: 2 })).toEqual({
      words: 'record.save.missing',
      role: 'status',
      save: false,
      cancel: true,
      saveSays: 'Save',
    });
  });

  it('says it is saving on the bar and on the button, and offers neither', () => {
    expect(drawn({ kind: 'saving' })).toEqual({
      words: 'resource.action.saving',
      role: 'status',
      save: false,
      cancel: false,
      saveSays: 'resource.action.saving',
    });
  });

  it('interrupts with what was refused, and offers both again', () => {
    expect(drawn({ kind: 'invalid', fields: 2 })).toEqual({
      words: 'record.save.invalid',
      role: 'alert',
      save: true,
      cancel: true,
      saveSays: 'Save',
    });
  });

  it('says a refusal of the server kept the changes, and offers both again', () => {
    expect(drawn({ kind: 'refused' })).toEqual({
      words: 'record.save.refused',
      role: 'status',
      save: true,
      cancel: true,
      saveSays: 'Save',
    });
  });

  it('offers the way to the first refused field only when a field was refused', () => {
    const invalid = render({ kind: 'invalid', fields: 2 });

    expect(invalid.first?.textContent?.trim()).toBe('record.save.goToFirst');
    expect(invalid.first?.getAttribute('type')).toBe('button');
    // Beside the alert and not inside it: the alert is the sentence.
    expect(invalid.words.contains(invalid.first)).toBe(false);

    for (const state of [
      { kind: 'clean' },
      { kind: 'dirty', changes: 1 },
      { kind: 'missing', required: 1 },
      { kind: 'saving' },
      { kind: 'refused' },
    ] satisfies SaveBarState[]) {
      expect([state.kind, render(state).first]).toEqual([state.kind, null]);
    }
  });

  it('says what was pressed, and nothing else', () => {
    const bar = render({ kind: 'invalid', fields: 1 });

    bar.save.click();
    bar.cancel.click();
    bar.first?.click();

    expect(bar.said).toEqual(['save', 'cancel', 'goToFirst']);
  });

  it('says nothing for a press on a button that is off', () => {
    const bar = render({ kind: 'saving' });

    bar.save.click();
    bar.cancel.click();

    expect(bar.said).toEqual([]);
  });

  it('carries the label it is given on the button', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SaveBar, RokuTranslatorTestingModule.forTesting()],
    });
    const fixture = TestBed.createComponent(SaveBar);
    fixture.componentRef.setInput('state', { kind: 'dirty', changes: 1 });
    fixture.componentRef.setInput('saveLabel', 'Add product');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-save]')
        ?.textContent?.trim()
    ).toBe('Add product');
  });
});

describe('SaveBar on a phone', () => {
  it('keeps the words for a screen reader and takes them off the screen', () => {
    const bar = render({ kind: 'dirty', changes: 2 }, true);

    expect(bar.words.classList).toContain('sr-only');
    expect(bar.words.textContent?.trim()).toBe('record.save.dirty');
    expect(render({ kind: 'dirty', changes: 2 }).words.classList).not.toContain(
      'sr-only'
    );
  });

  it('carries the count on the button', () => {
    expect(
      render({ kind: 'dirty', changes: 2 }, true).save.textContent?.trim()
    ).toBe('record.save.saveCount');
  });

  /** The page moves to the first refused field there. That is its job. */
  it('says Save again after a refusal, with no link to the first field', () => {
    const invalid = render({ kind: 'invalid', fields: 2 }, true);
    const refused = render({ kind: 'refused' }, true);

    expect(invalid.save.textContent?.trim()).toBe('Save');
    expect(invalid.first).toBeNull();
    expect(invalid.words.getAttribute('role')).toBe('alert');
    expect(refused.save.textContent?.trim()).toBe('Save');
  });
});
