import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AUDIO_CAPTURE,
  AudioRecorder,
  type AudioCaptureI,
} from '@portfolio/velista/platform';
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

/**
 * A microphone that is there but is never opened by anything in this file.
 *
 * `CommentComposer` injects `AudioRecorder` since plan 0041, and the recorder
 * injects the capture, so both have to be provided even though every test here
 * is about the typed path and the native submit.
 */
const fakeCapture: AudioCaptureI = {
  supported: () => true,
  open: () =>
    Promise.resolve({
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn().mockResolvedValue(new Blob(['audio'])),
      close: jest.fn(),
    }),
};

async function render<T>(component: new (...args: never[]) => T) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [component, RokuTranslatorTestingModule.forTesting()],
    providers: [
      AudioRecorder,
      { provide: AUDIO_CAPTURE, useValue: fakeCapture },
    ],
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

    it('sends with a glyph, and is still named by the word (plan 0025)', async () => {
      // The button carries no text now, so the accessible name is the only name it
      // has: dropping the label would leave a screen reader with an unnamed submit.
      //
      // It is a microphone until something is typed (plan 0041, section 2), so the
      // field is filled first: the send glyph and the send label arrive together,
      // which is the pair being asserted.
      const fixture = await render(CommentComposer);

      const field = fixture.nativeElement.querySelector(
        'textarea.field'
      ) as HTMLTextAreaElement;
      field.value = 'Get the big one';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const send = fixture.nativeElement.querySelector(
        'button.send'
      ) as HTMLButtonElement;

      expect(send.textContent?.trim()).toBe('');
      expect(send.getAttribute('aria-label')).toBe('list.comments.send');
      expect(send.querySelector('lib-send-icon')).not.toBeNull();
    });

    it('is a microphone on an empty field, and says so', async () => {
      // One button, two jobs, adopted whole from the assistant: never two controls
      // competing for one intention (plan 0041, section 2).
      const fixture = await render(CommentComposer);

      const button = fixture.nativeElement.querySelector(
        'button.send'
      ) as HTMLButtonElement;

      expect(button.querySelector('lib-mic-icon')).not.toBeNull();
      expect(button.getAttribute('aria-label')).toBe(
        'list.comments.startRecording'
      );
    });
  });
});
