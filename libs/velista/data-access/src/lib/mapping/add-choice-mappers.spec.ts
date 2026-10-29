import { ADD_CHOICE_MAX } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { toAddChoice } from './add-choice-mappers';

function refusal(details: Record<string, unknown> | undefined): GatewayError {
  return new GatewayError({
    code: 'line_add_needs_choice',
    status: 409,
    correlationId: 'ref',
    details,
  });
}

const ENTRY = {
  lineId: 'line-a',
  content: 'Leche entera',
  named: true,
  quantity: 2,
  itemIds: ['item-a'],
  productGroupId: null,
  approvalStatus: 'APPROVED',
};

/** Velista `0170`, target 7: the refusal maps to the model from `unknown` (rule D4). */
describe('toAddChoice', () => {
  it('reads the lines of a line_add_needs_choice refusal, in their order', () => {
    const choice = toAddChoice(
      refusal({
        lines: [
          ENTRY,
          { ...ENTRY, lineId: 'line-b', named: false, quantity: 0 },
        ],
      })
    );

    expect(choice).toEqual({
      lines: [
        {
          lineId: 'line-a',
          content: 'Leche entera',
          named: true,
          quantity: 2,
          itemIds: ['item-a'],
          productGroupId: null,
          approvalStatus: 'APPROVED',
        },
        expect.objectContaining({
          lineId: 'line-b',
          named: false,
          quantity: 0,
        }),
      ],
    });
  });

  it('is null for any other failure', () => {
    expect(toAddChoice(new Error('offline'))).toBeNull();
    expect(
      toAddChoice(
        new GatewayError({
          code: 'line_merge_required',
          status: 409,
          correlationId: 'ref',
          details: { lines: [ENTRY] },
        })
      )
    ).toBeNull();
  });

  it('drops an entry it cannot draw, and is null when none is left', () => {
    expect(
      toAddChoice(
        refusal({ lines: [ENTRY, { lineId: 'x' }, 'nonsense', null] })
      )?.lines.map((line) => line.lineId)
    ).toEqual(['line-a']);
    expect(toAddChoice(refusal({ lines: [{ lineId: 'x' }] }))).toBeNull();
    expect(toAddChoice(refusal(undefined))).toBeNull();
  });

  it('falls back on fields a newer server sends in a shape this build does not know', () => {
    const choice = toAddChoice(
      refusal({
        lines: [
          {
            ...ENTRY,
            approvalStatus: 'SOMETHING_NEW',
            itemIds: ['item-a', 7],
            productGroupId: 3,
            named: 'yes',
          },
        ],
      })
    );

    expect(choice?.lines[0]).toEqual(
      expect.objectContaining({
        approvalStatus: 'PENDING',
        itemIds: ['item-a'],
        productGroupId: null,
        named: true,
      })
    );
  });

  it('holds a refusal to the cap of ten', () => {
    const lines = Array.from({ length: 12 }, (_, at) => ({
      ...ENTRY,
      lineId: `line-${at}`,
    }));

    expect(toAddChoice(refusal({ lines }))?.lines).toHaveLength(ADD_CHOICE_MAX);
  });
});
