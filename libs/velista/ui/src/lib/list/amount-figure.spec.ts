import { TestBed } from '@angular/core/testing';
import { AmountFigure } from './amount-figure';

describe('AmountFigure (velista 0188, section 3.1)', () => {
  function render(inputs: Record<string, unknown>): HTMLElement {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(AmountFigure);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: HTMLElement, selector: string) =>
    el.querySelector(selector)?.textContent ?? null;

  it('draws the short form as a number over its symbol, hidden from a reader', () => {
    const el = render({ quantity: 1275, unit: 'GRAM' });
    expect(text(el, '.number')).toBe('1.28');
    expect(text(el, '.symbol')).toBe('kg');
    expect(el.querySelector('.number')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(el.querySelector('.symbol')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(text(el, '.visually-hidden')).toBe('1.275 kilograms');
  });

  it('draws the exact form', () => {
    const el = render({ quantity: 1275, unit: 'GRAM', form: 'exact' });
    expect(text(el, '.number')).toBe('1.275');
    expect(text(el, '.symbol')).toBe('kg');
  });

  it('draws a count under a thousand with no symbol, one step larger', () => {
    const el = render({ quantity: 12 });
    expect(text(el, '.number')).toBe('12');
    expect(el.querySelector('.symbol')).toBeNull();
    expect(el.classList).toContain('is-bare');
  });

  it('marks a six character figure long, and zero', () => {
    expect(render({ quantity: 125_250, unit: 'GRAM' }).classList).toContain(
      'is-long'
    );
    expect(render({ quantity: 0 }).classList).toContain('is-zero');
  });

  it('carries no spoken words when speak is off', () => {
    const el = render({ quantity: 750, unit: 'GRAM', speak: false });
    expect(el.querySelector('.visually-hidden')).toBeNull();
  });
});
