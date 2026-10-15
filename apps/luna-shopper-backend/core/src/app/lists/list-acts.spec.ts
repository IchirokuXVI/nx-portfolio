import {
  LineApprovalStatus,
  ListPermission,
} from '@portfolio/luna-shopper/contracts';
import { canChangeDemand, canSettle } from './list-acts';

/**
 * The rule of plan 0131, stated over every input it has.
 *
 * Both functions are pure, so the whole domain is small enough to enumerate:
 * sixteen permission sets against three approval states. A table rather than a
 * handful of examples, because the thing these functions exist to stop is two
 * surfaces disagreeing about one of the combinations nobody wrote a case for.
 */

const ALL = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
  ListPermission.MANAGE,
] as const;

/** Every subset of the four permissions, as sets. */
function everySubset(): Set<ListPermission>[] {
  const subsets: Set<ListPermission>[] = [];
  for (let mask = 0; mask < 1 << ALL.length; mask += 1) {
    subsets.push(
      new Set(ALL.filter((_, index) => (mask & (1 << index)) !== 0))
    );
  }
  return subsets;
}

const APPROVALS = [
  LineApprovalStatus.PENDING,
  LineApprovalStatus.APPROVED,
  LineApprovalStatus.REJECTED,
];

describe('canSettle', () => {
  it.each(everySubset().map((set) => [[...set].join(',') || '(none)', set]))(
    'answers WRITE for %s',
    (_name, permissions) => {
      const set = permissions as Set<ListPermission>;
      expect(canSettle(set)).toBe(set.has(ListPermission.WRITE));
    }
  );

  it('refuses MANAGE without WRITE, as the basket does (plan 0209, section 4)', () => {
    // Only a grant written by hand can hold it: the app adds WRITE to every
    // grant with MANAGE. The basket covers no such list (`WRITABLE_LIST`), so
    // neither surface settles it.
    expect(canSettle(new Set([ListPermission.MANAGE]))).toBe(false);
    expect(
      canSettle(
        new Set([
          ListPermission.READ,
          ListPermission.DECIDE,
          ListPermission.MANAGE,
        ])
      )
    ).toBe(false);
  });

  it('refuses a reader and a DECIDE holder who cannot write', () => {
    expect(canSettle(new Set([ListPermission.READ]))).toBe(false);
    expect(
      canSettle(new Set([ListPermission.READ, ListPermission.DECIDE]))
    ).toBe(false);
  });

  it('admits a WRITE holder who cannot approve', () => {
    expect(
      canSettle(new Set([ListPermission.READ, ListPermission.WRITE]))
    ).toBe(true);
  });
});

describe('canChangeDemand', () => {
  it.each(
    everySubset().flatMap((set) =>
      APPROVALS.map(
        (approval) =>
          [
            `${[...set].join(',') || '(none)'} on ${approval}`,
            set,
            approval,
          ] as const
      )
    )
  )('states the rule for %s', (_name, permissions, approval) => {
    const expected = permissions.has(ListPermission.MANAGE)
      ? true
      : approval === LineApprovalStatus.APPROVED
        ? permissions.has(ListPermission.DECIDE)
        : permissions.has(ListPermission.WRITE);
    expect(canChangeDemand(permissions, approval)).toBe(expected);
  });

  it('refuses a WRITE holder the quantity of an approved line', () => {
    const write = new Set([ListPermission.READ, ListPermission.WRITE]);
    expect(canChangeDemand(write, LineApprovalStatus.PENDING)).toBe(true);
    expect(canChangeDemand(write, LineApprovalStatus.APPROVED)).toBe(false);
  });

  it('admits a DECIDE holder the quantity of an approved line and refuses a pending one', () => {
    const decide = new Set([ListPermission.READ, ListPermission.DECIDE]);
    expect(canChangeDemand(decide, LineApprovalStatus.APPROVED)).toBe(true);
    // Plan 0076 section 4.1 the other way round: a pending line is still
    // somebody's request, and editing one is a write.
    expect(canChangeDemand(decide, LineApprovalStatus.PENDING)).toBe(false);
  });

  it('admits MANAGE on every approval state', () => {
    const manage = new Set([ListPermission.MANAGE]);
    for (const approval of APPROVALS) {
      expect(canChangeDemand(manage, approval)).toBe(true);
    }
  });
});
