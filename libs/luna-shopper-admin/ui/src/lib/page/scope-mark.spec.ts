import { TestBed } from '@angular/core/testing';
import type { ScopeLevel } from '@portfolio/luna-shopper-admin/models';
import { ScopeMark } from './scope-mark';

async function render(level: ScopeLevel, label = '') {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ScopeMark],
  }).compileComponents();

  const fixture = TestBed.createComponent(ScopeMark);
  fixture.componentRef.setInput('level', level);
  fixture.componentRef.setInput('label', label);
  fixture.detectChanges();
  return fixture;
}

const filled = (host: HTMLElement) =>
  [...host.querySelectorAll('i')].map((bar) =>
    bar.classList.contains('filled')
  );

describe('ScopeMark', () => {
  /**
   * Nationwide 1, Chain region 2, Local area 3, Single shop 4 (admin plan 0041,
   * section 10): the narrower the scope, the more bars.
   */
  it.each([
    [1, [true, false, false, false]],
    [2, [true, true, false, false]],
    [3, [true, true, true, false]],
    [4, [true, true, true, true]],
  ] as const)('fills %i of its four bars', async (level, bars) => {
    const fixture = await render(level);

    expect(filled(fixture.nativeElement)).toEqual(bars);
  });

  it('takes the kind as its accessible name', async () => {
    const host: HTMLElement = (await render(3, 'Local area')).nativeElement;

    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Local area');
    expect(host.getAttribute('aria-hidden')).toBeNull();
  });

  /**
   * Beside a word that already says the kind, a named mark would have a screen
   * reader say it twice.
   */
  it('is hidden from a screen reader where the kind is written beside it', async () => {
    const host: HTMLElement = (await render(3)).nativeElement;

    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('aria-label')).toBeNull();
  });
});
