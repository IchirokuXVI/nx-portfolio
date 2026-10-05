import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CautionLine } from './caution-line';

/** One line beside a mark, in one of three tones (admin plan 0052, section 3.11). */

@Component({
  imports: [CautionLine],
  template: `
    <lib-caution-line [text]="'Not saved.'" [tone]="tone()">
      <a href="/brands/b_1">Open that brand</a>
    </lib-caution-line>
  `,
})
class Host {
  readonly tone = signal<'caution' | 'refused' | 'saved'>('caution');
}

function render(tone?: 'caution' | 'refused' | 'saved') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [Host] });

  const fixture = TestBed.createComponent(Host);
  if (tone !== undefined) {
    fixture.componentInstance.tone.set(tone);
  }
  fixture.detectChanges();

  return (fixture.nativeElement as HTMLElement).querySelector(
    'lib-caution-line'
  ) as HTMLElement;
}

describe('CautionLine', () => {
  it('is a caution unless it is told otherwise: amber, with the warning mark, and only read', () => {
    const line = render();

    expect(line.getAttribute('data-tone')).toBe('caution');
    expect(line.getAttribute('role')).toBeNull();
    expect(line.querySelector('lib-warning-icon')).not.toBeNull();
    expect(line.querySelector('lib-check-icon')).toBeNull();
  });

  it('interrupts with a refusal, with the warning mark', () => {
    const line = render('refused');

    expect(line.getAttribute('data-tone')).toBe('refused');
    expect(line.getAttribute('role')).toBe('alert');
    expect(line.querySelector('lib-warning-icon')).not.toBeNull();
  });

  it('says a save went through in turn, with a check mark', () => {
    const line = render('saved');

    expect(line.getAttribute('data-tone')).toBe('saved');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.querySelector('lib-check-icon')).not.toBeNull();
    expect(line.querySelector('lib-warning-icon')).toBeNull();
  });

  it('draws the sentence, then the one link that follows it', () => {
    const text = render('refused').querySelector('.text');

    expect(text?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Not saved. Open that brand'
    );
    expect(text?.querySelector('a')?.getAttribute('href')).toBe('/brands/b_1');
  });
});
