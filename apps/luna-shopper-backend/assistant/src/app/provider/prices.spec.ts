import { TurnMeter } from '../allowance/turn-meter';
import {
  costMicroUsd,
  DEAREST_ROW,
  hasPriceRow,
  PRICE_TABLE,
  priceRowFor,
} from './prices';

/** The price table and the cost formula (plan 0234, section 2.2). */
describe('costMicroUsd', () => {
  it('prices a Haiku turn in whole micro dollars', () => {
    // 2,100 fresh input at $0.10, 4,300 cached at $0.01 and 120 output at
    // $0.50 per million: 210 + 43 + 60 micro dollars.
    expect(
      costMicroUsd('claude-haiku-5-5', {
        promptTokens: 2100,
        responseTokens: 120,
        totalTokens: 2220,
        cachedPromptTokens: 4300,
      })
    ).toBe(313);
  });

  it('rounds up, so a fraction of a micro dollar is a whole one', () => {
    // 1 input token at $0.10 per million is a tenth of a micro dollar.
    expect(
      costMicroUsd('claude-haiku-5-5', {
        promptTokens: 1,
        responseTokens: 0,
        totalTokens: 1,
        cachedPromptTokens: null,
      })
    ).toBe(1);
  });

  it('answers null for a reply with no usage, or with a count unknown', () => {
    expect(costMicroUsd('claude-haiku-5-5', null)).toBeNull();
    expect(
      costMicroUsd('claude-haiku-5-5', {
        promptTokens: null,
        responseTokens: 10,
        totalTokens: null,
        cachedPromptTokens: null,
      })
    ).toBeNull();
  });

  it('prices a model with no row at the dearest row', () => {
    const usage = {
      promptTokens: 1000,
      responseTokens: 1000,
      totalTokens: 2000,
      cachedPromptTokens: 0,
    };
    expect(hasPriceRow('claude-somebody-9')).toBe(false);
    expect(priceRowFor('claude-somebody-9')).toBe(DEAREST_ROW);
    expect(costMicroUsd('claude-somebody-9', usage)).toBe(
      costMicroUsd(DEAREST_ROW.model, usage)
    );
    for (const row of PRICE_TABLE) {
      expect(row.outputMicroUsdPerMTok).toBeLessThanOrEqual(
        DEAREST_ROW.outputMicroUsdPerMTok
      );
    }
  });

  it('holds integers only, each row dated', () => {
    for (const row of PRICE_TABLE) {
      expect(Number.isSafeInteger(row.inputMicroUsdPerMTok)).toBe(true);
      expect(Number.isSafeInteger(row.outputMicroUsdPerMTok)).toBe(true);
      expect(Number.isSafeInteger(row.cacheReadMicroUsdPerMTok)).toBe(true);
      expect(row.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(priceRowFor('claude-haiku-5-5')).toMatchObject({
      inputMicroUsdPerMTok: 100_000,
      outputMicroUsdPerMTok: 500_000,
      cacheReadMicroUsdPerMTok: 10_000,
    });
  });
});

describe('TurnMeter', () => {
  const usage = {
    promptTokens: 2100,
    responseTokens: 120,
    totalTokens: 2220,
    cachedPromptTokens: 4300,
  };

  it('adds each reply at its own model', () => {
    const meter = new TurnMeter();
    meter.add('claude-haiku-5-5', usage);
    meter.add('claude-sonnet-5-5', usage);
    // Haiku 313; Sonnet 4,200 + 860 + 1,200.
    expect(meter.microUsd(20_000)).toBe(313 + 6260);
    expect(meter.tokens()).toEqual({
      promptTokens: 4200,
      responseTokens: 240,
      cachedPromptTokens: 8600,
    });
    expect(meter.billed).toBe(true);
  });

  it('charges the reservation in full when a reply reported no usage', () => {
    const meter = new TurnMeter();
    meter.add('claude-haiku-5-5', usage);
    meter.add('claude-haiku-5-5', null);
    expect(meter.microUsd(20_000)).toBe(20_000);
  });

  it('never caps a known cost at the reservation', () => {
    const meter = new TurnMeter();
    meter.addWorstCase(25_000);
    expect(meter.microUsd(20_000)).toBe(25_000);
  });

  it('counts nothing for a sequence that made no call', () => {
    const meter = new TurnMeter();
    expect(meter.billed).toBe(false);
    expect(meter.microUsd(20_000)).toBe(0);
  });
});
