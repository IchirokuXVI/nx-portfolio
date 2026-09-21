import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, SessionStore } from '@portfolio/velista/data-access';
import type { BasketParticipant } from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { PeopleSheet } from './people-sheet';

/**
 * The two facts the people sheet states about one participant, and the copy for their
 * absences (plan 0049, section 6).
 *
 * Both were drawn with **one** key, `basket.people.deviceUnknown` ("Not recorded"),
 * which is a device oriented phrase doing double duty for a time. A language that
 * inflects the phrase for what is missing cannot say both with one string, so a missing
 * join time has its own key.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

function participant(
  overrides: Partial<BasketParticipant> = {}
): BasketParticipant {
  return {
    id: 'p2',
    kind: 'GUEST',
    displayName: 'Marc',
    username: null,
    guestNumber: 1,
    userId: null,
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: 'sl1',
    // Present, which is what makes the detail pane reachable at all: only a reader who
    // passes the all or nothing rule is sent a device.
    device: null,
    ...overrides,
  };
}

async function render(
  person: BasketParticipant,
  inspect = true,
  reader: Partial<BasketParticipant> = {},
  leaves = true
) {
  TestBed.resetTestingModule();

  const me = participant({
    id: 'me',
    kind: 'OWNER',
    displayName: null,
    guestNumber: null,
    userId: 'u-me',
    shareLinkId: null,
    ...reader,
  });
  const sheet = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const leaveBasket = jest.fn().mockResolvedValue(leaves);

  const paramMap = convertToParamMap({ basketId: BASKET_ID });

  await TestBed.configureTestingModule({
    imports: [PeopleSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      {
        provide: BasketStore,
        useValue: {
          basket: signal({ name: 'Saturday shop', generatedAt: null }),
          state: signal('ready'),
          participants: signal([me, person]),
          participantsById: signal(
            new Map([
              [me.id, me],
              [person.id, person],
            ])
          ),
          me: signal(me),
          present: signal([]),
          seesZoneData: signal(true),
          removeParticipant: jest.fn().mockResolvedValue(undefined),
          leaveBasket,
        },
      },
      { provide: SessionStore, useValue: { username: signal('Ana') } },
      { provide: SheetNavigation, useValue: sheet },
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

  const fixture = TestBed.createComponent(PeopleSheet);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();

  if (inspect) {
    // Open the detail pane, which is the only place either fact is drawn.
    fixture.componentInstance['inspect'](person);
    fixture.detectChanges();
  }

  return Object.assign(fixture, { me, sheet, leaveBasket });
}

/** The `<dd>` beside each `<dt>`, in the order the definition list states them. */
const facts = (fixture: Awaited<ReturnType<typeof render>>) =>
  [...(fixture.nativeElement as HTMLElement).querySelectorAll('.facts dd')].map(
    (node) => node.textContent?.trim() ?? ''
  );

describe('PeopleSheet: a missing join time', () => {
  it('has its own copy, not the device s', async () => {
    const fixture = await render(participant({ joinedAt: null, device: null }));

    const [joined, device] = facts(fixture);
    expect(joined).toBe('basket.people.joinedUnknown');
    // The device keeps the phrase that was always its own, so the fix is a second key
    // rather than a rename that moves the problem across.
    expect(device).toBe('basket.people.deviceUnknown');
  });

  it('says the time itself when there is one', async () => {
    const fixture = await render(
      participant({ joinedAt: new Date('2026-08-21T10:41:00.000Z') })
    );

    const [joined] = facts(fixture);
    expect(joined).not.toContain('basket.people');
    expect(joined).toContain('2026');
  });
});

/**
 * Plan 0052, section 2.1: the reader is named, and marked.
 *
 * The reader here is the owner, `me`, whose row core creates with no `displayName` at
 * all, so their account name is the only thing that can name it. The other row is a
 * guest called Marc.
 */
describe('PeopleSheet: naming the reader', () => {
  const names = (fixture: Awaited<ReturnType<typeof render>>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('.person')].map(
      (row) => ({
        name: row.querySelector('.person-name')?.textContent?.trim() ?? '',
        you: row.querySelector('.you-tag')?.textContent?.trim() ?? null,
        guest: row.querySelector('.guest-tag')?.textContent?.trim() ?? null,
      })
    );

  it('draws the reader’s own name rather than the word "You"', async () => {
    // The sheet is read on other people's phones over a trolley, so a row labelled
    // "You" changes meaning depending on whose hand the device is in.
    const fixture = await render(participant(), false);

    const [mine] = names(fixture);
    expect(mine.name).toBe('Ana');
  });

  it('keeps a marker beside it, so the reader can still find themselves', async () => {
    // The name replaces the word and does not simply delete it: a list of four names
    // with nothing saying which is yours is a worse sheet than the one reported.
    const fixture = await render(participant(), false);

    const [mine, other] = names(fixture);
    expect(mine.you).toBe('basket.people.you');
    expect(other.you).toBeNull();
  });

  it('leaves the guest mark exactly where it was', async () => {
    // `0051`'s ring and word are untouched by this: a name makes somebody nameable
    // and never verified, and two guests can still both be called Dani.
    const fixture = await render(participant(), false);

    const [mine, other] = names(fixture);
    expect(other.guest).toBe('basket.people.guest');
    expect(mine.guest).toBeNull();
  });
});

