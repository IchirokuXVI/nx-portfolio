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

function link(): BasketShareLink {
  return {
    id: 'sl1',
    secret: 's3cr3t',
    createdAt: new Date('2026-08-21T09:00:00.000Z'),
    expiresAt: null,
    participantCount: 2,
  };
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
    ...overrides,
  };
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
}

async function render(
  browser?: Partial<BrowserFacade>,
  people: PeopleOptions = {}
) {
  TestBed.resetTestingModule();

  const participants = signal<readonly BasketParticipant[]>(
    people.participants ?? [OWNER]
  );
  const store = {
    basket: signal(null),
    state: signal('ready'),
    error: signal(null),
    // Already minted, which is the pane the trigger lives on.
    shareLink: signal(link()),
    share: jest.fn().mockResolvedValue(link()),
    revokeLink: jest.fn().mockResolvedValue(undefined),
    loadShareLink: jest.fn().mockResolvedValue(undefined),
    me: signal(OWNER),
    participants,
    addParticipant: jest.fn(async (userId: string) => {
      if (people.addSaves === false) {
        return false;
      }
      participants.update((held) => [
        ...held,
        participant({ id: `p-${userId}`, kind: 'REGISTERED', userId }),
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

  it('ticks the live registered participants, one who joined by link included', async () => {
    const fixture = await render(undefined, {
      participants: [
        OWNER,
        participant({
          id: 'p-leo',
          kind: 'REGISTERED',
          userId: 'u-leo',
          shareLinkId: 'sl1',
        }),
      ],
    });

    expect(boxOf(fixture, 'Leo').checked).toBe(true);
    expect(boxOf(fixture, 'Marta').checked).toBe(false);

    // The link joiner is warned before the untick that it is for good.
    const hint = document.getElementById(
      boxOf(fixture, 'Leo').getAttribute('aria-describedby') ?? ''
    );
    expect(hint?.textContent?.trim()).toBe('share.people.linkJoined');
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
    expect(fixture.store.loadShareLink).not.toHaveBeenCalled();

    boxOf(fixture, 'Marta').click();
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.store.loadShareLink).toHaveBeenCalled();
  });
});
