import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PopoverSheet } from './popover-sheet';

/**
 * The panel that holds controls over the page (admin plan 0043): a panel
 * under its anchor on a wide screen and a sheet from the bottom on a phone.
 *
 * It closes nothing by itself. Each test below is one way it is asked to
 * close, and the host is what removes it.
 */

@Component({
  selector: 'lib-test-host',
  imports: [PopoverSheet],
  template: `
    <button #anchor type="button" data-anchor>Open</button>
    <button type="button" data-elsewhere>Elsewhere</button>
    @if (open()) {
      <lib-popover-sheet
        (closed)="closes.set(closes() + 1)"
        [anchor]="anchor"
        [sheet]="sheet()"
        heading="Categories"
      >
        <button type="button" data-first>First</button>
        <button type="button" data-last>Last</button>
      </lib-popover-sheet>
    }
  `,
})
class Host {
  readonly open = signal(true);
  readonly sheet = signal(false);
  readonly closes = signal(0);
}

async function render(sheet = false) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.sheet.set(sheet);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  // Past the moment the press that opened it could still be arriving.
  await new Promise((resolve) => setTimeout(resolve, 60));
  return fixture;
}

const q = (fixture: { nativeElement: HTMLElement }, selector: string) =>
  fixture.nativeElement.querySelector(selector) as HTMLElement | null;

afterEach(() => {
  document.body.replaceChildren();
  TestBed.resetTestingModule();
});

describe('PopoverSheet', () => {
  it('is a dialog named by its heading, and takes the focus when it opens', async () => {
    const fixture = await render();
    const panel = q(fixture, 'section[role="dialog"]');
    const heading = q(fixture, 'h2');

    expect(heading?.textContent).toBe('Categories');
    expect(panel?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(document.activeElement).toBe(panel);
  });

  it('is not modal as a panel, and has no scrim and no Close button', async () => {
    const fixture = await render(false);

    expect(q(fixture, 'section')?.getAttribute('aria-modal')).toBeNull();
    expect(q(fixture, '[data-sheet-scrim]')).toBeNull();
    expect(q(fixture, '.close')).toBeNull();
  });

  it('is modal as a sheet, with a scrim and a Close button', async () => {
    const fixture = await render(true);

    expect(q(fixture, 'section')?.getAttribute('aria-modal')).toBe('true');
    expect(q(fixture, '[data-sheet-scrim]')).not.toBeNull();
    expect(q(fixture, '.close')?.textContent?.trim()).toBe('info.close');
  });

  it('asks to close on Escape', async () => {
    const fixture = await render();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(fixture.componentInstance.closes()).toBe(1);
  });

  it('asks to close on a press outside the panel', async () => {
    const fixture = await render();

    q(fixture, '[data-elsewhere]')?.click();

    expect(fixture.componentInstance.closes()).toBe(1);
  });

  /** The anchor is the control that opened it, and closes it by itself. */
  it('leaves a press on its anchor and a press inside it alone', async () => {
    const fixture = await render();

    q(fixture, '[data-anchor]')?.click();
    q(fixture, '[data-first]')?.click();

    expect(fixture.componentInstance.closes()).toBe(0);
  });

  it('asks to close on the scrim and on the Close button of the sheet', async () => {
    const fixture = await render(true);

    q(fixture, '[data-sheet-scrim]')?.click();
    q(fixture, '.close')?.click();

    expect(fixture.componentInstance.closes()).toBe(2);
  });

  it('keeps Tab inside the sheet', async () => {
    const fixture = await render(true);
    const last = q(fixture, '[data-last]');
    last?.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    last?.dispatchEvent(event);

    // Wrapped to the first control of the sheet, which is its Close button.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q(fixture, '.close'));
  });

  it('lets Tab leave the panel on a wide screen', async () => {
    const fixture = await render(false);
    const last = q(fixture, '[data-last]');
    last?.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    last?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  /** jsdom resolves no layout, so the rule is read from the source. */
  it('moves only as a fade of 120 ms, and not at all under reduced motion', () => {
    const source = readFileSync(join(__dirname, 'popover-sheet.ts'), 'utf8');

    expect(source).toContain('animation: appear 120ms ease-out');
    expect(source).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.scrim,\s*\.panel \{\s*animation:/
    );
    expect(source).not.toMatch(/transform:|transition:/);
  });
});
