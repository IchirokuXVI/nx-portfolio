import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { ADMIN_SECTIONS } from './sections';

/**
 * **Whether a named action is drawn in red is a decision, and this is where
 * it is written down** (admin plan 0057).
 *
 * The record page takes the tone of a question from the action: `danger` is a
 * red button, and anything else is the ordinary one. So an action that harms
 * and does not say `danger` asks its question with a button that looks like
 * "Save". That happened to every membership action at once, and nothing
 * failed.
 *
 * Every descriptor the app mounts is read as a value. Nothing is rendered.
 * Each named action is in one of two lists, so a new action fails this spec
 * until somebody puts it in one of them.
 *
 * - `danger`: it takes something away, or it cannot be undone.
 * - `plain`: it is undone by another action, or it only sends something.
 */
const PINNED: Readonly<
  Record<string, { readonly danger: string[]; readonly plain: string[] }>
> = {
  brands: { danger: ['delete-spelling'], plain: [] },
  'list-lines': { danger: ['reject-line'], plain: ['approve-line'] },
  memberships: {
    danger: [
      'reject-member',
      // The zone changes hands, and only its new owner can hand it back.
      'transfer-ownership',
      'kick-member',
      'ban-member',
    ],
    plain: ['approve-member'],
  },
  'postal-codes': { danger: [], plain: ['discover-again'] },
  'price-scopes': { danger: [], plain: ['makeDefault'] },
  // Stopping the fetch of a chain destroys nothing: each of the two is taken
  // back by the other, with one press (admin plan 0059).
  sources: { danger: [], plain: ['stop-fetching', 'allow-fetching'] },
  users: {
    danger: ['delete-account'],
    plain: [
      'resend-verification',
      // A role that was given is taken away again, and the other way round.
      'give-role-admin',
      'take-role-admin',
      'give-role-premium',
      'take-role-premium',
    ],
  },
  zones: {
    danger: [
      // Every invitation that was sent stops working.
      'regenerate-join-code',
      'mark-for-deletion',
      'delete-zone',
    ],
    // The undo of the mark.
    plain: ['restore-zone'],
  },
};

function mounted(): readonly AnyResourceDescriptor[] {
  return [
    ...new Set(
      ADMIN_SECTIONS.flatMap((section) => [
        ...(section.resources ?? []),
        ...(section.held ?? []),
      ])
    ),
  ];
}

function drawn(): typeof PINNED {
  return Object.fromEntries(
    mounted().flatMap((descriptor) => {
      const named = TestBed.runInInjectionContext(
        () => descriptor.actions?.named?.() ?? []
      );
      return named.length === 0
        ? []
        : [
            [
              descriptor.name,
              {
                danger: named
                  .filter((action) => action.danger === true)
                  .map((action) => action.name),
                plain: named
                  .filter((action) => action.danger !== true)
                  .map((action) => action.name),
              },
            ],
          ];
    })
  );
}

describe('the named actions that are drawn in red', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RokuTranslatorTestingModule.forTesting()],
      // The actions of a chain source are built over the gateway of the
      // sources, which names the chain and asks which deployment it is on.
      // These are what the app provides at its root for both.
      providers: [
        ContentLocaleStore,
        ServerReachability,
        SessionStorage,
        SessionStore,
        DeploymentStore,
      ],
    });
  });

  it('reads at least the resources the rail leads to', () => {
    // A guard that walked an empty list would pass for ever.
    expect(mounted().length).toBeGreaterThan(10);
  });

  it('is the pinned set, for every descriptor the app mounts', () => {
    expect(drawn()).toEqual(PINNED);
  });
});
