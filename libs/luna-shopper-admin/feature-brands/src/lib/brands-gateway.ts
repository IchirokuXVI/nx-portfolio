import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  ApiUrl,
  GatewayError,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import type {
  ResourceGateway,
  ResourceInput,
  ResourcePage,
  ResourceQuery,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { brandKey } from '@portfolio/luna-shopper/contracts/brand-key';
import { firstValueFrom } from 'rxjs';
import type { SeededSpelling } from './brand-seed';
import {
  BRAND_REGISTER_MANY_PATH,
  BRAND_REGISTER_SUGGESTION_PATH,
  brandSource,
  brandSpellingsSource,
  brandSuggestionSource,
} from './brand-sources';

/** A registered brand, as the gateway describes it. */
export type Brand = Wire.CatalogBrandView;

/**
 * What a create answers: the brand, plus the products it just picked up.
 *
 * `Wire.CatalogCreateBrandResult` declares `linkedItems` outright, and over HTTP
 * it is always there. It is optional here because the in memory twin's create is
 * a generic insert into a table with no products beside it, so there is nothing
 * for it to have linked and it says nothing rather than inventing a number.
 */
export type BrandCreated = Brand & { readonly linkedItems?: number };

/**
 * What an edit answers: the brand, plus the products the link moved.
 *
 * `Wire.CatalogUpdateBrandResult` declares `movedItems` outright and it is zero
 * whenever the edit left the link alone. Optional here for the reason
 * {@link BrandCreated.linkedItems} is: the in memory twin's update is a generic
 * patch on a table with no products beside it, so it says nothing rather than
 * claiming nothing moved.
 */
export type BrandUpdated = Brand & { readonly movedItems?: number };

/**
 * What registering a suggestion answered (backend plan 0124, section 5).
 *
 * `brand` is the canonical brand, re read after the moves, so its `itemCount`
 * is current. `linked` is the spelling that now points at it, or `null` when
 * the typed name made the suggestion's own key and there was nothing to link.
 */
export type SuggestionRegistered = Wire.CatalogRegisterBrandSuggestionResult;

/** A key the queue carries that no registered brand holds. */
export type BrandSuggestion = Wire.HarvestBrandSuggestionView;

/** One name in a batch register, as the person decided it. */
export interface BrandBatchEntry {
  readonly label: string;
  readonly privateLabelSupermarketId?: string | null;
}

/**
 * What a batch did to one name (backend plan 0160).
 *
 * `CREATED` is a new brand, `EXISTS` is a brand that already held the key the
 * name makes, and `REFUSED` is a name the server would not register.
 */
export type BrandBatchOutcome = 'CREATED' | 'EXISTS' | 'REFUSED';

/**
 * One name's answer, in this app's own words (rule D4).
 *
 * `reasonDetail` is the server's own sentence, shown as it came, because it
 * names the specific thing that was wrong and no key could.
 */
export interface BrandBatchResult {
  readonly label: string;
  readonly outcome: BrandBatchOutcome;
  readonly brandId: string | null;
  readonly linkedItems: number | null;
  readonly reasonCode: string | null;
  readonly reasonDetail: string | null;
}

/** How many suggestions one page asks for. */
const SUGGESTION_PAGE_SIZE = 25;

/**
 * How many spellings of one brand are read at once.
 *
 * One page and no more. A brand holds a handful of spellings, `linkCount` says
 * how many there are, and a block that paged them would be a control nobody
 * presses. A brand past this many is a registry nobody is curating.
 */
const LINKED_PAGE_SIZE = 50;

/**
 * Everything this section reads and writes, in one service (admin plan 0027,
 * section 4).
 *
 * One rather than two, which the plan leaves to whoever builds it: the three
 * reads are the same subject from three angles, and a brand's spellings are not
 * a suggestion's business under any name.
 *
 * `providedIn: 'root'` and singly, for the reason `PostalCodeQueueGateway` is:
 * the sentence a create leaves behind is written by the create and drawn by the
 * **list**, which is a different screen, so the two have to be looking at the
 * same instance.
 *
 * Every read goes through `RESOURCE_GATEWAYS` rather than an `HttpClient` of its
 * own. That is what gives each of them an in memory twin for nothing: the token
 * already chooses between the memory table and the gateway, and the seeds in
 * `brand-seed.ts` are what it answers with when nothing is listening.
 */
@Injectable({ providedIn: 'root' })
export class BrandsGateway implements ResourceGateway<Brand> {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _translator = inject(RokuTranslatorService);

  /**
   * The two halves of a request, which exist only when the app bound them.
   *
   * Optional because this service is provided at the root and both of these are
   * the app layer's: a spec, and a run with nothing listening, resolve neither.
   * Every other read and write goes through `RESOURCE_GATEWAYS` and never sees
   * an `HttpClient` at all; `registerSuggestion` is the one that cannot, because
   * the route it posts to answers neither a row nor a page.
   */
  private readonly _http = inject(HttpClient, { optional: true });
  private readonly _urls = inject(ApiUrl, { optional: true });

  private readonly _brands = this._gateways.for<Brand>(brandSource());
  private readonly _suggestions = this._gateways.for<BrandSuggestion>(
    brandSuggestionSource()
  );
  private readonly _spellings = this._gateways.for<SeededSpelling>(
    brandSpellingsSource()
  );

  /**
   * What the last write did, until the list has said so once.
   *
   * `shown` is how "once" is expressed. A create or an edit navigates back to
   * the list, so the very next `list` is the read that draws the sentence; the
   * one after it is a filter, a sort or a reload, by which time the operator has
   * read it.
   */
  private readonly _created = signal<{
    readonly sentence: string;
    readonly shown: boolean;
  } | null>(null);

  /**
   * The sentence the list has to say right now, if any.
   *
   * **Already translated, unlike every other notice**, and that is deliberate
   * rather than an oversight. `ResourceList` pipes a notice through `rokuT` with
   * no arguments, and this one is the brand's name and a count: there is nowhere
   * to put them. So it is translated here, where the arguments are known, and
   * the pipe passes a string it cannot resolve through unchanged. Nothing else
   * in this app has a notice with arguments; if a second one arrives, the
   * notice channel should learn to carry them instead of this growing a sibling.
   */
  readonly notices = computed<readonly string[]>(() => {
    const created = this._created();
    return created === null ? [] : [created.sentence];
  });

  async list(query: ResourceQuery): Promise<ResourcePage<Brand>> {
    this._ageCreatedNotice();
    return this._brands.list(query);
  }

  read(id: string): Promise<Brand> {
    return this._brands.read(id);
  }

  /**
   * Register a brand, and remember what it picked up.
   *
   * The answer carries `linkedItems`, the number of products already carrying
   * this key that the create has just linked. Zero is ordinary: a brand
   * registered ahead of any product carries nothing yet, and the sentence says
   * so rather than saying nothing.
   */
  async create(input: ResourceInput): Promise<Brand> {
    const created: BrandCreated = await this._brands.create(input);
    this.announce(created);
    return created;
  }

  /**
   * Change a brand, and say what the link moved.
   *
   * An edit that sets or clears `canonicalBrandId` moves every product the link
   * covers, and `movedItems` is how many (backend plan 0124, section 4.2). Zero
   * is the ordinary case, and says nothing; anything else is a fact the operator
   * cannot see anywhere on the list they are about to be sent back to.
   */
  async update(id: string, input: ResourceInput): Promise<Brand> {
    const updated: BrandUpdated = await this._brands.update(id, input);
    this._announceMoved(updated);
    return updated;
  }

  /**
   * Delete a spelling (backend plan 0124).
   *
   * There is no delete for a brand in general, and there never was: a brand
   * with products on it is not a row to remove. `DELETE /brands/{id}` takes
   * only a brand that is a spelling of another one, because only its products
   * have somewhere to go back to, and answers `brand_not_linked` for anything
   * else. The descriptor still declares no delete action, so the list offers
   * none; the control is on the detail screen, where the link that makes it
   * legal is visible.
   */
  remove(id: string): Promise<void> {
    return this._brands.remove(id);
  }

  /**
   * The brands that are spellings of this one, one page (section 2.2).
   *
   * The same list read the registry screen uses, filtered on the column the
   * link is stored in, so there is no second route and no second shape.
   */
  async links(brandId: string): Promise<readonly Brand[]> {
    const page = await this._brands.list({
      limit: LINKED_PAGE_SIZE,
      filters: { canonicalBrandId: brandId },
    });
    return page.items;
  }

  /** Say what a create linked, on the next list this app draws. */
  announce(created: BrandCreated): void {
    const linked = created.linkedItems ?? 0;
    const sentence =
      linked === 0
        ? this._translator.t(
            'brands.registered.createdNone',
            undefined,
            undefined,
            { label: created.label }
          )
        : this._translator.t(
            'brands.registered.created',
            undefined,
            undefined,
            { label: created.label, count: linked }
          );

    this._created.set({ sentence, shown: false });
  }

  /** One page of the keys nothing has registered, most products first. */
  suggestions(
    query: string,
    cursor?: string
  ): Promise<ResourcePage<BrandSuggestion>> {
    return this._suggestions.list({
      cursor,
      limit: SUGGESTION_PAGE_SIZE,
      filters: { query },
    });
  }

  /**
   * Register one suggestion under a name of its own choosing.
   *
   * **One request for one decision** (backend plan 0124, section 5). When the
   * typed name makes the suggestion's own key this is the create the form makes;
   * when it makes a different one, the route creates the brand the name spells,
   * creates the suggestion beside it as a spelling, and links them. A failure
   * between those two would leave the suggestion half registered, which is why
   * the client does not make them separately.
   *
   * There is no source for it, so this is the one write here that reaches the
   * gateway directly. With nothing listening it runs the same three cases
   * against the memory table, because a register panel that did nothing without
   * a backend would be the only screen in this app that needs one.
   */
  async registerSuggestion(
    spelling: string,
    label: string,
    privateLabelSupermarketId: string | null
  ): Promise<SuggestionRegistered> {
    const body: Wire.RegisterBrandSuggestionDto = { spelling, label };
    if (privateLabelSupermarketId !== null) {
      body.privateLabelSupermarketId = privateLabelSupermarketId;
    }

    // The twin writes through `RESOURCE_GATEWAYS`, so it may only ever run
    // against the memory table. Over HTTP it would post two plain creates to
    // the real gateway and link nothing, which is the half registered
    // suggestion this route exists to prevent.
    if (this._gateways instanceof ResourceMemoryGateways) {
      return this._registerInMemory(body);
    }
    const http = this._http;
    const urls = this._urls;
    if (http === null || urls === null) {
      throw new Error(
        'BrandsGateway.registerSuggestion needs HttpClient and ApiUrl when the gateways are not in memory.'
      );
    }

    try {
      return await firstValueFrom(
        http.post<SuggestionRegistered>(
          urls.gateway(BRAND_REGISTER_SUGGESTION_PATH),
          body
        )
      );
    } catch (error) {
      throw toGatewayError(error);
    }
  }

  /**
   * Register many names in one request, one answer per name (admin plan 0035,
   * section 1).
   *
   * **One request, many decisions.** A person chose every name on the list, so
   * each is still a decision; the batch only saves the round trips. The answers
   * come back in the order the names were sent, and a name the server said
   * nothing about is read as refused, because that is the reading that leaves it
   * selected for another try rather than claiming it landed.
   *
   * The same two halves as {@link registerSuggestion}: over HTTP when the app
   * bound it, and against the memory table otherwise.
   */
  async registerMany(
    entries: readonly BrandBatchEntry[]
  ): Promise<readonly BrandBatchResult[]> {
    if (this._gateways instanceof ResourceMemoryGateways) {
      const results: BrandBatchResult[] = [];
      for (const entry of entries) {
        results.push(await this._registerOneInMemory(entry));
      }
      return results;
    }
    const http = this._http;
    const urls = this._urls;
    if (http === null || urls === null) {
      throw new Error(
        'BrandsGateway.registerMany needs HttpClient and ApiUrl when the gateways are not in memory.'
      );
    }

    const body: Wire.RegisterBrandsDto = {
      brands: entries.map((entry) =>
        entry.privateLabelSupermarketId === undefined ||
        entry.privateLabelSupermarketId === null
          ? { label: entry.label }
          : {
              label: entry.label,
              privateLabelSupermarketId: entry.privateLabelSupermarketId,
            }
      ),
    };

    let answer: unknown;
    try {
      answer = await firstValueFrom(
        http.post<unknown>(urls.gateway(BRAND_REGISTER_MANY_PATH), body)
      );
    } catch (error) {
      throw toGatewayError(error);
    }
    return toBrandBatchResults(answer, entries);
  }

  /** How each chain spells one brand, in the order the route answers. */
  async spellings(brandId: string): Promise<readonly SeededSpelling[]> {
    const page = await this._spellings.list({ filters: { brandId } });
    return page.items;
  }

  /** Say what an edit moved, when it moved anything. */
  private _announceMoved(updated: BrandUpdated): void {
    const moved = updated.movedItems ?? 0;
    if (moved === 0) {
      return;
    }

    // The brand the products belong to now, which is the canonical brand on a
    // link and the brand itself on an unlink. One sentence covers both, because
    // "moved to" is the same claim either way.
    const sentence = this._translator.t(
      'brands.registered.moved',
      undefined,
      undefined,
      { count: moved, label: updated.canonicalLabel ?? updated.label }
    );

    this._created.set({ sentence, shown: false });
  }

  /**
   * The three cases of section 5, against the memory table.
   *
   * Written here rather than as a second gateway class, because every row it
   * reads and writes belongs to the brands table that `RESOURCE_GATEWAYS`
   * already holds: it creates brands the way the form does, and the list this
   * screen returns to is the same table.
   *
   * `linkedItems` is 0, and is not a guess dressed up as one. The memory table
   * holds brands and no products, so there is nothing for a register to have
   * linked.
   */
  private async _registerInMemory(
    body: Wire.RegisterBrandSuggestionDto
  ): Promise<SuggestionRegistered> {
    const suggestionKey = brandKey(body.spelling);
    const labelKey = brandKey(body.label);
    if (suggestionKey === null || labelKey === null) {
      throw refusal('brand_label_empty', 400);
    }

    const chainId = body.privateLabelSupermarketId ?? null;

    // The same key: an ordinary create, and nothing to link.
    if (suggestionKey === labelKey) {
      const taken = await this._holderOf(labelKey);
      if (taken !== null) {
        throw refusal('brand_key_taken', 409, taken.id);
      }
      const brand = await this._createBrand(
        body.label,
        labelKey,
        chainId,
        null
      );
      return { brand, linked: null, canonicalCreated: true, linkedItems: 0 };
    }

    // A different key: the brand the name spells, which may already be there,
    // and in that case its chain is the one that counts and this one is ignored.
    const held = await this._holderOf(labelKey);
    const canonical =
      held === null
        ? await this._createBrand(body.label, labelKey, chainId, null)
        : await this._canonicalOf(held);

    const taken = await this._holderOf(suggestionKey);
    if (taken !== null) {
      throw refusal('brand_key_taken', 409, taken.id);
    }

    const linked = await this._createBrand(
      body.spelling,
      suggestionKey,
      // A linked brand owns no chain of its own, whatever was picked.
      null,
      canonical
    );

    const counted = await this._brands.update(canonical.id, {
      linkCount: canonical.linkCount + 1,
    });

    return {
      brand: counted,
      linked,
      canonicalCreated: held === null,
      linkedItems: 0,
    };
  }

  /**
   * One name of a batch, against the memory table, the way the server decides
   * it: a name that makes no key is refused, a key already held exists, and
   * anything else is created.
   */
  private async _registerOneInMemory(
    entry: BrandBatchEntry
  ): Promise<BrandBatchResult> {
    const label = entry.label;
    const key = brandKey(label.trim());
    if (key === null) {
      return {
        label,
        outcome: 'REFUSED',
        brandId: null,
        linkedItems: null,
        reasonCode: 'brand_label_empty',
        reasonDetail: 'The label makes no brand key.',
      };
    }

    const holder = await this._holderOf(key);
    if (holder !== null) {
      return {
        label,
        outcome: 'EXISTS',
        brandId: holder.id,
        linkedItems: null,
        reasonCode: null,
        reasonDetail: null,
      };
    }

    const created = await this._createBrand(
      label.trim(),
      key,
      entry.privateLabelSupermarketId ?? null,
      null
    );
    return {
      label,
      outcome: 'CREATED',
      brandId: created.id,
      linkedItems: 0,
      reasonCode: null,
      reasonDetail: null,
    };
  }

  /** The brand holding a key in the memory table, or nothing. */
  private async _holderOf(key: string): Promise<Brand | null> {
    const page = await this._brands.list({ limit: LINKED_PAGE_SIZE });
    return page.items.find((brand) => brand.key === key) ?? null;
  }

  /** The brand a brand is a spelling of, or the brand itself. */
  private async _canonicalOf(brand: Brand): Promise<Brand> {
    return brand.canonicalBrandId === null
      ? brand
      : this._brands.read(brand.canonicalBrandId);
  }

  /** One brand, as the memory table holds them. */
  private async _createBrand(
    label: string,
    key: string,
    privateLabelSupermarketId: string | null,
    canonical: Brand | null
  ): Promise<Brand> {
    const now = new Date().toISOString();

    return this._brands.create({
      key,
      label,
      privateLabelSupermarketId,
      itemCount: 0,
      canonicalBrandId: canonical?.id ?? null,
      canonicalLabel: canonical?.label ?? null,
      linkCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Move the create notice one read closer to gone.
   *
   * The first list after a create draws it; the next one clears it. Written here
   * rather than on a timer, because "until the operator has looked at the list
   * again" is the honest lifetime of a sentence about what a create did.
   */
  private _ageCreatedNotice(): void {
    const created = this._created();
    if (created === null) {
      return;
    }
    this._created.set(created.shown ? null : { ...created, shown: true });
  }
}

/**
 * A refusal the memory twin raises, shaped the way the gateway's own would be.
 *
 * The screens above switch on `code` and read `details`, so a refusal that came
 * from the table has to carry both or the no backend mode would be a mode where
 * the failures read differently.
 */
function refusal(code: string, status: number, brandId?: string): GatewayError {
  return new GatewayError({
    code,
    status,
    correlationId: '',
    details: brandId === undefined ? {} : { brandId },
  });
}

/**
 * A batch answer, read from `unknown` into this app's own results (rule D4).
 *
 * Matched to the names by position, which is the order the route answers in.
 * An outcome this app does not know, or a missing answer, reads as `REFUSED`:
 * the least dangerous reading, because it keeps the name selected rather than
 * claiming it was registered.
 */
export function toBrandBatchResults(
  answer: unknown,
  sent: readonly BrandBatchEntry[]
): readonly BrandBatchResult[] {
  const results =
    typeof answer === 'object' &&
    answer !== null &&
    Array.isArray((answer as { results?: unknown }).results)
      ? ((answer as { results: unknown[] }).results as unknown[])
      : [];

  return sent.map((entry, index) => {
    const raw = results[index];
    const row =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    const reason =
      typeof row['reason'] === 'object' && row['reason'] !== null
        ? (row['reason'] as Record<string, unknown>)
        : null;
    const outcome = row['outcome'];

    return {
      label: typeof row['label'] === 'string' ? row['label'] : entry.label,
      outcome:
        outcome === 'CREATED' || outcome === 'EXISTS' ? outcome : 'REFUSED',
      brandId: typeof row['brandId'] === 'string' ? row['brandId'] : null,
      linkedItems:
        typeof row['linkedItems'] === 'number' ? row['linkedItems'] : null,
      reasonCode:
        reason !== null && typeof reason['code'] === 'string'
          ? reason['code']
          : null,
      reasonDetail:
        reason !== null && typeof reason['detail'] === 'string'
          ? reason['detail']
          : null,
    };
  });
}
