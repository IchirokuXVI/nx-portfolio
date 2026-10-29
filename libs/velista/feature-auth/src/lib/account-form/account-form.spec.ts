import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import type { AuthErrorCopy } from '../auth-error-copy';
import { AccountForm, type AccountFormValue } from './account-form';

const TERMS = '/en/auth/register/sheet/terms';
const PRIVACY = '/en/auth/register/sheet/privacy';

async function render(
  inputs: {
    mode?: 'register' | 'upgrade';
    termsUrl?: string | null;
    googleOffered?: boolean;
  } = {}
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AccountForm, RokuTranslatorTestingModule.forTesting()],
    providers: [provideRouter([]), provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(AccountForm);
  fixture.componentRef.setInput('mode', inputs.mode ?? 'register');
  const terms = inputs.termsUrl === undefined ? TERMS : inputs.termsUrl;
  fixture.componentRef.setInput('termsUrl', terms);
  fixture.componentRef.setInput('privacyUrl', terms === null ? null : PRIVACY);
  fixture.componentRef.setInput('googleOffered', inputs.googleOffered ?? true);
  fixture.detectChanges();

  const sent: AccountFormValue[] = [];
  fixture.componentInstance.submitted.subscribe((value) => sent.push(value));
  return { fixture, sent };
}

function host(fixture: ComponentFixture<AccountForm>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function fill(
  fixture: ComponentFixture<AccountForm>,
  accepted: boolean,
  password = 'password123'
): void {
  const form = fixture.componentInstance;
  form.email.set(' marta@example.com ');
  form.password.set(password);
  form.confirmPassword.set(password);
  form.accepted.set(accepted);
  fixture.detectChanges();
}

function submit(fixture: ComponentFixture<AccountForm>): void {
  host(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

describe('AccountForm (velista 0173, target 3)', () => {
  it('takes its ids and its submit label from the mode', async () => {
    const register = await render({ mode: 'register' });
    expect(
      host(register.fixture).querySelector('#register-terms')
    ).not.toBeNull();
    expect(
      host(register.fixture).querySelector('.primary')?.textContent
    ).toContain('auth.register.submit');

    const upgrade = await render({ mode: 'upgrade' });
    expect(
      host(upgrade.fixture).querySelector('#upgrade-email')
    ).not.toBeNull();
    expect(
      host(upgrade.fixture).querySelector('.primary')?.textContent
    ).toContain('auth.upgrade.submit');
  });

  it('draws a native box with its own label, and the privacy line outside it', async () => {
    const { fixture } = await render();
    const box =
      host(fixture).querySelector<HTMLInputElement>('#register-terms');

    expect(box?.type).toBe('checkbox');
    expect(
      host(fixture).querySelector('label[for="register-terms"]')?.textContent
    ).toContain('legal.accept.checkbox');
    expect(host(fixture).querySelector('.privacy-line')?.textContent).toContain(
      'legal.accept.privacy'
    );
    expect(host(fixture).querySelector('label .privacy-line')).toBeNull();
  });

  it('hands up the trimmed address and the password once the box is ticked', async () => {
    const { fixture, sent } = await render();

    fill(fixture, true);
    submit(fixture);

    expect(sent).toEqual([
      { email: 'marta@example.com', password: 'password123' },
    ]);
  });

  it('answers a clear box under it, focuses it, and hands up nothing', async () => {
    const { fixture, sent } = await render();

    fill(fixture, false);
    submit(fixture);

    expect(sent).toEqual([]);
    expect(fixture.componentInstance.shown()?.key).toBe(
      'legal.accept.unticked'
    );
    expect(document.activeElement?.id).toBe('register-terms');
    expect(
      host(fixture).querySelector('#register-terms-error')?.textContent
    ).toContain('legal.accept.unticked');
  });

  it('takes the sentence away when the box is ticked', async () => {
    const { fixture } = await render();
    fill(fixture, false);
    submit(fixture);

    const box =
      host(fixture).querySelector<HTMLInputElement>('#register-terms');
    if (box !== null) {
      box.checked = true;
      box.dispatchEvent(new Event('change'));
    }
    fixture.detectChanges();

    expect(fixture.componentInstance.shown()).toBeNull();
  });

  it('checks the fields before the box', async () => {
    const { fixture } = await render();

    fill(fixture, false, 'short');
    submit(fixture);

    expect(fixture.componentInstance.shown()?.key).toBe(
      'auth.error.shortPassword'
    );
  });

  it('clears the box on a refusal about the terms and draws it under the box', async () => {
    const { fixture } = await render();
    fill(fixture, true);
    const stale: AuthErrorCopy = {
      key: 'legal.accept.stale',
      placement: 'terms',
      link: 'terms',
    };

    fixture.componentRef.setInput('error', stale);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.accepted()).toBe(false);
    expect(
      host(fixture).querySelector('#register-terms-error')?.textContent
    ).toContain('legal.accept.stale');
    expect(host(fixture).querySelector('lib-form-error')).toBeNull();
  });

  it('draws neither box nor line, and checks no box, with no terms published', async () => {
    const { fixture, sent } = await render({ termsUrl: null });

    expect(host(fixture).querySelector('input[type="checkbox"]')).toBeNull();
    expect(host(fixture).querySelector('.privacy-line')).toBeNull();
    expect(host(fixture).querySelector('.terms-line')).toBeNull();

    fill(fixture, false);
    submit(fixture);
    expect(sent).toHaveLength(1);
  });

  it('draws Google with its line only when offered', async () => {
    const offered = await render({ googleOffered: true });
    expect(
      host(offered.fixture).querySelector('lib-google-option .terms-line')
    ).not.toBeNull();

    const not = await render({ googleOffered: false });
    expect(host(not.fixture).querySelector('lib-google-option')).toBeNull();
  });
});
