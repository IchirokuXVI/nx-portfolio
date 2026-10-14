import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeAuthService,
  fakeProfileStore,
  fakeZoneStore,
  PendingRecoveryLink,
  profileFor,
  provideFakeAuthService,
  provideFakeProfileStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  type FakeAuthService,
  type FakeIdentity,
} from '@portfolio/velista/data-access';
import type { MyZone } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { RecoveryLinkSheet } from './recovery-link-sheet';

function zone(id: string): MyZone {
  return {
    id,
    name: `Group ${id}`,
    joinCode: 'ABCD1234',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 1,
      listCount: 0,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
  };
}

interface Options {
  readonly token?: string | null;
  readonly identity?: FakeIdentity;
  readonly auth?: FakeAuthService;
  readonly zones?: readonly MyZone[];
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const auth = options.auth ?? fakeAuthService({ userId: 'u-owner' });
  const reload = jest.fn();

  await TestBed.configureTestingModule({
    imports: [RecoveryLinkSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(undefined, { reload }),
      provideFakeAuthService(auth),
      provideFakeSessionStore(options.identity ?? 'REGISTERED', {
        username: 'luis_ortega',
      }),
      provideFakeProfileStore(
        fakeProfileStore({
          profile: profileFor({ email: 'luis@example.com' }),
        })
      ),
      provideFakeZoneStore(fakeZoneStore({ zones: options.zones ?? [] })),
      PendingRecoveryLink,
    ],
  }).compileComponents();

  const pending = TestBed.inject(PendingRecoveryLink);
  const token = options.token === undefined ? 'link-token' : options.token;
  if (token !== null) {
    pending.hold(token);
  }

  const sheet = TestBed.inject(SheetNavigation);
  jest.spyOn(sheet, 'leaveTo').mockResolvedValue(undefined);
  jest.spyOn(sheet, 'dismiss').mockResolvedValue(undefined);

  const fixture = TestBed.createComponent(RecoveryLinkSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, auth, sheet, pending, reload };
}

function text(fixture: ComponentFixture<RecoveryLinkSheet>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

async function settle(fixture: ComponentFixture<RecoveryLinkSheet>) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('RecoveryLinkSheet', () => {
  it('says the person must sign out, names the account, and sends nothing yet', async () => {
    const { fixture, auth } = await render();

    expect(auth.calls).toEqual([]);
    expect(text(fixture)).toContain('auth.reset.sheet.other.title');
    expect(text(fixture)).toContain('luis_ortega');
    expect(text(fixture)).toContain('luis@example.com');
    expect(text(fixture)).toContain('auth.reset.sheet.unused');
  });

  it('spends the link with the switch only when the person decides, then starts over at home', async () => {
    const { fixture, auth, sheet, pending, reload } = await render();

    await fixture.componentInstance.proceed();
    await settle(fixture);

    expect(auth.calls).toEqual([
      { method: 'recoverySignIn', token: 'link-token', switchAccount: true },
    ]);
    expect(pending.token()).toBeNull();
    expect(sheet.leaveTo).toHaveBeenCalledWith('/en/home');
    expect(reload).toHaveBeenCalled();
  });

  it('drops the token and sends nothing when the person stays signed in', async () => {
    const { fixture, auth, sheet, pending } = await render();

    await fixture.componentInstance.dismiss();

    expect(auth.calls).toEqual([]);
    expect(pending.token()).toBeNull();
    expect(sheet.dismiss).toHaveBeenCalledWith('/en/home');
  });

  it('gives a guest the loss and the upgrade link, never register', async () => {
    const { fixture, sheet } = await render({
      identity: 'TEMPORARY',
      zones: [zone('z1')],
    });

    expect(text(fixture)).toContain('auth.reset.sheet.guest.title');
    expect(text(fixture)).toContain('auth.reset.guest.loss');
    expect(text(fixture)).not.toContain('auth.register');
    const primary = (fixture.nativeElement as HTMLElement).querySelector(
      'button.primary'
    );
    expect(primary?.classList).toContain('destructive');

    await fixture.componentInstance.upgrade();

    expect(sheet.leaveTo).toHaveBeenCalledWith('/en/auth/upgrade');
  });

  it('drops the loss sentence for a guest with no groups', async () => {
    const { fixture } = await render({ identity: 'TEMPORARY' });

    expect(text(fixture)).not.toContain('auth.reset.guest.loss');
  });

  it('says the link ran out when it did', async () => {
    const { fixture } = await render({
      auth: fakeAuthService({
        recoverySignIn: () => ({ state: 'link-dead' }),
      }),
    });

    await fixture.componentInstance.proceed();
    await settle(fixture);

    expect(text(fixture)).toContain('auth.reset.dead.title');
  });

  it('leaves for home at once when no token is held, as after a reload', async () => {
    const { auth, sheet } = await render({ token: null });

    expect(auth.calls).toEqual([]);
    expect(sheet.leaveTo).toHaveBeenCalledWith('/en/home');
  });
});
