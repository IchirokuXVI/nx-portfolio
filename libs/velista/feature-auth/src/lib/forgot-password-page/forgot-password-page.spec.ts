import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeAuthService,
  NetworkError,
  provideFakeAuthService,
  type FakeAuthService,
} from '@portfolio/velista/data-access';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ForgotPasswordPage } from './forgot-password-page';

interface Options {
  readonly auth?: FakeAuthService;
  /** `?email=`, which the sign in page sends with whatever was typed. */
  readonly email?: string;
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const auth = options.auth ?? fakeAuthService();

  await TestBed.configureTestingModule({
    imports: [ForgotPasswordPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeAuthService(auth),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: {
              get: (key: string) =>
                key === 'email' ? (options.email ?? null) : null,
            },
          },
        },
      },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigate').mockResolvedValue(true);

  const fixture = TestBed.createComponent(ForgotPasswordPage);
  fixture.detectChanges();

  return { fixture, auth, router };
}

function host(fixture: ComponentFixture<ForgotPasswordPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

async function send(fixture: ComponentFixture<ForgotPasswordPage>) {
  host(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('ForgotPasswordPage', () => {
  it('takes the address the sign in page carried over', async () => {
    const { fixture } = await render({ email: 'marta@example.com' });

    expect(
      (host(fixture).querySelector('input[type="email"]') as HTMLInputElement)
        .value
    ).toBe('marta@example.com');
  });

  it('keeps the button off until there is an address', async () => {
    const { fixture } = await render();

    expect(
      (host(fixture).querySelector('button.primary') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('asks for a link and says what it did, never what arrived', async () => {
    const { fixture, auth } = await render({ email: ' marta@example.com ' });

    await send(fixture);

    expect(auth.calls).toEqual([
      { method: 'forgotPassword', email: 'marta@example.com' },
    ]);
    const text = host(fixture).textContent ?? '';
    expect(text).toContain('auth.forgot.sentTitle');
    expect(text).toContain('auth.forgot.sentRule');
    // The wait is the server's number (rule C3): 60 seconds from the fake.
    expect(text).toContain('auth.forgot.waiting');
  });

  it('stays on the form with the server wait when it is refused', async () => {
    const { fixture } = await render({
      email: 'marta@example.com',
      auth: fakeAuthService({
        forgotPassword: { state: 'refused', waitSeconds: 47 },
      }),
    });

    await send(fixture);

    expect(fixture.componentInstance.askedFor()).toBeNull();
    expect(fixture.componentInstance.error()?.wait).toBe('0:47');
    expect(host(fixture).textContent).toContain('auth.resend.refused');
  });

  it('says it failed, and claims nothing, when the request never got through', async () => {
    const { fixture } = await render({
      email: 'marta@example.com',
      auth: fakeAuthService({
        forgotPassword: {
          state: 'failed',
          error: new NetworkError('c1', 'auth.forgotPassword'),
        },
      }),
    });

    await send(fixture);

    expect(fixture.componentInstance.askedFor()).toBeNull();
    expect(host(fixture).textContent).toContain('entry.error.failed');
  });

  it('goes back to the form, address kept, from "Change it"', async () => {
    const { fixture } = await render({ email: 'marta@example.com' });
    await send(fixture);

    fixture.componentInstance.changeEmail();
    fixture.detectChanges();

    expect(fixture.componentInstance.askedFor()).toBeNull();
    expect(fixture.componentInstance.email()).toBe('marta@example.com');
  });

  it('carries the address back to the sign in page', async () => {
    const { fixture, router } = await render({ email: 'marta@example.com' });

    fixture.componentInstance.signIn();

    expect(router.navigate).toHaveBeenCalledWith(['/en/auth/login'], {
      queryParams: { email: 'marta@example.com' },
    });
  });
});
