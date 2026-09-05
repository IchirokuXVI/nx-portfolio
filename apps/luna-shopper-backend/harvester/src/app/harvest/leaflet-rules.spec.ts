import {
  HarvestWarningCode,
  type LeafletOffer,
} from '@portfolio/luna-shopper/contracts';
import pdftext from './__fixtures__/eljamon.pdftext.json';
import vision from './__fixtures__/eljamon.vision.json';
import { aliasKeyFor, decideOffer } from './leaflet-rules';

const textOffers = (pdftext as unknown as { offers: LeafletOffer[] }).offers;
const visionOffers = (vision as unknown as { offers: LeafletOffer[] }).offers;

/** A tile with only what the rule under test needs, and nothing else. */
function offer(patch: Partial<LeafletOffer> = {}): LeafletOffer {
  return {
    id: 'p01-o01',
    page: 1,
    product: { name: 'Cerveza Alhambra Tradicional' },
    pricing: {
      price: { amount: 1.19, currency: 'EUR' },
      basis: 'unit',
    },
    source: 'pdf-text',
    ...patch,
  };
}

/**
 * The three import rules (plan 0081, section 6), over the extractor's real
 * output rather than over invented tiles alone.
 *
 * The fixtures are the two El Jamon extractions: 219 offers from the text layer
 * and 48 read by a model. They are what the plan measured its counts on, and
 * they are the reason each rule exists rather than a hypothesis about leaflets.
 */
