// The data step of backend plan 0193 (section 4), run on slot 1 on 2026-10-07 as stage c8.
//
// - One El Jamón `STORE_DISCOVERY` recorded the shops of the chain in the city as places.
// - A person's rule paired each El Jamón shop of the catalog with the place it is, and one
//   link for each pair filled what the shop lacked.
// - The bulk act linked each place whose reference is the reference of a shop.
// - Eden was read and not changed.
//
// The folder `stage-c8/` stands in the run folder. The files of this script are `e01` to
// `e04`. A shop and a place are not products or queue rows, so the first three files count
// no natural key of `lib.mjs`.
import { J, itemState, product, startGaps, writeData } from './lib.mjs';

const DONE = 'applied on 2026-10-07 (stage c8)';
const count = (list, key) => {
  const out = {};
  for (const x of list) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
};

/** A shop by its natural keys, from any shape of the stage. */
const shopKey = (chain, s) => ({
  chain,
  address: s.address ?? null,
  city: s.city ?? null,
  postalCode: s.postalCode ?? null,
  postalCodeSource: s.postalCodeSource ?? null,
  provider: s.externalProvider ?? null,
  externalRef: s.externalRef ?? null,
  localId: s.id,
});

export function stageE() {
  const out = [];

  // ---- E1, the run and the 19 links ---------------------------------------------------
  {
    startGaps();
    const request = J('stage-c8/step3.run.request.json');
    const run = J('stage-c8/step3.run.final.json');
    const source = J('stage-c8/step3.source.before.json');
    const pairs = J('stage-c8/step3.pairs.json');
    const links = new Map(
      J('stage-c8/step3.links.json').map((l) => [l.shopId, l])
    );
    const entries = pairs.pairs.map((p) => {
      const l = links.get(p.shopId);
      // What the shop held and the chain prints in another way. The link left each one.
      const kept = {};
      for (const [field, printed] of [
        ['address', p.place.street],
        ['city', p.place.city],
        ['postalCode', p.place.postalCode],
      ])
        if (l.before[field] != null && l.before[field] !== printed)
          kept[field] = {
            theShopHolds: l.before[field],
            theChainPrints: printed,
          };
      return {
        shop: shopKey('El Jamón', l.before),
        place: {
          provider: 'ELJAMON',
          externalRef: p.place.externalRef,
          street: p.place.street,
          city: p.place.city,
          postalCode: p.place.postalCode,
          localId: p.placeId,
        },
        rung: p.gatewayCandidate.rung,
        metres: p.gatewayCandidate.metres,
        elJamonPlacesWithin50m: p.eljamonPlacesWithin50m,
        nextElJamonPlaceMetres: p.secondNearestMetres,
        decision: { action: 'link' },
        filled: l.filled,
        shopAfter: {
          address: l.after.address,
          city: l.after.city,
          postalCode: l.after.postalCode,
          postalCodeSource: l.after.postalCodeSource,
        },
        ...(Object.keys(kept).length ? { keptOnTheShop: kept } : {}),
        status: l.status === 201 && l.linked ? DONE : 'not applied',
      };
    });
    const filled = (f) => entries.filter((e) => e.filled.includes(f)).length;
    out.push(
      writeData(
        'e01-el-jamon-shop-links.json',
        {
          step: 'E1',
          title:
            'Plan 0193, section 4, on 2026-10-07: one El Jamón store discovery, and the place that each El Jamón shop is',
          sources: [
            'stage-c8/step3.source.before.json',
            'stage-c8/step3.run.request.json',
            'stage-c8/step3.run.final.json',
            'stage-c8/step3.pairs.json',
            'stage-c8/step3.links.json',
          ],
          keys: 'A shop is keyed by its chain, its address, its postal code and its OpenStreetMap reference, as it stood before its link. A place of the chain is keyed by its provider and its reference, which the harvester builds from the postal code and the street that the chain prints.',
          decidedBy:
            'The session of stage c8, by the pairing rule below. The owner approved the stage on 2026-10-07. Nobody compared a pair with a map or a shop front.',
          run: {
            route: 'POST /v1/admin/harvest/runs',
            mode: request.mode,
            chain: 'El Jamón',
            postalCodes: request.postalCodes,
            sourceBefore: {
              adapterKey: source.adapterKey,
              enabled: source.enabled,
              autoImportPlaces: source.autoImportPlaces,
            },
            status: run.status,
            requests: run.report.requests,
            recordsRead: run.report.shopsRead,
            recordsKept: run.report.shopsKept,
            recordsDropped: run.report.droppedRecords.map(
              (d) => `${d.name}, ${d.city}: ${d.reason}`
            ),
            placesRecorded: run.report.placesCreated,
            placesImported: run.report.placesImported,
            shopsWritten: run.report.shopsWritten,
            scopesCreated: run.report.scopesCreated,
            warnings: run.report.warnings.length,
            localId: run.id,
          },
          pairingRule: [
            'The place is the `ELJAMON` place nearest to the shop.',
            'The gateway names the shop as the first candidate of the place, with the rung `NEARBY`.',
            'It is the only `ELJAMON` place within 50 m of the shop.',
            'No place is the nearest place of two shops.',
          ],
          route:
            'POST /v1/admin/harvest/places/:id/link with { "supermarketLocationId": "<the shop>" }, one pair at a time, never with `acrossChains`.',
          theLinkFillsOnlyWhatTheShopLacks:
            'A field that the shop held was left, also where the chain prints another value. `keptOnTheShop` holds each such field. An address in another writing is the same address. Two entries differ in substance: the postal code of Doña Berenguela 18, and the street number of Manuel Fuentes Bocanegra.',
          pairsThatMetTheRule: pairs.pairs.filter((p) => p.meetsTheRule).length,
          farthestPairMetres: Math.max(...entries.map((e) => e.metres)),
          nearestOtherElJamonPlaceMetres: Math.min(
            ...entries.map((e) => e.nextElJamonPlaceMetres)
          ),
          shopsThatGot: {
            aPostalCode: filled('POSTAL_CODE'),
            anAddress: filled('ADDRESS'),
            aCity: filled('CITY'),
            allThree: entries.filter((e) => e.filled.length === 3).length,
            anyField: entries.filter((e) => e.filled.length).length,
            nothing: entries.filter((e) => !e.filled.length).length,
          },
        },
        entries
      )
    );
  }

  // ---- E2, the bulk link by reference -------------------------------------------------
  {
    startGaps();
    const dry = J('stage-c8/step4.link-by-ref.dry-1.summary.json');
    const applied = J('stage-c8/step4.link-by-ref.apply.summary.json');
    const again = J(
      'stage-c8/step4.link-by-ref.dry-2-after-apply.summary.json'
    );
    const entries = applied.table.map((t) => ({
      shop: shopKey(t.chain, t.shopNow),
      place: {
        provider: t.provider,
        externalRef: t.externalRef,
        street: t.placeStreet,
        postalCode: t.placePostalCode,
        localId: t.place,
      },
      rung: t.rung,
      decision: { action: 'link-by-ref' },
      filled: t.filled,
      ...(t.filled.includes('FOOTPRINT')
        ? { footprintM2: t.shopNow.footprintM2 }
        : {}),
      status: DONE,
    }));
    out.push(
      writeData(
        'e02-links-by-reference.json',
        {
          step: 'E2',
          title:
            'Plan 0193, section 4, on 2026-10-07: the places whose reference is the reference of a shop',
          sources: [
            'stage-c8/step4.link-by-ref.dry-1.summary.json',
            'stage-c8/step4.link-by-ref.apply.summary.json',
            'stage-c8/step4.link-by-ref.dry-2-after-apply.summary.json',
          ],
          keys: 'A shop is keyed as in e01, as it stood after the 19 links of e01. A place is keyed by its provider and its reference.',
          decidedBy:
            'Nobody chose a pair. The bulk act links a `NEW` place to the one shop that holds the same reference and provider.',
          route:
            'POST /v1/admin/harvest/places/link-by-ref. The body {} answers what it would link and writes nothing. The body { "apply": true } links.',
          order:
            'The bulk act ran after the 19 links of e01. Plan 0193 lists it first. The dry call named no `POSTAL_CODE` on any entry.',
          calls: [
            { body: {}, linked: dry.linked, skipped: dry.skipped },
            {
              body: { apply: true },
              linked: applied.linked,
              skipped: applied.skipped,
            },
            { body: {}, linked: again.linked, skipped: again.skipped },
          ],
          byChain: applied.byChain,
          entriesThatFilledAField: applied.withAFill,
          fieldsFilled: applied.fills,
        },
        entries
      )
    );
  }

  // ---- E3, the places left for the owner ----------------------------------------------
  {
    startGaps();
    const left = J('stage-c8/left-for-the-owner.json');
    const verify = J('stage-c8/verify.json');
    const place = (p) => ({
      provider: p.provider ?? 'ELJAMON',
      externalRef: p.externalRef,
      brand: p.brandName ?? 'El Jamón',
      street: p.street ?? null,
      city: p.city ?? null,
      postalCode: p.postalCode ?? null,
      ...(p.latitude != null
        ? { latitude: p.latitude, longitude: p.longitude }
        : {}),
      localId: p.placeId,
    });
    const LEFT = 'left for the owner';
    const entries = [
      ...left.placesWithACandidate.map((p) => ({
        place: place(p),
        candidates: p.candidates.map((c) => ({
          chain: c.chain,
          address: c.shopAddress,
          postalCode: c.shopPostalCode,
          rung: c.rung,
          metres: c.metres,
          localId: c.shopId,
        })),
        decision: { action: 'none' },
        status: LEFT,
        why:
          p.provider === 'ELJAMON'
            ? 'Another shop of the chain. Its candidate is linked to its own place already. The catalog lacks this shop.'
            : p.candidates[0].metres <= 50
              ? 'Within 50 m of a shop of its chain that no place names. Very likely that shop.'
              : 'Farther than 50 m from its candidate, a shop of its chain that no place names.',
      })),
      ...left.eljamonPlacesWithNoShop.places.map((p) => ({
        place: place(p),
        candidates: [],
        decision: { action: 'none' },
        status: LEFT,
        why: 'A shop of the chain that the catalog lacks. The gateway names no shop as its candidate, on any rung.',
      })),
    ];
    const elJamon = entries.filter((e) => e.place.provider === 'ELJAMON');
    const osmNear = entries.filter((e) => e.place.provider !== 'ELJAMON');
    out.push(
      writeData(
        'e03-places-left-for-the-owner.json',
        {
          step: 'E3',
          title:
            'Plan 0193, section 4, on 2026-10-07: the places that nobody linked, imported or rejected',
          sources: ['stage-c8/left-for-the-owner.json', 'stage-c8/verify.json'],
          keys: 'A place is keyed by its provider and its reference. A candidate shop is keyed by its chain, its address and its postal code. An El Jamón place with no candidate also holds its coordinates, because a new discovery prints the same street and code.',
          decidedBy:
            'Nobody yet. Stage c8 sent nothing for these places. Decision F of plan 0193 is the import of the El Jamón shops.',
          fullRecord:
            'stage-c8/step5.places-new.at-the-end.json holds every `NEW` place as the gateway listed it. The OpenStreetMap places with no candidate are counts here.',
          newPlaces: left.newPlaces,
          withACandidate: left.newPlacesWithACandidate,
          withNoCandidate: left.newPlacesWithNoCandidate,
          elJamonShopsThatTheCatalogLacks: {
            count: elJamon.length,
            withNoCandidate: elJamon.filter((e) => !e.candidates.length).length,
            nearAShopThatIsLinkedToAnotherPlace: elJamon.filter(
              (e) => e.candidates.length
            ).length,
            byPostalCode: Object.fromEntries(
              Object.entries(count(elJamon, (e) => e.place.postalCode)).sort()
            ),
          },
          openStreetMapPlacesNearAShopOfTheirChain: {
            count: osmNear.length,
            within50m: osmNear.filter((e) => e.candidates[0].metres <= 50)
              .length,
            byBrand: count(osmNear, (e) => e.place.brand),
          },
          withNoCandidateByProviderAndBrand: left.noCandidateByProviderAndBrand,
          shopsThatNoPlaceNames: count(
            verify.places.shopsWithNoLinkedPlace,
            (s) => s.chain
          ),
        },
        entries
      )
    );
  }

  // ---- E4, Eden -----------------------------------------------------------------------
  {
    startGaps();
    const eden = J('stage-c8/eden.json');
    // `eden.json` holds the id and the Spanish name. The size and the unit come from the
    // read of every product at the end of the second walk, which is the state they have.
    const items = new Map(
      J('stage-c7/applied/items.after.json').map((i) => [i.id, i])
    );
    const LEFT = 'left for the owner, nothing written';
    const entry = (p, action, why) => ({
      product: product(p.id, itemState(items.get(p.id))),
      categories: items.get(p.id).categories,
      decision: { action },
      status: LEFT,
      why,
    });
    const entries = [
      ...eden.the16.map((p) =>
        entry(
          p,
          'move-to-the-second-brand',
          'Shoe care. The owner said that it is another business than the toilet gel. It waits for the label of the second brand.'
        )
      ),
      ...eden.theOneThatStays.map((p) =>
        entry(
          p,
          'none',
          'The one product that the brand held before the second walk. It stays.'
        )
      ),
    ];
    out.push(
      writeData(
        'e04-eden.json',
        {
          step: 'E4',
          title:
            'Eden, read on 2026-10-07: two brands under one name, and why nothing was written',
          sources: ['stage-c8/eden.json', 'stage-c7/applied/items.after.json'],
          keys: 'Each product is keyed as it stood at the end of the second walk. Stage c8 changed no product.',
          decidedBy:
            'The owner, 2026-10-07: Eden is two brands with the same name. The session of stage c8 then found that the registry cannot hold that, and stopped.',
          done: eden.done,
          brand: {
            label: eden.brand[0].label,
            key: eden.brand[0].key,
            localId: eden.brand[0].id,
          },
          productsUnderTheKey: eden.stateAfter.itemsUnderTheKey,
          homonyms: eden.stateAfter.homonyms.length,
          why: eden.why,
          whatItTakes: eden.whatItTakes,
        },
        entries
      )
    );
  }

  return out;
}
