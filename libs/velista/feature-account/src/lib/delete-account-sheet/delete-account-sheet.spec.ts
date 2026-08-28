import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  ApiUrl,
  fakeProfileStore,
  fakeZoneStore,
  GatewayError,
  profileFor,
  provideFakeProfileStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  TokenStore,
  type FakeProfileStore,
} from '@portfolio/velista/data-access';
import type { MyZone, ZoneRole } from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { DeleteAccountSheet } from './delete-account-sheet';

const ME = 'u1';

function zone(id: string, myRole: ZoneRole): MyZone {
  return {
    id,
    name: `Group ${id}`,
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: myRole === 'OWNER' ? ME : 'u-other',
    myRole,
    myStatus: 'APPROVED',
    counts: {
      memberCount: 2,
      listCount: 1,
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    },
    lists: [],
  };
}

interface Options {
  readonly username?: string;
  readonly zones?: readonly MyZone[];
  readonly removeRejectsWith?: unknown;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<DeleteAccountSheet>;
  profile: FakeProfileStore;
  tokens: TokenStore;
  notice: AccountNotice;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const username = options.username ?? 'Marta';
  const profile = fakeProfileStore({
    profile: profileFor({ userId: ME, username }),
    removeRejectsWith: options.removeRejectsWith,
  });
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  await TestBed.configureTestingModule({
    imports: [DeleteAccountSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideHttpClient(),
      ApiUrl,
      TokenStore,
      AccountNotice,
      provideFakeProfileStore(profile),
      provideFakeZoneStore(fakeZoneStore({ zones: options.zones ?? [] })),
      provideFakeSessionStore('REGISTERED', { userId: ME, username }),
      { provide: SheetNavigation, useValue: sheets },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DeleteAccountSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return {
    fixture,
    profile,
    tokens: TestBed.inject(TokenStore),
    notice: TestBed.inject(AccountNotice),
    sheets,
  };
}

function type(
  fixture: ComponentFixture<DeleteAccountSheet>,
  value: string
): void {
  const input = fixture.nativeElement.querySelector(
    '.field'
  ) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function primary(
  fixture: ComponentFixture<DeleteAccountSheet>
): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.primary') as HTMLButtonElement;
}

function text(fixture: ComponentFixture<DeleteAccountSheet>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('DeleteAccountSheet', () => {
  /**
   * The second and last typed confirmation in this app. `0010` section 5.7 asked for
   * the justification before anything grew one by imitation: deleting a group destroys
   * every list in it for everyone in it, and deleting an account does that to every
   * group the person owns at once.
   */
  describe('the typed confirmation', () => {
    it('is disabled until the name matches', async () => {
      const { fixture } = await render();

      expect(primary(fixture).disabled).toBe(true);

      type(fixture, 'Mart');
      expect(primary(fixture).disabled).toBe(true);

      type(fixture, 'Marta');
      expect(primary(fixture).disabled).toBe(false);
    });

    it('is friction rather than a spelling test: trimmed and case folded', async () => {
      const { fixture } = await render();

      type(fixture, '  marta  ');

      expect(primary(fixture).disabled).toBe(false);
    });

    it('asks for the person’s own name, which is on screen the whole time', async () => {
      // Not a fixed word: it is personal, and it is the same gesture in both
      // languages, which a typed `DELETE` is not (section 7).
      const { fixture } = await render({ username: 'Ines' });

      expect(fixture.componentInstance.username()).toBe('Ines');
      expect(
        (
          fixture.nativeElement.querySelector('.field') as HTMLInputElement
        ).getAttribute('placeholder')
      ).toBe('Ines');
    });
  });

  describe('the consequences it states', () => {
    it('counts owned groups from the cache, with no request', async () => {
      const { fixture } = await render({
        zones: [
          zone('z1', 'OWNER'),
          zone('z2', 'OWNER'),
          zone('z3', 'MEMBER'),
        ],
      });

      // `myRole` is the caller's own role on a record already on the device.
      expect(fixture.componentInstance.ownedCount()).toBe(2);
      expect(text(fixture)).toContain('account.delete.ownedZones');
    });

    it('omits the sentence entirely for somebody who owns none', async () => {
      // Absent, not zeroed: for them it is simply not true (section 5.7).
      const { fixture } = await render({ zones: [zone('z1', 'MEMBER')] });

      expect(fixture.componentInstance.ownedCount()).toBe(0);
      expect(text(fixture)).not.toContain('account.delete.ownedZones');
    });

    it('says that what they wrote stays', async () => {
      const { fixture } = await render();

      expect(text(fixture)).toContain('account.delete.authored');
    });
  });

  describe('when it succeeds', () => {
    it('clears the session and goes to the front door', async () => {
      // The front door and **not** sign in, which is the screen for somebody who has an
      // account (section 5.7).
      const { fixture, tokens, sheets } = await render();
      tokens.set({
        userId: ME,
        kind: 'REGISTERED',
        username: 'Marta',
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      type(fixture, 'Marta');
      primary(fixture).click();
      await fixture.whenStable();

      expect(tokens.tokens()).toBeNull();
      expect(sheets.leaveTo).toHaveBeenCalledWith('/velista/en');
    });

    it('leaves the front door something to say once', async () => {
      const { fixture, notice } = await render();

      type(fixture, 'Marta');
      primary(fixture).click();
      await fixture.whenStable();

      expect(notice.notice()).toEqual({ kind: 'deleted', email: '' });
    });

    it('drops the held profile', async () => {
      const { fixture, profile } = await render();

      type(fixture, 'Marta');
      primary(fixture).click();
      await fixture.whenStable();

      expect(profile.calls).toContainEqual({ method: 'clear' });
    });
  });

  describe('when it fails', () => {
    it('does not clear the session', async () => {
      // A failed delete must never look like a successful one (section 3.4).
      const { fixture, tokens } = await render({
        removeRejectsWith: new GatewayError({
          code: 'internal',
          status: 500,
          correlationId: 'c-99',
        }),
      });
      tokens.set({
        userId: ME,
        kind: 'REGISTERED',
        username: 'Marta',
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      type(fixture, 'Marta');
      primary(fixture).click();
      await fixture.whenStable();

      expect(tokens.tokens()).not.toBeNull();
    });

    it('stays open with the correlation id', async () => {
      const { fixture, sheets } = await render({
        removeRejectsWith: new GatewayError({
          code: 'internal',
          status: 500,
          correlationId: 'c-99',
        }),
      });

      type(fixture, 'Marta');
      primary(fixture).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(fixture.componentInstance.correlationId()).toBe('c-99');
      expect(text(fixture)).toContain('c-99');
    });
  });

  describe('dismissing', () => {
    it('goes back to the account screen', async () => {
      const { fixture, sheets } = await render();

      await fixture.componentInstance.dismiss();

      expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/account');
    });
  });
});
