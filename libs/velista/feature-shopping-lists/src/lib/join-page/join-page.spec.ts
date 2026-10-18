import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BASKET_SERVICE,
  GatewayError,
  NetworkError,
  SessionStore,
} from '@portfolio/velista/data-access';
import type { BasketLinkPreview } from '@portfolio/velista/models';
import {
  InstallStore,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { JoinPage } from './join-page';

/**
 * The first thing a stranger sees (plan 0044, section 3; velista `0094`,
 * section 4).
 *
 * Two properties are being guarded here and they pull in opposite directions,
 * which is why they are asserted together. The page has to **say** what the
 * link buys somebody, because a twelve hour visit is a fact they are agreeing
 * to; and it must not tell them **why** a dead link is dead, because a revoked
 * link, an expired one, a finished basket and a secret that never existed
 * answer identically on purpose (velista `0064`, section 3).
 */

/** A whole secret: 43 base64url characters, the shape the backend mints. */
const SECRET = '7-qcthEEDLArtXr-l6OxWudKuHDInYqD53198Z6ZcBE';

async function render(
  options: {
    readonly preview?: BasketLinkPreview;
    readonly signedIn?: boolean;
    /** A preview that never answers, the way a lost network or a 503 does. */
    readonly previewFails?: boolean;
    /** What a join is refused with, when it is. */
    readonly joinFails?: unknown;
    readonly secret?: string;
  } = {}
) {
  TestBed.resetTestingModule();

  const join =
    options.joinFails === undefined
      ? jest.fn().mockResolvedValue({ basketId: 'b1' })
      : jest.fn().mockRejectedValue(options.joinFails);
  const previewLink = options.previewFails
    ? jest.fn().mockRejectedValue(new NetworkError('spec', 'basket.preview'))
    : jest
        .fn()
        .mockResolvedValue(
          options.preview ?? { joinable: true, name: 'Saturday shop' }
        );
  const navigate = jest.fn().mockResolvedValue(true);
  const navigateByUrl = jest.fn().mockResolvedValue(true);

  const paramMap = convertToParamMap({ secret: options.secret ?? SECRET });

  await TestBed.configureTestingModule({
    imports: [JoinPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: BASKET_SERVICE, useValue: { previewLink, join } },
      {
        provide: SessionStore,
        useValue: { isAuthenticated: signal(options.signedIn ?? false) },
      },
      {
        provide: InstallStore,
        useValue: { canPrompt: signal(false), prompt: jest.fn() },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: Router,
        useValue: { navigate, navigateByUrl },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(paramMap),
          snapshot: { paramMap, parent: null },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(JoinPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return Object.assign(fixture, {
    join,
    previewLink,
    navigate,
    navigateByUrl,
  });
}

/** Let the promises a tap started settle, then draw. */
async function settle(fixture: Awaited<ReturnType<typeof render>>) {
  await fixture.whenStable();
  fixture.detectChanges();
}

const buttons = (fixture: Awaited<ReturnType<typeof render>>) =>
  [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map(
    (button) => button.textContent?.trim()
  );

const press = (fixture: Awaited<ReturnType<typeof render>>, key: string) =>
  [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === key)
    ?.click();

const html = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement).innerHTML;

const text = (fixture: Awaited<ReturnType<typeof render>>, css: string) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector(css)
    ?.textContent?.trim() ?? null;

describe('JoinPage: what a stranger is told', () => {
  it('says how long the link buys them', async () => {
    const fixture = await render();

    expect(text(fixture, '.for-hours')).toBe('basket.join.forHours');
  });

  it('never invites them to register', async () => {
    // Rule C2. The sign in buttons this page already had are untouched by
    // velista `0094`, and nothing it adds mentions an account, a name to ask or
    // making one.
    const fixture = await render();

    for (const key of [
      'basket.join.forHours',
      'basket.visit.account',
      'basket.visit.accountNameless',
    ]) {
      const added = key === 'basket.join.forHours';
      expect(html(fixture).includes(key)).toBe(added);
    }
  });
});

describe('JoinPage: a dead link still says nothing', () => {
  /**
   * The four causes, as the wire carries them.
   *
   * They are the same object, and that is the assertion rather than a shortcut:
   * a revoked link, an expired one, a finished basket and a secret that never
   * existed all answer `joinable: false` **and nothing else** (backend `0051`,
   * section 3.1). If one of them ever arrived carrying a reason, this table is
   * where it would have to be written down, and the loop below would catch the
   * screen starting to say it.
   */
  const causes: ReadonlyMap<string, BasketLinkPreview> = new Map([
    ['revoked', { joinable: false }],
    ['expired', { joinable: false }],
    ['the basket finished', { joinable: false }],
    ['never existed', { joinable: false }],
  ]);

  it('draws one sentence for every cause', async () => {
    for (const preview of causes.values()) {
      const fixture = await render({ preview });

      expect(text(fixture, '.dead .card-title')).toBe('basket.join.dead');
      expect(text(fixture, '.dead .card-body')).toBe('basket.join.deadBody');
      // Not one word about expiry, on the one screen that must not say it.
      expect(html(fixture)).not.toContain('basket.join.forHours');
      expect(html(fixture)).not.toContain('basket.share.ended');
    }
  });

  it('answers all four the same, byte for byte', async () => {
    // The stronger half of the property: not merely that each says the honest
    // sentence, but that a reader comparing two of them learns nothing.
    const drawn = new Set<string>();
    for (const preview of causes.values()) {
      drawn.add(html(await render({ preview })));
    }

    expect(drawn.size).toBe(1);
  });
});

describe('JoinPage: somebody already signed in', () => {
  it('never sees the offer screen', async () => {
    // They are attached as themselves and land in the basket. What that row
    // **means** changed with velista `0094` (it ends in twelve hours), and the
    // basket is what tells them, not this page.
    const fixture = await render({ signedIn: true });

    expect(fixture.join).toHaveBeenCalledWith(SECRET, '');
    expect(text(fixture, '.for-hours')).toBeNull();
    expect(text(fixture, '.offer')).toBeNull();
  });

  it('is told they were taken off the list, and never offered the guest path', async () => {
    // F6.4: a removed member who opens a new link (velista 0154, target 2).
    const fixture = await render({
      signedIn: true,
      joinFails: new GatewayError({
        code: 'not_a_participant',
        status: 401,
        correlationId: 'spec',
      }),
    });
    await settle(fixture);

    expect(text(fixture, '.card-title')).toBe('basket.join.removed');
    expect(text(fixture, '.card-body')).toBe('basket.join.removedBody');
    expect(buttons(fixture)).toEqual(['basket.join.home']);

    press(fixture, 'basket.join.home');
    expect(fixture.navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
  });

  it('sees no guest offer when a join fails for no named reason', async () => {
    const fixture = await render({
      signedIn: true,
      joinFails: new NetworkError('spec', 'basket.join'),
    });
    await settle(fixture);

    expect(text(fixture, '.offer')).toBeNull();
    expect(html(fixture)).not.toContain('basket.join.continue');
    expect(html(fixture)).not.toContain('basket.join.email');
    expect(text(fixture, '[role="alert"]')).toBe('basket.join.failed');
    expect(buttons(fixture)).toEqual(['basket.join.retry']);

    press(fixture, 'basket.join.retry');
    await settle(fixture);
    expect(fixture.join).toHaveBeenCalledTimes(2);
  });

  it('reads a 404 on the join as the dead link', async () => {
    const fixture = await render({
      signedIn: true,
      joinFails: new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'spec',
      }),
    });
    await settle(fixture);

    expect(text(fixture, '.dead .card-title')).toBe('basket.join.dead');
  });
});

describe('JoinPage: somebody signed out', () => {
  it('sees the guest offer and sign in, and no register and no Google', async () => {
    // Rule C2 in spirit (velista 0154, target 3): the guest path is the way in.
    const fixture = await render();

    expect(buttons(fixture)).toEqual([
      'basket.join.continue',
      'basket.join.email',
    ]);
    expect(html(fixture)).not.toContain('basket.join.google');
  });

  it('signs in and comes back to this link', async () => {
    // F6.6 (velista 0154, target 5). The sign in page navigates to returnUrl,
    // and this page, signed in, joins without a prompt (asserted above).
    const fixture = await render();

    press(fixture, 'basket.join.email');

    expect(fixture.navigate).toHaveBeenCalledWith(['/velista/en/auth/login'], {
      queryParams: { returnUrl: `/velista/en/s/${SECRET}` },
    });
  });

  it('keeps the offer, with the alert, when a guest join fails', async () => {
    const fixture = await render({
      joinFails: new NetworkError('spec', 'basket.join'),
    });

    press(fixture, 'basket.join.continue');
    await settle(fixture);

    expect(text(fixture, '.offer .invited')).toBe('basket.join.invited');
    expect(text(fixture, '[role="alert"]')).toBe('basket.join.failed');
  });
});

describe('JoinPage: every state has a way on', () => {
  it('says the link could not be checked, and tries again', async () => {
    // F6.5: a preview that rejects used to leave the spinner up for good.
    const fixture = await render({ previewFails: true });

    expect(text(fixture, '.card-title')).toBe('basket.join.unreachable');
    expect(buttons(fixture)).toEqual(['basket.join.retry']);

    fixture.previewLink.mockResolvedValue({ joinable: true, name: 'Saturday' });
    press(fixture, 'basket.join.retry');
    await settle(fixture);

    expect(fixture.previewLink).toHaveBeenCalledTimes(2);
    expect(text(fixture, '.offer .invited')).toBe('basket.join.invited');
  });

  it('offers one action on a dead link, which opens the app', async () => {
    // F6.9. Signed out, the app is the front door.
    const fixture = await render({ preview: { joinable: false } });

    expect(buttons(fixture)).toEqual(['basket.join.openApp']);

    press(fixture, 'basket.join.openApp');
    expect(fixture.navigateByUrl).toHaveBeenCalledWith('/velista/en');
  });

  it('says a secret of the wrong shape is not complete', async () => {
    const fixture = await render({
      preview: { joinable: false },
      secret: 'PjLG6E1bUXxEcS5l8ve8',
    });

    expect(text(fixture, '.dead .card-title')).toBe('basket.join.incomplete');
    expect(text(fixture, '.dead .card-body')).toBe(
      'basket.join.incompleteBody'
    );
    expect(buttons(fixture)).toEqual(['basket.join.openApp']);
  });
});
