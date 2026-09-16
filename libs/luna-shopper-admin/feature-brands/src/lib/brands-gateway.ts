import { computed, inject, Injectable, signal } from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import type {
  ResourceGateway,
  ResourceInput,
  ResourcePage,
  ResourceQuery,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { SeededSpelling } from './brand-seed';
import {
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

/** A key the queue carries that no registered brand holds. */
export type BrandSuggestion = Wire.HarvestBrandSuggestionView;

/** How many suggestions one page asks for. */
const SUGGESTION_PAGE_SIZE = 25;

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

  private readonly _brands = this._gateways.for<Brand>(brandSource());
  private readonly _suggestions = this._gateways.for<BrandSuggestion>(
    brandSuggestionSource()
  );
  private readonly _spellings = this._gateways.for<SeededSpelling>(
    brandSpellingsSource()
  );

  /**
   * What the last create linked, until the list has said so once.
   *
   * `shown` is how "once" is expressed. The create navigates back to the list,
   * so the very next `list` is the read that draws the sentence; the one after
   * it is a filter, a sort or a reload, by which time the operator has read it.
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

  update(id: string, input: ResourceInput): Promise<Brand> {
    return this._brands.update(id, input);
  }

  /**
   * There is no delete route (plan 0115, section 9).
   *
   * The descriptor declares no delete action, so no screen offers one and
   * nothing reaches this. It is here because a `ResourceGateway` has five
   * functions, and it delegates rather than throwing so that the one answer
   * comes from the one place.
   */
  remove(id: string): Promise<void> {
    return this._brands.remove(id);
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
   * Register one suggestion, as a brand.
   *
   * The same `POST` the create form sends, which is the point: a suggestion is
   * not a row the server holds, so registering one is creating a brand and
   * nothing else. It answers `linkedItems` the same way, and the panel says so.
   */
  async register(
    label: string,
    privateLabelSupermarketId: string | null
  ): Promise<BrandCreated> {
    const input: ResourceInput = { label };
    if (privateLabelSupermarketId !== null) {
      input['privateLabelSupermarketId'] = privateLabelSupermarketId;
    }

    return this._brands.create(input);
  }

  /** How each chain spells one brand, in the order the route answers. */
  async spellings(brandId: string): Promise<readonly SeededSpelling[]> {
    const page = await this._spellings.list({ filters: { brandId } });
    return page.items;
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
