import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { CommentComposer } from './comment-composer';
import { LineComposer } from './line-composer';

/**
 * Plan 0019, section 2.2: the assertion that would have failed on the code as it stood.
 *
 * Both composers bound `(ngSubmit)` without importing `FormsModule`, so no directive
 * was applied to the form, Angular listened for a DOM event of a name no browser
 * fires, and the native submit ran unopposed: the browser navigated to the current URL
 * with the field as a query parameter and the app reloaded. Adding a line, the reason
 * the list page exists, did not work.
 *
 * A unit test that calls `submit()` directly cannot see any of that, which is how the
 * defect survived two plans and how the identical bug in `CommentComposer` was never
 * reported at all. So these dispatch a **real** `submit` event on the real `<form>`
 * and assert two things: the output fired, and the event's default was prevented. The
 * second is the half that stops the page reloading, and it is the half a handler
 * wired to the wrong event name silently fails.
 */

async function render<T>(component: new (...args: never[]) => T) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [component, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

/**
 * Submit the form the way a browser does.
 *
 * `dispatchEvent` returns false when a listener called `preventDefault`, which is
 * exactly the signal under test, so it is returned rather than asserted on here.
 * `cancelable` must be set: a non-cancelable event cannot record the prevention and
 * the test would pass against the broken code.
 */
function submitForm(fixture: ComponentFixture<unknown>): boolean {
  const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  const event = new Event('submit', { bubbles: true, cancelable: true });

  return form.dispatchEvent(event);
}

describe('the list composers submit the line, not the page', () => {
  describe('LineComposer', () => {
    it('emits and prevents the native submit', async () => {
      const fixture = await render(LineComposer);
      const composer = fixture.componentInstance;

      const emitted: { content: string; quantity: number }[] = [];
      composer.submitted.subscribe((value) => emitted.push(value));

      const field = fixture.nativeElement.querySelector(
        'input.field'
      ) as HTMLInputElement;
      field.value = 'Sourdough loaf';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const notPrevented = submitForm(fixture);

      expect(emitted).toEqual([{ content: 'Sourdough loaf', quantity: 1 }]);
      expect(notPrevented).toBe(false);
    });

    it('prevents the native submit even with nothing to add', async () => {
      // The button is disabled at this point, but the phone keyboard's Go key is not,
      // and a reload on an empty field is the same defect.
      const fixture = await render(LineComposer);

      const emitted: unknown[] = [];
      fixture.componentInstance.submitted.subscribe((value) =>
        emitted.push(value)
      );

      const notPrevented = submitForm(fixture);

      expect(emitted).toEqual([]);
      expect(notPrevented).toBe(false);
    });

    it('clears the field and resets the quantity, ready for the next one', async () => {
      const fixture = await render(LineComposer);
      const composer = fixture.componentInstance;

      const field = fixture.nativeElement.querySelector(
        'input.field'
      ) as HTMLInputElement;
      field.value = 'Tomatoes';
      field.dispatchEvent(new Event('input'));
      composer.quantity.set(4);
      fixture.detectChanges();

      submitForm(fixture);

      expect(composer.content()).toBe('');
      expect(composer.quantity()).toBe(1);
    });
  });

  describe('CommentComposer', () => {
    it('emits and prevents the native submit', async () => {
      const fixture = await render(CommentComposer);
      const composer = fixture.componentInstance;

      const emitted: string[] = [];
      composer.submitted.subscribe((value) => emitted.push(value));

      const field = fixture.nativeElement.querySelector(
        'textarea.field'
      ) as HTMLTextAreaElement;
      field.value = '  Get the big one  ';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const notPrevented = submitForm(fixture);

      expect(emitted).toEqual(['Get the big one']);
      expect(notPrevented).toBe(false);
    });

    it('prevents the native submit even with nothing to say', async () => {
      const fixture = await render(CommentComposer);

      const emitted: unknown[] = [];
      fixture.componentInstance.submitted.subscribe((value) =>
        emitted.push(value)
      );

      const notPrevented = submitForm(fixture);

      expect(emitted).toEqual([]);
      expect(notPrevented).toBe(false);
    });
  });
});