/** Velista `0085`, section 7, test 8: leaving is a registered participant's alone. */
describe('PeopleSheet: leaving', () => {
  const owner = participant({
    id: 'p-owner',
    kind: 'OWNER',
    displayName: null,
    username: 'Marta',
    guestNumber: null,
    userId: 'u-marta',
    shareLinkId: null,
  });

  /** A registered reader, sent no devices, as an invited member is. */
  const member: Partial<BasketParticipant> = {
    kind: 'REGISTERED',
    username: 'Ana',
    device: undefined,
  };

  const buttons = (fixture: Awaited<ReturnType<typeof render>>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map(
      (button) => button.textContent?.trim()
    );

  const openOwnRow = (fixture: Awaited<ReturnType<typeof render>>) => {
    fixture.componentInstance['inspect'](fixture.me);
    fixture.detectChanges();
  };

  const press = (fixture: Awaited<ReturnType<typeof render>>, key: string) => {
    const button = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ].find((candidate) => candidate.textContent?.trim() === key);
    button?.click();
    fixture.detectChanges();
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is offered on a registered participant s own row, devices or not', async () => {
    const fixture = await render(owner, false, member);

    openOwnRow(fixture);

    expect(buttons(fixture)).toContain('basket.people.leave');
  });

  it('is not offered on somebody else s row', async () => {
    const fixture = await render({ ...owner, device: null }, true, member);

    expect(buttons(fixture)).not.toContain('basket.people.leave');
  });

  it('is never offered to the owner', async () => {
    const fixture = await render(participant(), false);

    openOwnRow(fixture);

    expect(buttons(fixture)).not.toContain('basket.people.leave');
  });

  it('is never offered to a guest', async () => {
    const fixture = await render(owner, false, {
      kind: 'GUEST',
      userId: null,
      device: undefined,
    });

    openOwnRow(fixture);

    expect(buttons(fixture)).not.toContain('basket.people.leave');
  });

  it('asks first, with focus on the question', async () => {
    const fixture = await render(owner, false, member);
    openOwnRow(fixture);

    press(fixture, 'basket.people.leave');
    await fixture.whenStable();

    const question = (fixture.nativeElement as HTMLElement).querySelector(
      'h2'
    ) as HTMLElement;
    expect(question.textContent?.trim()).toBe('basket.people.leaveQuestion');
    expect(document.activeElement).toBe(question);
    expect(fixture.leaveBasket).not.toHaveBeenCalled();
  });

  it('calls the route and leaves to the Shared lists tab when confirmed', async () => {
    const fixture = await render(owner, false, member);
    openOwnRow(fixture);
    press(fixture, 'basket.people.leave');

    press(fixture, 'basket.people.leaveConfirm');
    await fixture.whenStable();

    expect(fixture.leaveBasket).toHaveBeenCalledTimes(1);
    expect(fixture.sheet.leaveTo).toHaveBeenCalledWith(
      '/velista/en/shopping-lists?tab=shared'
    );
    expect(fixture.sheet.dismiss).not.toHaveBeenCalled();
  });

  it('stays, and says so, when leaving does not go through', async () => {
    const fixture = await render(owner, false, member, false);
    openOwnRow(fixture);
    press(fixture, 'basket.people.leave');

    press(fixture, 'basket.people.leaveConfirm');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.sheet.leaveTo).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.leave-error')
        ?.textContent?.trim()
    ).toBe('basket.people.leaveFailed');
  });

  it('goes back to the person on Stay', async () => {
    const fixture = await render(owner, false, member);
    openOwnRow(fixture);
    press(fixture, 'basket.people.leave');

    press(fixture, 'basket.people.stay');

    expect(buttons(fixture)).toContain('basket.people.leave');
    expect(fixture.leaveBasket).not.toHaveBeenCalled();
  });

  it('says an invited member was added rather than that they made the list', async () => {
    const fixture = await render(owner, false, member);

    openOwnRow(fixture);

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.how')
        ?.textContent?.trim()
    ).toBe('basket.people.viaInvite');
  });
});
