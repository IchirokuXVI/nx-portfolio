import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SheetShell } from './sheet-shell';

/**
 * A host, because everything worth asserting about a sheet is about the content it
 * projects: where focus goes, where Tab stops, and what a dismissal does.
 */
@Component({
  selector: 'lib-sheet-host',
  imports: [SheetShell],
  template: `
    <lib-sheet-shell
      (dismiss)="dismissals.set(dismissals() + 1)"
      [dismissible]="dismissible()"
      labelledBy="host-title"
    >
      <h2 id="host-title">Name your group</h2>
      <input class="first" />
      <button class="last" type="button">Cancel</button>
    </lib-sheet-shell>
  `,
})
class SheetHost {
  readonly dismissible = signal(true);
  readonly dismissals = signal(0);
}

async function render(): Promise<ComponentFixture<SheetHost>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SheetHost],
  }).compileComponents();

  const fixture = TestBed.createComponent(SheetHost);
  fixture.detectChanges();
  // `afterNextRender` is what moves focus, and it runs after the render rather than
  // during it, so the fixture has to be allowed to settle before focus is asserted.
  await fixture.whenStable();

  return fixture;
}

function query(fixture: ComponentFixture<SheetHost>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

describe('SheetShell', () => {
  describe('what it announces', () => {
    it('is a modal dialog named by the title the caller rendered', async () => {
      const fixture = await render();
      const panel = query(fixture, '.panel') as HTMLElement;

      expect(panel.getAttribute('role')).toBe('dialog');
      expect(panel.getAttribute('aria-modal')).toBe('true');
      expect(panel.getAttribute('aria-labelledby')).toBe('host-title');
    });
  });

  describe('focus', () => {
    it('moves to the first control inside, which is the field', async () => {
      // Focusing the panel would announce the dialog and then leave the person a tab
      // away from the only control that matters.
      const fixture = await render();

      expect(document.activeElement).toBe(query(fixture, '.first'));
    });

    it('wraps from the last control back to the first', async () => {
      // Without this the next Tab lands on the page behind the scrim, which is
      // visible, focusable and covered.
      const fixture = await render();
      (query(fixture, '.last') as HTMLElement).focus();

      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
      );

      expect(document.activeElement).toBe(query(fixture, '.first'));
    });

    it('wraps backwards from the first control to the last', async () => {
      const fixture = await render();

      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
        })
      );

      expect(document.activeElement).toBe(query(fixture, '.last'));
    });
  });

  describe('dismissal', () => {
    it('asks to close when the scrim is tapped', async () => {
      const fixture = await render();

      (query(fixture, '.scrim') as HTMLButtonElement).click();

      expect(fixture.componentInstance.dismissals()).toBe(1);
    });

    it('asks to close on Escape, which is the back button on a phone', async () => {
      const fixture = await render();

      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );

      expect(fixture.componentInstance.dismissals()).toBe(1);
    });

    it('refuses both while a mutation is in flight', async () => {
      // The request has already gone. Closing would leave the person unable to see
      // what happened to a group that may well now exist (plan 0008, section 3.1).
      const fixture = await render();
      fixture.componentInstance.dismissible.set(false);
      fixture.detectChanges();

      (query(fixture, '.scrim') as HTMLButtonElement).click();
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );

      expect(fixture.componentInstance.dismissals()).toBe(0);
    });
  });
});
