import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  DIRECTORY_SERVICE,
  GatewayError,
  SessionStorage,
  type DirectoryServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceChanges } from '@portfolio/luna-shopper-admin/feature-resource';
import { USER_SEED } from './people-seed';
import {
  bootShoppers,
  find,
  findAll,
  recordingDirectory,
  settle,
  textOf,
} from './shoppers.testing';

/**
 * Open the app as a person (admin plan 0062), on the page of a person.
 *
 * The directory service is replaced, so that each spec can say what the
 * switch answers and see what the dialog sent. Assertions are on keys: the
 * testing translator does not interpolate.
 */

const [ROSA, , , GUEST] = USER_SEED;
const PEOPLE = '/shoppers/people';
const LINK = 'https://velista.test/en/auth/impersonate#code=c1';

const withDirectory = (directory: DirectoryServiceI) => [
  { provide: DIRECTORY_SERVICE, useValue: directory },
];

const menuEntries = (fixture: ComponentFixture<unknown>) =>
  findAll(fixture, 'lib-record-page lib-page-header [data-action]').map(
    (entry) => entry.getAttribute('data-action')
  );

async function open(directory: DirectoryServiceI, userId = ROSA.userId) {
  // The switch is asked for the operator signed in, so one is.
  new SessionStorage().write({
    adminId: 'admin-1',
    username: 'operator',
    displayName: null,
    accessToken: 'token',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    receivedAt: new Date(),
  });
  const fixture = await bootShoppers(
    `${PEOPLE}/${userId}`,
    withDirectory(directory)
  );
  // The switch is read as the actions are built, and answers after.
  await settle(fixture);
  return fixture;
}

async function press(
  fixture: ComponentFixture<unknown>,
  selector: string
): Promise<void> {
  find<HTMLElement>(fixture, selector)?.click();
  await settle(fixture);
  await settle(fixture);
}

async function choose(
  fixture: ComponentFixture<unknown>,
  reason: string
): Promise<void> {
  const select = find<HTMLSelectElement>(fixture, '[data-impersonate-reason]');
  if (select === null) {
    throw new Error('no reason to choose');
  }
  select.value = reason;
  select.dispatchEvent(new Event('change'));
  await settle(fixture);
}

const startButton = (fixture: ComponentFixture<unknown>) =>
  find<HTMLButtonElement>(fixture, '[data-impersonate-start]');

