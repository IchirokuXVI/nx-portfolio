import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ApiUrl,
  fakeProfileStore,
  GatewayError,
  profileFor,
  provideFakeProfileStore,
  provideFakeSessionStore,
  TokenStore,
  type FakeProfileStore,
} from '@portfolio/velista/data-access';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { RenameAnnouncement } from '../rename-announcement';
import { RenameSheet } from './rename-sheet';

interface Options {
  readonly username?: string;
  readonly renameRejectsWith?: unknown;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<RenameSheet>;
  profile: FakeProfileStore;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const username = options.username ?? 'Marta';
  const profile = fakeProfileStore({
    profile: profileFor({ username }),
    renameRejectsWith: options.renameRejectsWith,
  });
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  await TestBed.configureTestingModule({
    imports: [RenameSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideHttpClient(),
      ApiUrl,
      TokenStore,
      provideFakeProfileStore(profile),
      provideFakeSessionStore('REGISTERED', { username }),
      { provide: SheetNavigation, useValue: sheets },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RenameSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, profile, sheets };
}

function field(fixture: ComponentFixture<RenameSheet>): HTMLInputElement {
  return fixture.nativeElement.querySelector('.field') as HTMLInputElement;
}

function type(fixture: ComponentFixture<RenameSheet>, value: string): void {
  const input = field(fixture);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function primary(fixture: ComponentFixture<RenameSheet>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.primary') as HTMLButtonElement;
}

function radios(fixture: ComponentFixture<RenameSheet>): HTMLInputElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('.radio'));
}

function text(fixture: ComponentFixture<RenameSheet>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('RenameSheet', () => {
  describe('arriving', () => {
    it('carries the current name, so replacing it is one gesture', async () => {
      const { fixture } = await render();

      expect(field(fixture).value).toBe('Marta');
    });

    it('is a real field the phone keyboard can finish', async () => {
      // Section 7: `autocomplete="nickname"`, `enterkeyhint="done"`, inside a `<form>`
      // with a submit button, so the Go key works with no separate handler.
      const { fixture } = await render();

      expect(field(fixture).getAttribute('autocomplete')).toBe('nickname');
      expect(field(fixture).getAttribute('enterkeyhint')).toBe('done');
      expect(primary(fixture).type).toBe('submit');
    });
  });

  /**
   * **Rule A3.** Two answers, and `ALL_ZONES` is not among them: it overwrites a name
   * somebody deliberately chose, and offering it honestly needs a screen that has no
   * endpoint behind it.
   */
  describe('rule A3: the propagation question', () => {
    it('is a real radio group with exactly two options', async () => {
      const { fixture } = await render();

      const options = radios(fixture);
      expect(options).toHaveLength(2);
      expect(options.every((option) => option.type === 'radio')).toBe(true);
    });

    it('offers no way to reach ALL_ZONES', async () => {
      const { fixture } = await render();

      expect(
        radios(fixture).map((option) => option.value)
      ).toEqual(['MY_GROUPS_TOO', 'ONLY_HERE']);
    });

    it('shows both options at once, so the consequence is not hidden', async () => {
      // A disclosure that hides the non default one hides the consequence (section 7).
      const { fixture } = await render();

      expect(text(fixture)).toContain('account.name.scope.matching');
      expect(text(fixture)).toContain('account.name.scope.globalOnly');
    });

    it('defaults to the safer answer, which is not the wire default', async () => {
      // `MATCHING_ZONES` can only ever change a name that already equalled the old
      // global one, so it cannot clobber a deliberate choice.
      const { fixture, profile } = await render();

      type(fixture, 'Marta R.');
      primary(fixture).click();
      await fixture.whenStable();

      expect(profile.calls).toContainEqual({
        method: 'rename',
        username: 'Marta R.',
        scope: 'MY_GROUPS_TOO',
      });
    });

    it('sends the deliberate choice when it is made', async () => {
      const { fixture, profile } = await render();

      radios(fixture)[1]?.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      type(fixture, 'Marta R.');
      primary(fixture).click();
      await fixture.whenStable();

      expect(profile.calls).toContainEqual({
        method: 'rename',
        username: 'Marta R.',
        scope: 'ONLY_HERE',
      });
    });
  });

  /**
   * **Rule A2.** A rename answers a profile and no new token pair, and the fix is a
   * preference in `SessionStore` rather than a refresh here: refresh **rotates**, which
   * would put a race into the cheapest possible action.
   */
  describe('rule A2: no token refresh', () => {
    it('never refreshes the pair to bring the name up to date', async () => {
      const { fixture } = await render();
      const refresh = jest.spyOn(TestBed.inject(TokenStore), 'refresh');

      type(fixture, 'Marta R.');
      primary(fixture).click();
      await fixture.whenStable();

      expect(refresh).not.toHaveBeenCalled();
    });
  });

  /**
   * **Rule A4.** `THROTTLE_LIMITS.usernameChange` is five per **hour**, so a countdown
   * that said a minute would run out, invite the tap, and fail again.
   */
  describe('rule A4: the hourly refusal', () => {
    it('renders the server’s number, not sixty', async () => {
      const { fixture } = await render({
        renameRejectsWith: new GatewayError({
          code: 'rate_limited',
          status: 429,
          correlationId: 'c1',
          retryAfterSeconds: 2468,
        }),
      });

      type(fixture, 'Marta R.');
      primary(fixture).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.failure()).toEqual({
        key: 'account.error.tooManyRenames',
        // Forty one minutes and eight seconds, which is what makes this assertion
        // worth writing: a formatter that wrapped at an hour, or copy that said a
        // minute, would both fail here.
        wait: '41:08',
      });
    });

    it('names no wait at all when the server named none', async () => {
      // Not being told how long to wait is not the same as having waited, and there is
      // no invented duration to reach for (rule C3).
      const { fixture } = await render({
        renameRejectsWith: new GatewayError({
          code: 'rate_limited',
          status: 429,
          correlationId: 'c1',
        }),
      });

      type(fixture, 'Marta R.');
      primary(fixture).click();
      await fixture.whenStable();

      expect(fixture.componentInstance.failure()?.wait).toBe('');
    });

    it('leaves the sheet open, so the name is not lost', async () => {
      const { fixture, sheets } = await render({
        renameRejectsWith: new GatewayError({
          code: 'rate_limited',
          status: 429,
          correlationId: 'c1',
          retryAfterSeconds: 2468,
        }),
      });

      type(fixture, 'Marta R.');
      primary(fixture).click();
      await fixture.whenStable();

      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(field(fixture).value).toBe('Marta R.');
    });
  });

  describe('what the field refuses, and when', () => {
    it('refuses a name that is too short, on submit rather than while typing', async () => {
      const { fixture, profile } = await render();

      type(fixture, 'M');

      expect(primary(fixture).disabled).toBe(true);
      // Nothing is said yet: a name is invalid for most of the time it takes to write
      // one (section 3.3).
      expect(fixture.componentInstance.failure()).toBeNull();
      expect(profile.calls.filter((c) => c.method === 'rename')).toEqual([]);
    });

    it('counts code points, so an emoji counts once', async () => {
      const { fixture } = await render();

      type(fixture, '🌊M');

      expect(fixture.componentInstance.length()).toBe(2);
      expect(primary(fixture).disabled).toBe(false);
    });

    it('states the rule rather than echoing the server on a bad name', async () => {
      const { fixture } = await render({
        renameRejectsWith: new GatewayError({
          code: 'validation_failed',
          status: 400,
          correlationId: 'c1',
          serverMessage: 'Validation failed',
        }),
      });

      type(fixture, 'former member Marta');
      primary(fixture).click();
      await fixture.whenStable();

      expect(fixture.componentInstance.failure()?.key).toBe(
        'account.error.badName'
      );
    });

    it('sends the trimmed name', async () => {
      const { fixture, profile } = await render();

      type(fixture, '  Marta R.  ');
      primary(fixture).click();
      await fixture.whenStable();

      expect(profile.calls).toContainEqual({
        method: 'rename',
        username: 'Marta R.',
        scope: 'MY_GROUPS_TOO',
      });
    });
  });

  describe('when it succeeds', () => {
    it('closes back onto the account screen', async () => {
      const { fixture, sheets } = await render();

      type(fixture, 'Marta R.');
      primary(fixture).click();
      await fixture.whenStable();

      expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/account');
    });

    it('tells the screen behind it, which is what gets announced', async () => {
      // The sheet closes and the change it made is behind it (section 7).
      const { fixture } = await render();

      type(fixture, 'Marta R.');
      primary(fixture).click();
      await fixture.whenStable();

      expect(TestBed.inject(RenameAnnouncement).name()).not.toBeNull();
    });
  });
});
