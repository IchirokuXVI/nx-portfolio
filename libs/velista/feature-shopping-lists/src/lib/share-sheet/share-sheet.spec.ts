import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  ContactStore,
  fakeZoneStore,
  provideFakeZoneStore,
} from '@portfolio/velista/data-access';
import type {
  BasketParticipant,
  BasketShareLink,
  Contact,
  MyZone,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
  type BrowserFacade,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { ShareSheet } from './share-sheet';

/**
 * Plan 0052, section 4: the revoke confirm cannot be reached by a double tap.
 *
 * The sheet panel is anchored to the bottom of the viewport and grows upward, so the
 * last control in a pane is always the same distance from the bottom of the screen
 * whichever pane is showing. Both stacks used to end two buttons deep with the
 * destructive confirm in the upper of the two, which is exactly where the trigger that
 * summoned it had been.
 *
 * So what is asserted here is **position**, not appearance: index 0 of the revoke
 * pane's footer must be the safe answer, because index 0 of the link pane's footer is
 * the trigger. A test that only checked both buttons were present would have passed
 * before the fix.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

/**
 * A link that is still accepting people.
 *
 * Its end is **relative to now** rather than a fixed date, and deliberately so:
 * the sheet chooses between showing a URL and offering a new link by comparing
 * that moment with the device's clock, so a fixed date would put every test on
 * the ended pane the day after it was written (the memory note on fixed date
 * specs being time bombs).
 */
function link(overrides: Partial<BasketShareLink> = {}): BasketShareLink {
  return {
    id: 'sl1',
    secret: 's3cr3t',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 11 * 60 * 60 * 1000),
    participantCount: 2,
    ...overrides,
  };
}

/** A link whose twelve hours are over. */
function endedLink(): BasketShareLink {
  return link({ expiresAt: new Date(Date.now() - 60 * 1000) });
}

/** Someone on the basket, as the participant list names them. */
function participant(
  overrides: Partial<BasketParticipant> = {}
): BasketParticipant {
  return {
    id: 'p-owner',
    kind: 'OWNER',
    displayName: null,
    username: 'Ana',
    guestNumber: null,
    userId: 'u-ana',
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: null,
    // A named person by default, which is what the picker ticks.
    expiresAt: null,
    ...overrides,
  };
}

/** Somebody a link let in, whose time on the basket runs out. */
function visitor(
  overrides: Partial<BasketParticipant> = {}
): BasketParticipant {
  return participant({
    kind: 'REGISTERED',
    shareLinkId: 'sl1',
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    ...overrides,
  });
}

const OWNER = participant();

/** The two people in the owner's group, Leo and Marta, and the group itself. */
const CONTACTS: readonly Contact[] = [
  { userId: 'u-leo', zoneId: 'z1', username: 'Leo' },
  { userId: 'u-marta', zoneId: 'z1', username: 'Marta' },
];

const ZONE = { id: 'z1', name: 'Flat', myStatus: 'APPROVED' } as MyZone;

interface PeopleOptions {
  readonly participants?: readonly BasketParticipant[];
  /** What `addParticipant` answers. True also puts the person on the basket. */
  readonly addSaves?: boolean;
  /** Whether `removeParticipant` rejects. */
  readonly removeFails?: boolean;
  /** The link the sheet is opened over. Working by default. */
  readonly link?: BasketShareLink | null;
  /**
   * Which basket is underneath, or `null` for one that has not answered yet.
   *
   * `null` is the cold load: a sheet built on its own URL under
   * `shopping-lists/live`, where the id arrives with the basket.
   */
  readonly basket?: 'GENERATED' | 'LIVE' | null;
}

