import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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

/**
 * A second host, because the footer is the one thing about the shell that only exists
 * when a caller asks for it, and the assertion that matters is where the two halves
 * end up relative to the scroll (plan 0040, section 5).
 */
@Component({
  selector: 'lib-sheet-footer-host',
  imports: [SheetShell],
  template: `
    <lib-sheet-shell [hasFooter]="true" labelledBy="footer-host-title">
      <h2 id="footer-host-title">List settings</h2>
      <p class="row">Somebody on the list</p>

      <div class="actions" sheetFooter>
        <button class="save" type="button">Save</button>
      </div>
    </lib-sheet-shell>
  `,
})
class FooterSheetHost {}

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

async function renderWithFooter(): Promise<ComponentFixture<FooterSheetHost>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [FooterSheetHost],
  }).compileComponents();

  const fixture = TestBed.createComponent(FooterSheetHost);
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

function query(fixture: ComponentFixture<unknown>, selector: string) {
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

    it('closes at once when there is no motion to wait for', async () => {
      // Which is jsdom, where no stylesheet is loaded, and equally a real browser
      // under `prefers-reduced-motion`, where the token is `0ms`. One code path.
      const fixture = await render();

      (query(fixture, '.scrim') as HTMLButtonElement).click();

      expect(query(fixture, '.panel')?.classList.contains('closing')).toBe(
        false
      );
      expect(fixture.componentInstance.dismissals()).toBe(1);
    });

    it('lets the panel fall before it asks to close', async () => {
      jest.useFakeTimers();
      try {
        const fixture = await render();
        const shell = fixture.debugElement.children[0]
          .componentInstance as SheetShell;

        // The token is what the shell times itself by, and jsdom resolves it to
        // nothing, so the duration is handed over directly instead.
        jest
          .spyOn(
            shell as unknown as { _motionDuration(): number },
            '_motionDuration'
          )
          .mockReturnValue(200);

        (query(fixture, '.scrim') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(query(fixture, '.panel')?.classList.contains('closing')).toBe(
          true
        );
        expect(fixture.componentInstance.dismissals()).toBe(0);

        jest.advanceTimersByTime(200);

        expect(fixture.componentInstance.dismissals()).toBe(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('cannot be closed twice while it is falling', async () => {
      // The scrim is disabled for the same reason, so this covers the keyboard path
      // that the disabled attribute does not.
      jest.useFakeTimers();
      try {
        const fixture = await render();
        const shell = fixture.debugElement.children[0]
          .componentInstance as SheetShell;
        jest
          .spyOn(
            shell as unknown as { _motionDuration(): number },
            '_motionDuration'
          )
          .mockReturnValue(200);

        shell.requestDismiss();
        shell.requestDismiss();
        fixture.detectChanges();

        expect((query(fixture, '.scrim') as HTMLButtonElement).disabled).toBe(
          true
        );

        jest.advanceTimersByTime(200);

        expect(fixture.componentInstance.dismissals()).toBe(1);
      } finally {
        jest.useRealTimers();
      }
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

  /**
   * The handle has advertised a downward drag since the sheet existed and answered
   * none of them: it was decorative, so the gesture went to the browser, which reads a
   * pull at the top of the document as a request to reload. The sheet lost its own
   * gesture and the page came back from the network.
   *
   * jsdom has no layout, so the panel measures zero and `MIN_DISMISS_DISTANCE` is the
   * whole threshold here, and no motion token resolves so a dismissal is synchronous.
   * Both are what make the distances in these tests readable rather than incidental.
   */
  describe('the drag handle', () => {
    /** A pointer event jsdom will construct, since it has no `PointerEvent`. */
    function pointer(
      type: string,
      clientY: number,
      timeStamp: number
    ): PointerEvent {
      const event = new MouseEvent(type, {
        clientY,
        bubbles: true,
      }) as unknown as { pointerId: number; timeStamp: number };
      event.pointerId = 1;
      // `timeStamp` is read only on a real event, and the speed of a drag is the one
      // thing these tests have to be able to state exactly.
      Object.defineProperty(event, 'timeStamp', { value: timeStamp });

      return event as unknown as PointerEvent;
    }

    /**
     * Drag the handle down `distance` px over `overMs`, in five steps, and let go.
     *
     * Five, so the trail has something to measure a speed across; the count itself is
     * not meaningful and no assertion depends on it.
     */
    function drag(
      fixture: ComponentFixture<SheetHost>,
      distance: number,
      overMs: number
    ): void {
      const grabber = query(fixture, '.grabber') as HTMLElement;
      // jsdom has no pointer capture, and the shell asks for it unconditionally.
      grabber.setPointerCapture = () => undefined;

      grabber.dispatchEvent(pointer('pointerdown', 0, 0));
      for (let step = 1; step <= 5; step++) {
        grabber.dispatchEvent(
          pointer('pointermove', (distance * step) / 5, (overMs * step) / 5)
        );
      }
      grabber.dispatchEvent(pointer('pointerup', distance, overMs));
      fixture.detectChanges();
    }

    it('follows the finger down while the drag is in progress', async () => {
      const fixture = await render();
      const grabber = query(fixture, '.grabber') as HTMLElement;
      grabber.setPointerCapture = () => undefined;

      grabber.dispatchEvent(pointer('pointerdown', 0, 0));
      grabber.dispatchEvent(pointer('pointermove', 40, 16));
      fixture.detectChanges();

      const panel = query(fixture, '.panel') as HTMLElement;
      expect(panel.style.transform).toBe('translateY(40px)');
      expect(panel.classList.contains('dragging')).toBe(true);
    });

    it('does not follow it up, because there is nothing above a bottom sheet', async () => {
      const fixture = await render();
      const grabber = query(fixture, '.grabber') as HTMLElement;
      grabber.setPointerCapture = () => undefined;

      grabber.dispatchEvent(pointer('pointerdown', 0, 0));
      grabber.dispatchEvent(pointer('pointermove', -80, 16));
      fixture.detectChanges();

      expect((query(fixture, '.panel') as HTMLElement).style.transform).toBe(
        'translateY(0px)'
      );
    });

    it('closes when the pull goes far enough', async () => {
      const fixture = await render();

      drag(fixture, 120, 400);

      expect(fixture.componentInstance.dismissals()).toBe(1);
    });

    it('closes on a flick, which barely moves', async () => {
      // The fast gesture is the short one. Distance alone would spring this back,
      // which reads as the sheet refusing the most natural way to throw it away.
      const fixture = await render();

      drag(fixture, 40, 40);

      expect(fixture.componentInstance.dismissals()).toBe(1);
    });

    it('springs back from a short, slow pull', async () => {
      // A thumb resting on the handle while reading is not a dismissal.
      const fixture = await render();

      drag(fixture, 20, 400);

      expect(fixture.componentInstance.dismissals()).toBe(0);
      expect((query(fixture, '.panel') as HTMLElement).style.transform).toBe(
        'translateY(0px)'
      );
    });

    it('springs back when the browser takes the gesture over', async () => {
      // `pointercancel`, which is the browser saying it has claimed the pointer. A
      // drag that did not happen must not close anything, however far it had gone.
      const fixture = await render();
      const grabber = query(fixture, '.grabber') as HTMLElement;
      grabber.setPointerCapture = () => undefined;

      grabber.dispatchEvent(pointer('pointerdown', 0, 0));
      grabber.dispatchEvent(pointer('pointermove', 300, 100));
      grabber.dispatchEvent(pointer('pointercancel', 300, 120));
      fixture.detectChanges();

      expect(fixture.componentInstance.dismissals()).toBe(0);
    });

    it('cannot be dragged away while a mutation is in flight', async () => {
      const fixture = await render();
      fixture.componentInstance.dismissible.set(false);
      fixture.detectChanges();

      drag(fixture, 300, 200);

      expect(fixture.componentInstance.dismissals()).toBe(0);
      expect((query(fixture, '.panel') as HTMLElement).style.transform).toBe(
        ''
      );
    });

    it('stays out of the focus trap', async () => {
      // Dragging is a convenience on top of Escape, Cancel and the back button. A
      // fourth control, first in document order, would take the field's focus.
      const fixture = await render();
      const grabber = query(fixture, '.grabber') as HTMLElement;

      expect(grabber.getAttribute('aria-hidden')).toBe('true');
      expect(grabber.hasAttribute('tabindex')).toBe(false);
      expect(document.activeElement).toBe(query(fixture, '.first'));
    });
  });

  /**
   * The overlap this plan fixes is a layout fact, and jsdom has neither layout nor the
   * component's stylesheet: nothing here can see a bar painted over a row, and asking
   * for the body's `overflow-y` answers the empty string. What it can see is the
   * structure that makes the overlap impossible, which is that the footer is not inside
   * the element that scrolls. That is the property, and the pixels follow from it.
   */
  describe('the body and the footer (plan 0040)', () => {
    it('projects into the body, and draws no footer when none was asked for', async () => {
      // The cheapest evidence that the nine sheets not touched by this plan were not
      // touched: a regression in them is a layout change nothing else would catch.
      const fixture = await render();
      const body = query(fixture, '.sheet-body') as HTMLElement;

      expect(query(fixture, '.sheet-footer')).toBeNull();
      expect(body).not.toBeNull();
      expect(body.contains(query(fixture, '.first'))).toBe(true);
      expect(body.contains(query(fixture, '.last'))).toBe(true);
    });

    it('answers with the element that scrolls', async () => {
      // What a sheet measures when it follows the scrollbar. The comments sheet reads
      // it to decide whether to stick to the newest comment, and pointing that at the
      // wrong element fails silently rather than loudly.
      const fixture = await render();
      const shell = fixture.debugElement.query(By.directive(SheetShell))
        .componentInstance as SheetShell;

      expect(shell.body().nativeElement).toBe(query(fixture, '.sheet-body'));
    });

    it('keeps a projected footer outside the scrollport', async () => {
      const fixture = await renderWithFooter();
      const body = query(fixture, '.sheet-body') as HTMLElement;
      const footer = query(fixture, '.sheet-footer') as HTMLElement;

      expect(footer).not.toBeNull();
      expect(footer.querySelector('.save')).not.toBeNull();
      // The whole point: what the footer covers is nothing, because what scrolls under
      // it is not under it.
      expect(body.contains(footer)).toBe(false);
      expect(body.contains(query(fixture, '.row'))).toBe(true);
    });

    it('leaves the body projecting everything the footer did not claim', async () => {
      // A selective slot takes its node from wherever it appears in the caller's
      // template, so a footer written last still reads in the order it is drawn.
      const fixture = await renderWithFooter();
      const body = query(fixture, '.sheet-body') as HTMLElement;

      expect(body.querySelector('.actions')).toBeNull();
      expect(body.querySelector('#footer-host-title')).not.toBeNull();
    });
  });
});