describe('the leaflet import rules (plan 0081, section 6)', () => {
  describe('6.1 the basis decides whether there is a till price at all', () => {
    it('writes the advertised price for a unit or pack basis', () => {
      const decision = decideOffer(
        offer({
          pricing: {
            price: { amount: 0.53, currency: 'EUR' },
            basis: 'unit',
            unit_price: { amount: 1.61, currency: 'EUR', per: 'l' },
          },
        })
      );

      expect(decision).toEqual({
        kind: 'write',
        pricing: {
          price: 0.53,
          currency: 'EUR',
          unitPrice: 1.61,
          unitPriceLabel: 'l',
        },
      });
    });

    it('writes no till price for a per kilogram offer, only a unit price', () => {
      // Catalog's `price` means what the till charges for one pack (plan 0038,
      // section 2.4), and a price per kilogram is not that. 93 of the 219
      // offers are in this shape, which is 42% of the leaflet reaching no
      // basket line: a known limitation backlog 0011 records.
      const measured = textOffers.filter((entry) =>
        ['kg', 'l'].includes(entry.pricing.basis)
      );
      expect(measured.length).toBe(93);

      // Minus the handful that also carry a conditional promotion. Section 8
      // states the order (6.3, then 6.2, then 6.1), so on those tiles the
      // single unit price wins and the basis rule never runs: the promotion is
      // the more specific statement about which number a shopper pays.
      const plain = measured.filter(
        (entry) =>
          ![
            'second_unit_discount',
            'multibuy_unit_price',
            'multibuy_total',
            'buy_n_get_free',
          ].includes(entry.promotion?.type ?? '')
      );
      expect(plain).toHaveLength(78);

      for (const entry of plain) {
        const decision = decideOffer(entry);
        expect(decision.kind).toBe('write');
        if (decision.kind !== 'write') {
          continue;
        }
        expect(decision.pricing.price).toBeNull();
        expect(decision.pricing.unitPrice).not.toBeNull();
        expect(['kg', 'l', '100g', '100ml', 'unit']).toContain(
          decision.pricing.unitPriceLabel
        );
      }
    });

    it('falls back to the advertised number when a measured tile prints no comparison line', () => {
      const decision = decideOffer(
        offer({
          pricing: { price: { amount: 8.95, currency: 'EUR' }, basis: 'kg' },
        })
      );

      expect(decision).toEqual({
        kind: 'write',
        pricing: {
          price: null,
          currency: 'EUR',
          unitPrice: 8.95,
          unitPriceLabel: 'kg',
        },
      });
    });

    it('never converts the comparison line, whatever it is per', () => {
      // The label is text and never a unit (plan 0038, section 2.4): a leaflet
      // prints per 100 ml as readily as per litre, and converting one to the
      // other invents a number the chain did not print.
      const decision = decideOffer(
        offer({
          pricing: {
            price: { amount: 2.49, currency: 'EUR' },
            basis: 'unit',
            unit_price: { amount: 0.62, currency: 'EUR', per: '100ml' },
          },
        })
      );

      expect(decision).toMatchObject({
        pricing: { unitPrice: 0.62, unitPriceLabel: '100ml' },
      });
    });
  });

  describe('6.2 a conditional headline price is not what one unit costs', () => {
    it('writes the single unit price for the Radler tile', () => {
      // The tile the rule exists for: its headline number is what the second
      // can costs, and a shopper buying one is charged 0.79.
      const radler = textOffers.find((entry) => entry.id === 'p05-o04');
      expect(radler?.promotion?.type).toBe('second_unit_discount');
      expect(radler?.promotion?.single_unit_price?.amount).toBe(0.79);

      const decision = decideOffer(radler as LeafletOffer);

      expect(decision.kind).toBe('write');
      if (decision.kind !== 'write') {
        return;
      }
      expect(decision.pricing.price).toBe(0.79);
      expect(decision.pricing.price).not.toBe(radler?.pricing.price.amount);
    });

    it('queues a conditional tile that states no single unit price', () => {
      const decision = decideOffer(
        offer({
          promotion: {
            type: 'multibuy_total',
            raw_text: '2 unidades por 1,18',
            required_quantity: 2,
            total_price: { amount: 1.18, currency: 'EUR' },
          },
        })
      );

      expect(decision).toMatchObject({
        kind: 'queue',
        code: HarvestWarningCode.CONDITIONAL_PRICE,
      });
    });

    it('leaves an unconditional promotion alone', () => {
      // `price_drop` is 176 of the 219 offers, and its headline price is what
      // one unit costs today. `n_for_m` and `pack_bonus` are the same shape.
      for (const type of ['price_drop', 'n_for_m', 'pack_bonus'] as const) {
        const decision = decideOffer(
          offer({ promotion: { type, raw_text: 'ANTES 1,49' } })
        );
        expect(decision).toMatchObject({ kind: 'write' });
        if (decision.kind === 'write') {
          expect(decision.pricing.price).toBe(1.19);
        }
      }
    });

    it('routes every conditional tile in the real output one way or the other', () => {
      const conditional = textOffers.filter((entry) =>
        [
          'second_unit_discount',
          'multibuy_unit_price',
          'multibuy_total',
          'buy_n_get_free',
        ].includes(entry.promotion?.type ?? '')
      );
      expect(conditional.length).toBe(33);

      const written = conditional.filter(
        (entry) => decideOffer(entry).kind === 'write'
      );
      const queued = conditional.filter(
        (entry) => decideOffer(entry).kind === 'queue'
      );
      // 27 carry a single unit price and write it; the other 6 have only a
      // number nobody can pay for one unit, so a person decides.
      expect(written).toHaveLength(27);
      expect(queued).toHaveLength(6);
      for (const entry of written) {
        const decision = decideOffer(entry);
        if (decision.kind === 'write') {
          expect(decision.pricing.price).toBe(
            entry.promotion?.single_unit_price?.amount
          );
        }
      }
    });
  });

  describe('6.3 a loyalty gated offer writes nothing at all', () => {
    it('skips it, before any question about which number is the price', () => {
      const gated = visionOffers.filter(
        (entry) => entry.loyalty?.required === true
      );
      // Six of the 48 tiles a model read. The text layer cannot see it at all:
      // the badge is artwork and the word appears nowhere in the text.
      expect(gated).toHaveLength(6);

      for (const entry of gated) {
        expect(decideOffer(entry)).toMatchObject({
          kind: 'skip',
          code: HarvestWarningCode.LOYALTY_REQUIRED,
        });
      }
      expect(
        textOffers.filter((entry) => entry.loyalty?.required === true)
      ).toHaveLength(0);
    });

    it('names the programme in the warning, so the admin sees what was dropped', () => {
      const decision = decideOffer(
        offer({ loyalty: { required: true, program: 'descuentos ifamilia' } })
      );

      expect(decision.kind).toBe('skip');
      if (decision.kind === 'skip') {
        expect(decision.message).toContain('descuentos ifamilia');
      }
    });

    it('wins over the promotion rule, which would otherwise write a number', () => {
      const decision = decideOffer(
        offer({
          loyalty: { required: true, program: null },
          promotion: {
            type: 'second_unit_discount',
            raw_text: '-50% 2a unidad',
            single_unit_price: { amount: 0.79, currency: 'EUR' },
          },
        })
      );

      expect(decision.kind).toBe('skip');
    });
  });

  describe('2.1 the alias key', () => {
    it('is the normalized name and the normalized printed format', () => {
      expect(
        aliasKeyFor(
          offer({
            product: {
              name: 'Cerveza Alhambra Tradicional',
              format: { raw: 'lata 33 cl' },
            },
          })
        )
      ).toBe('cerveza alhambra tradicional|lata 33 cl');
    });

    it('ignores accents and case, which no extractor reproduces the same way', () => {
      const accented = aliasKeyFor(
        offer({ product: { name: 'Jamón Serrano', format: { raw: '100 G.' } } })
      );
      const plain = aliasKeyFor(
        offer({ product: { name: 'jamon serrano', format: { raw: '100 g' } } })
      );
      expect(accented).toBe(plain);
    });

    it('ignores the brand, because one extractor reads it and another does not', () => {
      // Present on 0 of the 219 text layer offers and 43 of the 48 vision ones.
      // A key with brand in it resolves one product two ways.
      const withBrand = aliasKeyFor(
        offer({ product: { name: 'Cerveza Alhambra', brand: 'Alhambra' } })
      );
      const without = aliasKeyFor(
        offer({ product: { name: 'Cerveza Alhambra', brand: null } })
      );
      expect(withBrand).toBe(without);
    });

    it('separates two products whose only difference is the format', () => {
      const small = aliasKeyFor(
        offer({
          product: { name: 'Cerveza Alhambra', format: { raw: '33 cl' } },
        })
      );
      const large = aliasKeyFor(
        offer({ product: { name: 'Cerveza Alhambra', format: { raw: '1 l' } } })
      );
      expect(small).not.toBe(large);
    });

    it('falls back to the name alone when the tile printed no format', () => {
      expect(aliasKeyFor(offer({ product: { name: 'Pan de molde' } }))).toBe(
        'pan de molde|'
      );
    });

    it('collides on almost nothing in the real output', () => {
      // Measured: zero collisions on name plus format in both outputs, against
      // one on name alone. That measurement is why format is in the key.
      const keys = textOffers.map(aliasKeyFor);
      const nameOnly = textOffers.map(
        (entry) => aliasKeyFor(entry).split('|')[0]
      );
      expect(new Set(keys).size).toBeGreaterThan(new Set(nameOnly).size);
    });
  });
});