async function render(
  browser?: Partial<BrowserFacade>,
  people: PeopleOptions = {}
) {
  TestBed.resetTestingModule();

  const participants = signal<readonly BasketParticipant[]>(
    people.participants ?? [OWNER]
  );
  const shareLink = signal<BasketShareLink | null>(
    people.link === undefined ? link() : people.link
  );
  const store = {
    // A basket with an id, because the sheet reads the link **when the id
    // appears**: on the live route it arrives with the basket, so a sheet built
    // before it has one must not claim the list has no link (velista `0094`).
    // `kind` decides which body sentence is drawn.
    basket: signal(
      people.basket === null
        ? null
        : { id: BASKET_ID, kind: people.basket ?? 'GENERATED' }
    ),
    state: signal('ready'),
    error: signal(null),
    // Where closing this sheet goes. From the store since velista `0091`,
    // because the live route carries no id in its URL.
    address: signal({ basketId: BASKET_ID }),
    // Already minted and still working, which is the pane the trigger lives on.
    shareLink,
    share: jest.fn(async () => {
      const minted = link();
      shareLink.set(minted);
      return minted;
    }),
    revokeLink: jest.fn().mockResolvedValue(undefined),
    loadShareLink: jest.fn().mockResolvedValue(undefined),
    me: signal(OWNER),
    participants,
    addParticipant: jest.fn(async (userId: string) => {
      if (people.addSaves === false) {
        return false;
      }
      participants.update((held) => [
        // A person already on the basket is **promoted** rather than added
        // twice, which is what the server does to a live link visitor (backend
        // `0140`, section 6): the row keeps its id and loses its expiry.
        ...held.filter((person) => person.userId !== userId),
        ...held
          .filter((person) => person.userId === userId)
          .map((person) => ({
            ...person,
            shareLinkId: null,
            expiresAt: null,
          })),
        ...(held.some((person) => person.userId === userId)
          ? []
          : [participant({ id: `p-${userId}`, kind: 'REGISTERED', userId })]),
      ]);
      return true;
    }),
    removeParticipant: jest.fn(async (participantId: string) => {
      if (people.removeFails) {
        throw new Error('refused');
      }
      participants.update((held) =>
        held.filter((person) => person.id !== participantId)
      );
    }),
  };

  const paramMap = convertToParamMap({ basketId: BASKET_ID });

  await TestBed.configureTestingModule({
    imports: [ShareSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      // Absent by default, so every test above runs against the real facade, which in
      // jsdom is a browser with no share sheet and no clipboard.
      ...(browser ? [provideFakeBrowserFacade(undefined, browser)] : []),
      { provide: BasketStore, useValue: store },
      {
        provide: ContactStore,
        useValue: { contacts: signal(CONTACTS), load: async () => undefined },
      },
      provideFakeZoneStore(fakeZoneStore({ zones: [ZONE] })),
      {
        provide: SheetNavigation,
        useValue: {
          dismiss: jest.fn().mockResolvedValue(undefined),
          leaveTo: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: Router,
        useValue: {
          navigate: jest.fn().mockResolvedValue(true),
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(paramMap),
          snapshot: { paramMap, parent: null },
          parent: {
            paramMap: of(paramMap),
            snapshot: { paramMap, parent: null },
            parent: null,
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShareSheet);
  fixture.detectChanges();
  // Let the link read come back, so the sheet has left `unknown` by the time a
  // test looks at it. Microtasks rather than `whenStable`, because part of this
  // file pins the clock and `whenStable` hangs under fake timers.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
  return Object.assign(fixture, { store });
}

/** The footer's controls, in the order they are stacked. */
const footer = (fixture: Awaited<ReturnType<typeof render>>) =>
  [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll(
      '.footer button'
    ),
  ] as HTMLButtonElement[];

describe('ShareSheet: the revoke pane cannot be double tapped into', () => {
  it('puts the cancel where the trigger was', async () => {
    // The one assertion the whole section is about. `Revoke the link` is index 0 of
    // the link pane's footer, so a stray second tap at those coordinates has to land
    // on the safe answer once the pane has switched.
    const fixture = await render();

    const [trigger] = footer(fixture);
    expect(trigger.textContent?.trim()).toBe('basket.share.revoke');

    trigger.click();
    fixture.detectChanges();

    const [first, second] = footer(fixture);
    expect(first.textContent?.trim()).toBe('basket.revoke.cancel');
    expect(second.textContent?.trim()).toBe('basket.revoke.confirm');
  });

  it('gives the cancel the trigger’s own treatment, so the rows line up', async () => {
    // A `.quiet` cancel is shorter than the `secondary-button` it stands in for, and
    // the geometry would be off by the difference: index 0 of one stack has to be
    // exactly index 0 of the other for the position argument to hold.
    const fixture = await render();

    const [trigger] = footer(fixture);
    trigger.click();
    fixture.detectChanges();

    const [cancel] = footer(fixture);
    expect(cancel.classList.contains('cancel')).toBe(true);
    expect(cancel.classList.contains('quiet')).toBe(false);
  });

  it('draws both stacks in the footer, not in the body', async () => {
    // What makes the alignment a rule rather than a coincidence: the footer is
    // outside the scroll and pinned to the bottom of the panel, so the positions stop
    // depending on how much copy is above them. The revoke pane's body is a paragraph
    // shorter and a checkbox taller than the link pane's.
    const fixture = await render();
    expect(footer(fixture)).toHaveLength(2);

    footer(fixture)[0].click();
    fixture.detectChanges();

    expect(footer(fixture)).toHaveLength(2);
  });

  it('leaves the dismissing control where it was, which is safe', async () => {
    // The confirm lands where `Close` was, and that does not move the bug: `Close`
    // dismisses the sheet, so its second tap arrives after the sheet is gone.
    const fixture = await render();

    const [, close] = footer(fixture);
    expect(close.textContent?.trim()).toBe('basket.share.close');
  });
});

/**
 * The second way to hand the link over, which this sheet had no control for.
 *
 * Copy is the one that always works; the system share sheet is how a link actually
 * reaches a group chat on a phone, and it is the treatment the group's invite card
 * has had since plan 0008. Drawn only where the browser has the API, because a
 * button that opens nothing is worse than one that is absent.
 */
describe('ShareSheet: sending the link', () => {
  function fakeWindow(
    sent: { url?: string },
    copied: string[],
    canShare = true
  ): Partial<BrowserFacade> {
    const navigator = {
      share: canShare
        ? (data: { url: string }) => {
            sent.url = data.url;
            return Promise.resolve();
          }
        : undefined,
      clipboard: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    };

    return {
      window: { navigator, location: { origin: 'https://velista.app' } },
    } as unknown as Partial<BrowserFacade>;
  }

  const share = (fixture: Awaited<ReturnType<typeof render>>) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button.share'
    );

  it('offers the share control where the browser has one', async () => {
    const fixture = await render(fakeWindow({}, []));

    expect(share(fixture)).not.toBeNull();
  });

  it('draws no share control where the browser has none', async () => {
    const fixture = await render(fakeWindow({}, [], false));

    expect(share(fixture)).toBeNull();
  });

  it('hands over the link itself, which carries no locale', async () => {
    const sent: { url?: string } = {};
    const fixture = await render(fakeWindow(sent, []));

    share(fixture)?.click();
    await fixture.whenStable();

    expect(sent.url).toBe('https://velista.app/velista/s/s3cr3t');
  });

  it('still offers Copy, because a URL on the clipboard goes anywhere', async () => {
    const copied: string[] = [];
    const fixture = await render(fakeWindow({}, copied));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button.copy')
      ?.click();
    await fixture.whenStable();

    expect(copied).toEqual(['https://velista.app/velista/s/s3cr3t']);
  });
});

/**
 * Velista `0094`, section 3: the sheet reads, a press mints, and the link says
 * when it stops working.
 */
describe('ShareSheet: the three link states', () => {
  // The clock is pinned, because the sheet chooses its state and its sentence by
  // comparing the link's end with the device's own now. Mid morning, so a link
  // eleven hours out lands this evening rather than after midnight: "today" and
  // "tomorrow" are two different sentences and each test says which it wants.
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    jest.setSystemTime(new Date('2026-09-22T10:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Let the pending promises run, without `whenStable`.
   *
   * `whenStable` hangs under fake timers, which is the house rule for every
   * spec in this repo that pins the clock.
   */
  const settle = async (fixture: Awaited<ReturnType<typeof render>>) => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  };

  const text = (fixture: Awaited<ReturnType<typeof render>>, css: string) =>
    (fixture.nativeElement as HTMLElement)
      .querySelector(css)
      ?.textContent?.trim() ?? null;

  const url = (fixture: Awaited<ReturnType<typeof render>>) =>
    (fixture.nativeElement as HTMLElement).querySelector('.link-url');

  const make = (fixture: Awaited<ReturnType<typeof render>>) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button.make'
    );

  it('opens without making a link', async () => {
    // The whole point of the section. Opening this sheet to tick a flatmate must
    // not mint a twelve hour invitation nobody asked for.
    const fixture = await render();

    expect(fixture.store.share).not.toHaveBeenCalled();
    expect(fixture.store.loadShareLink).toHaveBeenCalled();
  });

  it('claims nothing about a basket that has not answered yet', async () => {
    // A cold load on this sheet's own URL under `shopping-lists/live`, where the
    // id arrives with the basket. `loadShareLink` addresses the basket by id and
    // does nothing without one, so a sheet that read here would sit on "no link"
    // for ever and offer a button that mints a second one.
    const fixture = await render(undefined, { basket: null });

    expect(fixture.store.loadShareLink).not.toHaveBeenCalled();
    expect(text(fixture, '.checking')).toBe('basket.share.checking');
    expect(text(fixture, '.none')).toBeNull();
    expect(make(fixture)).toBeNull();
    expect(url(fixture)).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.footer .revoke')
    ).toBeNull();
  });

  it('reads the link as soon as the basket names itself', async () => {
    const fixture = await render(undefined, { basket: null });
    expect(fixture.store.loadShareLink).not.toHaveBeenCalled();

    fixture.store.basket.set({ id: BASKET_ID, kind: 'LIVE' });
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.store.loadShareLink).toHaveBeenCalledTimes(1);
    expect(url(fixture)).not.toBeNull();
  });

  it('says what a LIVE basket’s link really hands over', async () => {
    // Every list the owner can write, now and later, rather than the lines of
    // one trip (velista `0094`, section 7).
    const live = await render(undefined, { basket: 'LIVE' });
    expect(text(live, '.body')).toBe('basket.share.bodyLive');

    const trip = await render();
    expect(text(trip, '.body')).toBe('basket.share.body');
  });

  it('offers to make one when the basket has none', async () => {
    const fixture = await render(undefined, { link: null });

    expect(text(fixture, '.none')).toBe('basket.share.none');
    expect(make(fixture)?.textContent?.trim()).toBe('basket.share.make');
    expect(url(fixture)).toBeNull();
  });

  it('draws the URL and when it stops working', async () => {
    const fixture = await render();

    expect(url(fixture)).not.toBeNull();
    expect(text(fixture, '.works-until')).toBe('basket.share.worksUntil');
  });

  it('names the day when the link runs past midnight', async () => {
    // Section 9: a bare "07:15" is ambiguous to somebody who cannot glance at a
    // clock, so the day is printed whenever it is not today's.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const fixture = await render(undefined, {
      link: link({ expiresAt: tomorrow }),
    });

    expect(text(fixture, '.works-until')).toBe('basket.share.worksUntilDay');
  });

  it('offers a new link when the last one has ended, and no URL', async () => {
    const fixture = await render(undefined, { link: endedLink() });

    expect(text(fixture, '.ended' as string)).toBeNull();
    expect(text(fixture, '.none')).toBe('basket.share.ended');
    expect(make(fixture)?.textContent?.trim()).toBe('basket.share.makeNew');
    // An ended link opens nothing, so offering it to paste into a chat would be
    // handing somebody a dead string.
    expect(url(fixture)).toBeNull();
    // And there is nothing left to revoke: the press replaces it.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.footer .revoke')
    ).toBeNull();
  });

  it('mints once on a press, and never revokes first', async () => {
    const fixture = await render(undefined, { link: endedLink() });

    make(fixture)?.click();
    await settle(fixture);

    expect(fixture.store.share).toHaveBeenCalledTimes(1);
    expect(fixture.store.revokeLink).not.toHaveBeenCalled();
    expect(url(fixture)).not.toBeNull();
  });
});

