import { ADD_CHOICE_MAX } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import {
  toAddChoice,
  toAddUnitRefusal,
  toRefusedLine,
} from './add-choice-mappers';

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
          unit: 'UNIT',
          itemIds: ['item-a'],
          productGroupId: null,
          approvalStatus: 'APPROVED',
          // No outcome from an older backend: an amount is already on the list.
          outcome: 'alreadyOnList',
          resultingQuantity: 2,
        },
        expect.objectContaining({
          lineId: 'line-b',
          named: false,
          quantity: 0,
          // ...and a line at zero is raised by one step of its unit.
          outcome: 'raised',
          resultingQuantity: 1,
        }),
      ],
    });
  });

  it('reads what choosing each line does, as the server says it (the ruling of 2026-11-16)', () => {
    const choice = toAddChoice(
      refusal({
        lines: [
          {
            ...ENTRY,
            lineId: 'line-z',
            quantity: 0,
            unit: 'GRAM',
            outcome: 'RAISED',
            resultingQuantity: 250,
          },
          {
            ...ENTRY,
            lineId: 'line-w',
            quantity: 750,
            unit: 'GRAM',
            outcome: 'ALREADY_ON_LIST',
            resultingQuantity: 750,
          },
          // An outcome this build does not know falls back to the amount.
          { ...ENTRY, lineId: 'line-u', quantity: 0, outcome: 'MERGED' },
        ],
      })
    );

    expect(
      choice?.lines.map(({ lineId, outcome, resultingQuantity }) => ({
        lineId,
        outcome,
        resultingQuantity,
      }))
    ).toEqual([
      { lineId: 'line-z', outcome: 'raised', resultingQuantity: 250 },
      { lineId: 'line-w', outcome: 'alreadyOnList', resultingQuantity: 750 },
      { lineId: 'line-u', outcome: 'raised', resultingQuantity: 1 },
    ]);
  });

  it("holds a raise it works out itself to the ceiling of the line's unit, never under what the line holds (velista 0188, decision K)", () => {
    const choice = toAddChoice(
      refusal({
        lines: [
          // No resultingQuantity: the client works out one step more.
          {
            ...ENTRY,
            lineId: 'line-g',
            quantity: 98_990,
            unit: 'GRAM',
            outcome: 'RAISED',
          },
          {
            ...ENTRY,
            lineId: 'line-h',
            quantity: 150_000,
            unit: 'GRAM',
            outcome: 'RAISED',
          },
          { ...ENTRY, lineId: 'line-c', quantity: 999_999, outcome: 'RAISED' },
          { ...ENTRY, lineId: 'line-d', quantity: 98_990, outcome: 'RAISED' },
        ],
      })
    );

    expect(choice?.lines.map((line) => line.resultingQuantity)).toEqual([
      99_000,
      // A server that already holds more keeps its amount; nothing lowers it.
      150_000, 999_999,
      // A count keeps the backend's 999 999.
      98_991,
    ]);
  });

  it('reads the unit of a line, a count when it is absent or unknown (velista 0182)', () => {
    const choice = toAddChoice(
      refusal({
        lines: [
          { ...ENTRY, unit: 'GRAM' },
          { ...ENTRY, lineId: 'line-b', unit: 'POUND' },
        ],
      })
    );

    expect(choice?.lines.map((line) => line.unit)).toEqual(['GRAM', 'UNIT']);
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

/** Velista `0185`, section 4: the refusal of a product add of another unit. */
describe('toAddUnitRefusal', () => {
  function differs(details?: Record<string, unknown>): GatewayError {
    return new GatewayError({
      code: 'line_unit_differs',
      status: 409,
      correlationId: 'ref',
      details,
    });
  }

  it('reads the line the add met: its id, its own spelling and its unit', () => {
    expect(
      toAddUnitRefusal(
        differs({
          line: {
            lineId: 'line-milk',
            content: 'Leche entera',
            unit: 'MILLILITER',
            quantity: 1500,
          },
          unit: 'UNIT',
          index: null,
        }),
        'Leche'
      )
    ).toEqual({
      lineId: 'line-milk',
      name: 'Leche entera',
      unit: 'MILLILITER',
    });
  });

  it('is still the refusal with no line: the added name and no unit', () => {
    expect(toAddUnitRefusal(differs(undefined), 'Leche')).toEqual({
      lineId: null,
      name: 'Leche',
      unit: null,
    });
    expect(toAddUnitRefusal(differs({ line: 'x' }), 'Leche')).toEqual({
      lineId: null,
      name: 'Leche',
      unit: null,
    });
  });

  it('reads a missing or unknown unit as none, and blank words as the added name', () => {
    expect(
      toAddUnitRefusal(
        differs({ line: { lineId: 'l1', content: '  ', unit: 'LITRE' } }),
        'Leche'
      )
    ).toEqual({ lineId: 'l1', name: 'Leche', unit: null });
    expect(
      toAddUnitRefusal(differs({ line: { lineId: 'l1', content: 'Pan' } }), 'x')
    ).toEqual({ lineId: 'l1', name: 'Pan', unit: null });
  });

  it('is null for any other failure', () => {
    expect(toAddUnitRefusal(new Error('boom'), 'Leche')).toBeNull();
    expect(
      toAddUnitRefusal(
        new GatewayError({
          code: 'line_add_needs_choice',
          status: 409,
          correlationId: 'ref',
        }),
        'Leche'
      )
    ).toBeNull();
  });
});

/** Velista `0185`, decision 51: the line a refusal of another unit names, held by the card. */
describe('toRefusedLine', () => {
  function differs(details?: Record<string, unknown>): GatewayError {
    return new GatewayError({
      code: 'line_unit_differs',
      status: 409,
      correlationId: 'ref',
      details,
    });
  }

  it('reads the whole line the add met, a line at zero included', () => {
    expect(
      toRefusedLine(
        differs({
          line: {
            lineId: 'line-milk',
            content: 'Leche entera',
            unit: 'MILLILITER',
            quantity: 0,
          },
          unit: 'UNIT',
          index: null,
        })
      )
    ).toEqual({
      lineId: 'line-milk',
      content: 'Leche entera',
      unit: 'MILLILITER',
      quantity: 0,
    });
  });

  it('is null for a bag that does not name the line in full', () => {
    expect(toRefusedLine(differs(undefined))).toBeNull();
    expect(
      toRefusedLine(
        differs({ line: { lineId: 'l1', content: 'Pan', unit: 'UNIT' } })
      )
    ).toBeNull();
    expect(
      toRefusedLine(
        differs({
          line: { lineId: 'l1', content: 'Pan', unit: 'LITRE', quantity: 2 },
        })
      )
    ).toBeNull();
    expect(
      toRefusedLine(
        differs({
          line: { lineId: '', content: 'Pan', unit: 'UNIT', quantity: 2 },
        })
      )
    ).toBeNull();
  });

  it('is null for any other failure', () => {
    expect(toRefusedLine(new Error('boom'))).toBeNull();
  });
});
