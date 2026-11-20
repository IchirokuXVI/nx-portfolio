import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { LineUnit } from '@portfolio/velista/models';
import { LineUnitChip } from './line-unit-chip';

/**
 * The unit chip (velista `0183`, section 2, acceptance criterion 4): drawn only
 * for two units or more, one radio for each, and `chosen` once per change.
 */
async function render(
  units: readonly LineUnit[],
  value: LineUnit,
  disabled = false
): Promise<{ fixture: ComponentFixture<LineUnitChip>; chosen: LineUnit[] }> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [LineUnitChip, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();
  const fixture = TestBed.createComponent(LineUnitChip);
  fixture.componentRef.setInput('units', units);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('disabled', disabled);
  const chosen: LineUnit[] = [];
  fixture.componentInstance.chosen.subscribe((unit) => chosen.push(unit));
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, chosen };
}

const segments = (fixture: ComponentFixture<LineUnitChip>) => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
    '[role="radio"]'
  ),
];

describe('LineUnitChip', () => {
  it('draws nothing for a line with one unit', async () => {
    const { fixture } = await render(['UNIT'], 'UNIT');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[role="radiogroup"]'
      )
    ).toBeNull();
  });

  it('draws three segments for three units, one radio group, the chosen one checked', async () => {
    const { fixture } = await render(['UNIT', 'GRAM', 'MILLILITER'], 'GRAM');
    const drawn = segments(fixture);
    expect(drawn.map((segment) => segment.textContent?.trim())).toEqual([
      'line.unit.UNIT',
      'line.unit.GRAM',
      'line.unit.MILLILITER',
    ]);
    expect(
      drawn.map((segment) => segment.getAttribute('aria-checked'))
    ).toEqual(['false', 'true', 'false']);
    // One tab stop, on the chosen segment.
    expect(drawn.map((segment) => segment.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('emits chosen once for another segment, and never for the chosen one', async () => {
    const { fixture, chosen } = await render(['UNIT', 'GRAM'], 'UNIT');
    segments(fixture)[0].click();
    segments(fixture)[1].click();
    expect(chosen).toEqual(['GRAM']);
  });

  it('moves the choice with the arrow keys, wrapping at the ends', async () => {
    const { fixture, chosen } = await render(['UNIT', 'GRAM'], 'UNIT');
    const arrow = (index: number) =>
      segments(fixture)[index].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' })
      );
    arrow(0);
    expect(document.activeElement).toBe(segments(fixture)[1]);
    fixture.componentRef.setInput('value', 'GRAM');
    fixture.detectChanges();
    arrow(1);
    expect(chosen).toEqual(['GRAM', 'UNIT']);
  });

  it('chooses nothing while the write is pending', async () => {
    const { fixture, chosen } = await render(['UNIT', 'GRAM'], 'UNIT', true);
    expect(
      segments(fixture).every(
        (segment) => segment.getAttribute('aria-disabled') === 'true'
      )
    ).toBe(true);
    // Never natively disabled, which would drop the focus to the body.
    expect(segments(fixture).some((segment) => segment.disabled)).toBe(false);
    segments(fixture)[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' })
    );
    segments(fixture)[1].click();
    expect(chosen).toEqual([]);
  });

  it('keeps the focus on the segment chosen by the keys while the write is pending', async () => {
    const { fixture, chosen } = await render(['UNIT', 'GRAM'], 'UNIT');
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    segments(fixture)[0].focus();
    segments(fixture)[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' })
    );
    expect(chosen).toEqual(['GRAM']);

    // The host disables the chip the moment the choice is sent.
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(segments(fixture)[1]);
    // A key while the write is out moves nothing and chooses nothing.
    segments(fixture)[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft' })
    );
    expect(document.activeElement).toBe(segments(fixture)[1]);
    expect(chosen).toEqual(['GRAM']);
    (fixture.nativeElement as HTMLElement).remove();
  });
});
