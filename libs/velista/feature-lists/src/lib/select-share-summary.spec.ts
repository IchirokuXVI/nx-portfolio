import { selectShareSummary } from './select-share-summary';

/**
 * The six cases of plan 0036 section 5, as a table, because the rule is a table.
 *
 * The two worth reading are the pair and the collapse. `WRITE` and `DECIDE` show
 * together because neither implies the other; everything else shows the highest thing
 * held, because everything else does.
 */
describe('selectShareSummary', () => {
  it.each([
    {
      held: [],
      shown: [],
      why: 'no access, drawn in words rather than a badge',
    },
    { held: ['READ'], shown: ['READ'], why: 'read alone is worth saying' },
    {
      held: ['READ', 'WRITE'],
      shown: ['WRITE'],
      why: 'READ is on every non-empty set, so it says nothing here',
    },
    {
      held: ['READ', 'DECIDE'],
      shown: ['DECIDE'],
      why: 'deciding without writing is a real person: the one in the aisle',
    },
    {
      held: ['READ', 'WRITE', 'DECIDE'],
      shown: ['WRITE', 'DECIDE'],
      why: 'the only pair ever shown, because neither implies the other',
    },
    {
      held: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
      shown: ['MANAGE'],
      why: 'MANAGE collapses everything, since the server expands it to all four',
    },
  ] as const)('$why', ({ held, shown }) => {
    expect(selectShareSummary([...held])).toEqual([...shown]);
  });

  it('collapses MANAGE even when it arrives without the rest', () => {
    // The server never stores that set, since `normalizeGrant` widens `MANAGE` on the
    // way in. The rule is about what MANAGE means rather than about what came back, so
    // it must not depend on the widening having happened.
    expect(selectShareSummary(['MANAGE'])).toEqual(['MANAGE']);
  });

  it('does not depend on the order the permissions arrive in', () => {
    expect(selectShareSummary(['DECIDE', 'READ', 'WRITE'])).toEqual([
      'WRITE',
      'DECIDE',
    ]);
  });
});
