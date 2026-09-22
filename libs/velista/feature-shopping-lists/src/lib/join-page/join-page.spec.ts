import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BASKET_SERVICE, SessionStore } from '@portfolio/velista/data-access';
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

const SECRET = 'abc123';

async function render(
  options: {
    readonly preview?: BasketLinkPreview;
    readonly signedIn?: boolean;
  } = {}
) {
  TestBed.resetTestingModule();

  const join = jest.fn().mockResolvedValue({ basketId: 'b1' });
  const previewLink = jest
    .fn()
    .mockResolvedValue(
      options.preview ?? { joinable: true, name: 'Saturday shop' }
    );

  const paramMap = convertToParamMap({ secret: SECRET });

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
        useValue: {
          navigate: jest.fn().mockResolvedValue(true),
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
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
  return Object.assign(fixture, { join, previewLink });
}

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

      expect(text(fixture, '.dead-title')).toBe('basket.join.dead');
      expect(text(fixture, '.dead-body')).toBe('basket.join.deadBody');
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
});
