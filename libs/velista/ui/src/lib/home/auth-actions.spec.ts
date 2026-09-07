import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { AuthActions } from './auth-actions';

const CONNECTING = 'Connecting. This will work in a moment.';
const SLOW = 'velista cannot reach the server. Try again in a moment.';

async function createFixture(): Promise<ComponentFixture<AuthActions>> {
  await TestBed.configureTestingModule({
    imports: [AuthActions, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(AuthActions);
  fixture.componentRef.setInput('connectingMessage', CONNECTING);
  fixture.componentRef.setInput('slowMessage', SLOW);
  fixture.detectChanges();
  return fixture;
}

function buttons(fixture: ComponentFixture<AuthActions>): HTMLButtonElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('button')
  );
}

describe('AuthActions', () => {
  it('emits all four when the app is not held', async () => {
    const fixture = await createFixture();
    const emitted: string[] = [];

    fixture.componentInstance.createZone.subscribe(() =>
      emitted.push('createZone')
    );
    fixture.componentInstance.joinZone.subscribe(() =>
      emitted.push('joinZone')
    );
    fixture.componentInstance.continueWithGoogle.subscribe(() =>
      emitted.push('google')
    );
    fixture.componentInstance.signInWithEmail.subscribe(() =>
      emitted.push('email')
    );

    for (const button of buttons(fixture)) {
      button.click();
    }

    expect(emitted).toEqual(['createZone', 'joinZone', 'google', 'email']);
  });

  /**
   * Plan 0071 D5. The whole design of a held control is that it still receives the
   * press: a disabled button swallows its own click, so the sentence explaining why it
   * will not act could never be triggered by the thing the user pressed.
   */
  describe('held', () => {
    async function heldFixture(
      slow = false
    ): Promise<ComponentFixture<AuthActions>> {
      const fixture = await createFixture();
      fixture.componentRef.setInput('held', true);
      fixture.componentRef.setInput('slow', slow);
      fixture.detectChanges();
      return fixture;
    }

    it('emits nothing when pressed', async () => {
      const fixture = await heldFixture();
      const emitted: string[] = [];

      fixture.componentInstance.createZone.subscribe(() =>
        emitted.push('createZone')
      );
      fixture.componentInstance.joinZone.subscribe(() =>
        emitted.push('joinZone')
      );
      fixture.componentInstance.continueWithGoogle.subscribe(() =>
        emitted.push('google')
      );
      fixture.componentInstance.signInWithEmail.subscribe(() =>
        emitted.push('email')
      );

      for (const button of buttons(fixture)) {
        button.click();
      }

      expect(emitted).toEqual([]);
    });

    it('says so with aria-disabled rather than disabling anything', async () => {
      const fixture = await heldFixture();

      for (const button of buttons(fixture)) {
        expect(button.getAttribute('aria-disabled')).toBe('true');
        // Still focusable, and still in the tab order: `disabled` would take both
        // away, along with the press that triggers the explanation.
        expect(button.disabled).toBe(false);
        expect(button.hasAttribute('tabindex')).toBe(false);
      }
    });

    // Assert on the input rather than on rendered text, per the testing translator's
    // limits: these two strings reach the component as inputs, so the component's own
    // choice between them is the thing worth asserting.
    it('answers with the connecting sentence before the wait is long', async () => {
      const fixture = await heldFixture();

      expect(fixture.componentInstance.message()).toBe(CONNECTING);
    });

    it('answers with what is wrong once the wait is long', async () => {
      const fixture = await heldFixture(true);

      expect(fixture.componentInstance.message()).toBe(SLOW);
    });

    it('renders the sentence in a polite live region', async () => {
      const fixture = await heldFixture();
      const status = (fixture.nativeElement as HTMLElement).querySelector(
        '[role="status"]'
      );

      expect(status).not.toBeNull();
      expect(status?.getAttribute('aria-live')).toBe('polite');
    });
  });

  it('says nothing at all when it is not held', async () => {
    const fixture = await createFixture();

    expect(fixture.componentInstance.message()).toBe('');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="status"]')
    ).toBeNull();
    for (const button of buttons(fixture)) {
      expect(button.hasAttribute('aria-disabled')).toBe(false);
    }
  });
});