/** Velista `0085`, section 4, test 3: the owner's people, saved at every tick. */
describe('ShareSheet: people', () => {
  const settle = async (fixture: Awaited<ReturnType<typeof render>>) => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  };

  const boxOf = (fixture: Awaited<ReturnType<typeof render>>, name: string) =>
    [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        'lib-people-picker label'
      ),
    ]
      .find(
        (label) => label.querySelector('.name')?.textContent?.trim() === name
      )
      ?.querySelector('input') as HTMLInputElement;

  const error = (fixture: Awaited<ReturnType<typeof render>>) =>
    (fixture.nativeElement as HTMLElement)
      .querySelector('.people-error')
      ?.textContent?.trim() ?? null;

  it('ticks named people only, and leaves a visiting contact unticked', async () => {
    // Velista `0094` section 3 reverses `0085`. The tick means "stays until you
    // untick them", so somebody who is here on the link is **not** ticked: the
    // empty box is the thing that would keep them.
    const fixture = await render(undefined, {
      participants: [
        OWNER,
        visitor({ id: 'p-leo', userId: 'u-leo' }),
        participant({ id: 'p-marta', kind: 'REGISTERED', userId: 'u-marta' }),
      ],
    });

    expect(boxOf(fixture, 'Leo').checked).toBe(false);
    expect(boxOf(fixture, 'Marta').checked).toBe(true);

    // And the line beside the empty box says why it is empty.
    const hint = document.getElementById(
      boxOf(fixture, 'Leo').getAttribute('aria-describedby') ?? ''
    );
    expect(hint?.textContent).toContain('share.people.visiting');
  });

  it('keeps a visitor on a tick, and the visiting line goes', async () => {
    const fixture = await render(undefined, {
      participants: [OWNER, visitor({ id: 'p-leo', userId: 'u-leo' })],
    });

    boxOf(fixture, 'Leo').click();
    fixture.detectChanges();
    await settle(fixture);

    // The same call as adding somebody new. The server promotes the row.
    expect(fixture.store.addParticipant).toHaveBeenCalledWith('u-leo');
    expect(boxOf(fixture, 'Leo').checked).toBe(true);
    expect(boxOf(fixture, 'Leo').getAttribute('aria-describedby')).toBeNull();
  });

  it('says once, under the whole list, that a removal is for good', async () => {
    // What `share.people.linkJoined` used to say about one kind of person, and
    // was always true of everybody in the picker.
    const fixture = await render();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.people-note')
        ?.textContent?.trim()
    ).toBe('share.people.removeNote');
  });

  it('posts at once on a tick', async () => {
    const fixture = await render();

    boxOf(fixture, 'Marta').click();
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.store.addParticipant).toHaveBeenCalledWith('u-marta');
    expect(boxOf(fixture, 'Marta').checked).toBe(true);
    expect(error(fixture)).toBeNull();
  });

  it('deletes at once on an untick, by participant id', async () => {
    const fixture = await render(undefined, {
      participants: [
        OWNER,
        participant({ id: 'p-leo', kind: 'REGISTERED', userId: 'u-leo' }),
      ],
    });

    boxOf(fixture, 'Leo').click();
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.store.removeParticipant).toHaveBeenCalledWith('p-leo');
    expect(boxOf(fixture, 'Leo').checked).toBe(false);
  });

  it('puts the box back and says so when a tick does not save', async () => {
    const fixture = await render(undefined, { addSaves: false });

    boxOf(fixture, 'Marta').click();
    fixture.detectChanges();
    await settle(fixture);

    expect(boxOf(fixture, 'Marta').checked).toBe(false);
    expect(error(fixture)).toBe('share.people.failed');
  });

  it('puts the box back and says so when an untick does not save', async () => {
    const fixture = await render(undefined, {
      participants: [
        OWNER,
        participant({ id: 'p-leo', kind: 'REGISTERED', userId: 'u-leo' }),
      ],
      removeFails: true,
    });

    boxOf(fixture, 'Leo').click();
    fixture.detectChanges();
    await settle(fixture);

    expect(boxOf(fixture, 'Leo').checked).toBe(true);
    expect(error(fixture)).toBe('share.people.failed');
  });

  it('reads the joined count again when the participants move', async () => {
    const fixture = await render();
    // One read already, from the sheet opening: it reads the link rather than
    // minting one since velista `0094`. What matters here is the **second**.
    const onOpen = fixture.store.loadShareLink.mock.calls.length;

    boxOf(fixture, 'Marta').click();
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.store.loadShareLink.mock.calls.length).toBeGreaterThan(
      onOpen
    );
  });
});