describe('opening the app as a person', () => {
  afterEach(() => localStorage.clear());

  it('is offered on the page of a person and of a guest, before deleting', async () => {
    const { directory } = recordingDirectory();

    const fixture = await open(directory);
    const entries = menuEntries(fixture);
    expect(entries).toContain('open-as-user');
    expect(entries.indexOf('open-as-user')).toBeLessThan(
      entries.indexOf('delete-account')
    );
    // Not red: it changes nothing in the account.
    expect(
      find(fixture, '[data-action="open-as-user"]')?.hasAttribute(
        'pageMoreDanger'
      )
    ).toBe(false);

    const guest = await open(directory, GUEST.userId);
    expect(menuEntries(guest)).toContain('open-as-user');
  });

  it.each([
    ['switched off', async () => false],
    [
      'unreadable',
      async () => {
        throw new GatewayError({ code: '', status: 500, correlationId: '' });
      },
    ],
  ])('is absent where the switch is %s', async (_, impersonationEnabled) => {
    const { directory } = recordingDirectory();

    const fixture = await open({ ...directory, impersonationEnabled });

    expect(menuEntries(fixture)).not.toContain('open-as-user');
  });

  it('asks why before it starts, and sends the reason as its code', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await open(directory);

    await press(fixture, '[data-action="open-as-user"]');

    expect(find(fixture, '[data-action-outcome]')).not.toBeNull();
    expect(textOf(fixture)).toContain('people.users.impersonate.heading');
    expect(textOf(fixture)).toContain('people.users.impersonate.body');
    const label = find(fixture, 'label[for="impersonate-reason"]');
    expect(label?.textContent).toContain(
      'people.users.impersonate.reason.label'
    );
    // Nothing chosen, and nothing to press yet.
    expect(
      find<HTMLSelectElement>(fixture, '[data-impersonate-reason]')?.value
    ).toBe('');
    expect(startButton(fixture)?.disabled).toBe(true);
    expect(
      findAll<HTMLOptionElement>(
        fixture,
        '[data-impersonate-reason] option:not([disabled])'
      ).map((option) => option.value)
    ).toEqual(['BUG_REPORT', 'SUPPORT_REQUEST', 'TESTING', 'OTHER']);

    await choose(fixture, 'TESTING');
    expect(find(fixture, '[data-impersonate-note]')).toBeNull();
    expect(startButton(fixture)?.disabled).toBe(false);

    await press(fixture, '[data-impersonate-start]');

    expect(calls).toEqual([`impersonate:${ROSA.userId}:TESTING::en`]);
  });

  it('asks what for when the reason is Other, and sends the note', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await open(directory);
    await press(fixture, '[data-action="open-as-user"]');

    await choose(fixture, 'OTHER');
    const note = find<HTMLTextAreaElement>(fixture, '[data-impersonate-note]');
    expect(note).not.toBeNull();
    expect(note?.required).toBe(true);
    expect(note?.maxLength).toBe(500);
    expect(
      find(fixture, 'label[for="impersonate-note"]')?.textContent
    ).toContain('people.users.impersonate.note.label');
    // Required: an empty note, or one of spaces, starts nothing.
    expect(startButton(fixture)?.disabled).toBe(true);

    if (note !== null) {
      note.value = '  Checking the basket  ';
      note.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    expect(startButton(fixture)?.disabled).toBe(false);

    await press(fixture, '[data-impersonate-start]');

    expect(calls).toEqual([
      `impersonate:${ROSA.userId}:OTHER:Checking the basket:en`,
    ]);
  });

  it('shows one real link, drops it once pressed, and says when the session ends', async () => {
    const { directory } = recordingDirectory();
    const fixture = await open(directory);
    await press(fixture, '[data-action="open-as-user"]');
    await choose(fixture, 'BUG_REPORT');
    await press(fixture, '[data-impersonate-start]');

    const link = find<HTMLAnchorElement>(fixture, '[data-impersonate-link]');
    expect(link?.getAttribute('href')).toBe(LINK);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent).toContain('people.users.impersonate.open');
    expect(textOf(fixture)).toContain('people.users.impersonate.once');
    expect(find(fixture, '[data-impersonate-left]')).not.toBeNull();

    // The test document cannot open a tab; the press is what is asserted.
    const block = (event: Event) => event.preventDefault();
    document.addEventListener('click', block);
    await press(fixture, '[data-impersonate-link]');
    document.removeEventListener('click', block);

    expect(find(fixture, '[data-impersonate-link]')).toBeNull();
    expect(fixture.nativeElement.innerHTML).not.toContain('code=c1');
    expect(find(fixture, '[data-impersonate-opened]')?.textContent).toContain(
      'people.users.impersonate.opened'
    );
    // Close is always there.
    expect(find(fixture, '[data-action-outcome] [data-close]')).not.toBeNull();
  });

  it('replaces a link that is too old, and starts again from the reason', async () => {
    const { directory } = recordingDirectory();
    const fixture = await open({
      ...directory,
      startImpersonation: async () => ({
        sessionId: 's1',
        url: LINK,
        codeExpiresAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: '2026-10-15T21:30:00.000Z',
      }),
    });
    await press(fixture, '[data-action="open-as-user"]');
    await choose(fixture, 'SUPPORT_REQUEST');
    await press(fixture, '[data-impersonate-start]');

    expect(find(fixture, '[data-impersonate-link]')).toBeNull();
    expect(fixture.nativeElement.innerHTML).not.toContain('code=c1');
    expect(find(fixture, '[data-impersonate-old]')?.textContent).toContain(
      'people.users.impersonate.tooOld'
    );

    await press(fixture, '[data-impersonate-again]');

    expect(find(fixture, '[data-impersonate-reason]')).not.toBeNull();
  });

  it('keeps the link nowhere once the dialog closes', async () => {
    const { directory } = recordingDirectory();
    const fixture = await open(directory);
    await press(fixture, '[data-action="open-as-user"]');
    await choose(fixture, 'TESTING');
    await press(fixture, '[data-impersonate-start]');
    expect(fixture.nativeElement.innerHTML).toContain('code=c1');

    await press(fixture, '[data-action-outcome] [data-close]');

    expect(find(fixture, '[data-action-outcome]')).toBeNull();
    expect(fixture.nativeElement.innerHTML).not.toContain('code=c1');
    expect(JSON.stringify({ ...localStorage })).not.toContain('code=c1');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('code=c1');
  });

  it.each([
    [
      new GatewayError({
        code: 'impersonation_disabled',
        status: 403,
        correlationId: '',
      }),
      'people.users.impersonate.refused.disabled',
    ],
    [
      new GatewayError({ code: 'not_found', status: 404, correlationId: '' }),
      'people.users.impersonate.refused.gone',
    ],
    [
      new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: '',
      }),
      'resource.error.validation',
    ],
  ])('says why a start was refused: %s', async (refusal, key) => {
    const { directory } = recordingDirectory();
    const fixture = await open({
      ...directory,
      startImpersonation: async () => {
        throw refusal;
      },
    });
    await press(fixture, '[data-action="open-as-user"]');
    await choose(fixture, 'TESTING');
    await press(fixture, '[data-impersonate-start]');

    expect(find(fixture, '[data-impersonate-refusal]')?.textContent).toContain(
      key
    );
    expect(find(fixture, '[data-impersonate-link]')).toBeNull();
  });

  it('reads the list again when the account is gone', async () => {
    const { directory } = recordingDirectory();
    const fixture = await open({
      ...directory,
      startImpersonation: async () => {
        throw new GatewayError({
          code: 'not_found',
          status: 404,
          correlationId: '',
        });
      },
    });
    await press(fixture, '[data-action="open-as-user"]');
    await choose(fixture, 'BUG_REPORT');
    const changes = TestBed.inject(ResourceChanges);
    const before = changes.version('users');

    await press(fixture, '[data-impersonate-start]');

    expect(changes.version('users')).toBe(before + 1);
    // No second press can bring the account back.
    expect(startButton(fixture)?.disabled).toBe(true);
  });
});
