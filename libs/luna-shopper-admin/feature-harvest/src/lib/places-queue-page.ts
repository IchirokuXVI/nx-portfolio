import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  HARVEST_SERVICE,
  QueueStore,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  CONTENT_LOCALES,
  PLACES_GROUPED_VIEW,
  type InfoContent,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  HarvestNotice,
  InfoButton,
  QueueFrame,
  ReferencePicker,
  type QueueExtraView,
} from '@portfolio/luna-shopper-admin/ui';
import { HarvestShell } from './harvest-shell';
import { HarvestStatus } from './harvest-status';
import { PlaceGroupsView } from './place-groups-view';
import {
  candidateMarkKey,
  candidatesOf,
  filledFieldKeys,
  fromOpenStreetMap,
  nearby,
  nearbyShops,
  pickedShop,
  placeCandidates,
  placeLabel,
  placeLines,
  placeRefusalKey,
  refHolderOf,
  refLinkPreview,
  refusedChainName,
  refusedRefHolder,
  shopWhere,
  type NearbyShop,
  type PickedShop,
  type PlaceCandidate,
  type RefHolder,
  type RefLinkPreview,
} from './place-view';
import { ReviewChain } from './review-chain';

type Place = Wire.HarvestDiscoveredPlaceView;

/** A shop a link is sent to, and what the sentence after it calls the shop. */
interface LinkTarget {
  readonly id: string;
  /** The name of the shop inside a sentence: never blank, never its id. */
  readonly title: string;
  /** Its address line, or `''`. The other chain question draws it. */
  readonly where: string;
}

/** A shop as far as its name is worked out. */
interface NamedShop {
  readonly title: string;
  readonly supermarketId?: string;
}

/** One sentence, as its key and what the key is given. */
interface Sentence {
  readonly key: string;
  readonly args: Readonly<Record<string, string | number>>;
}

/** The languages a chain's name can be given in, which are the catalog's. */
type ChainLocale = Wire.NewChainDto['locale'];

/**
 * How many of a chain's shops the duplicates panel reads.
 *
 * One page. A chain with more shops than this in one city is not a case the
 * panel is for, and the import itself still asks the catalog about every one.
 */
const CATALOG_SHOPS_READ = 100;

/**
 * Discovered places, one decision at a time (plan 0006, section 5; plan 0034).
 *
 * Locations found in OpenStreetMap are **offered rather than silently created**.
 * A place is offered when it matched neither the provider's own reference nor
 * the same brand within fifty metres, which is exactly the case a person has to
 * settle: the two shops fifty one metres apart are either one shop mapped twice
 * or two shops on the same street.
 *
 * So this screen shows why each one is being asked about, and it shows the near
 * duplicates **beside** the current place rather than behind a navigation: the
 * queued places of the same brand, and since plan 0034 the catalog's own shops
 * of the chain, which is where the duplicates backend plan 0150 found were.
 *
 * **A place says which shop it may be** (admin plan 0061, backend plan 0193).
 * The list read carries the candidates of each place, so a line of the column
 * carries a mark and the open place leads with the shops, each with the rule
 * that found it, its distance and "Link to this shop". A shop that is only
 * near is a hint: its sentence says so and its button is the quiet kind.
 *
 * **Any place links to any shop.** "Link to an existing shop" opens a shop
 * picker over one chain, and each shop of the nearby panel has its own button.
 * A place that names another chain than the shop is asked about once, and
 * nothing is sent across chains without that answer. After a link the page
 * says which fields of the shop it filled.
 *
 * **One act links the places that shops were made from.** The control in the
 * header reads what the act would do and shows it. Nothing is linked before
 * the button under that preview is pressed. The server works the list out
 * again on that press, so the preview is dropped as soon as the queue changes,
 * and the notice after it says when what was linked is not what was shown.
 *
 * **One write at a time.** A decision of the queue and the bulk act lock each
 * other while either is in flight ({@link locked}), and a second press on a
 * button whose own request is in flight does nothing.
 *
 * **A reference that another shop holds** (backend plan 0195). An import of
 * such a place is refused, also with `force`: the panel names the shop that
 * holds the reference and offers the link form, and never "Create a new shop
 * anyway". A link goes through with the reference left empty, and its notice
 * says so.
 *
 * **An import can be answered with a question** (backend plan 0152). When the
 * catalog may already hold the shop, the import writes nothing and answers 409
 * `place_matches_location` with the candidates. The panel then lists those,
 * and offers "Create a new shop anyway" beside them. Nothing is linked without
 * a press on a button that names the link.
 *
 * **The scope is the run's, or the one picked.** The run that found a place
 * declared which warehouse or offer region it belongs to, and the import joins
 * that scope when nothing else is named. The panel says which, and a scope of
 * the picked chain can be named instead.
 *
 * **An OpenStreetMap place can bring its chain with it** (backend plan 0153).
 * OpenStreetMap names things in no stated language, so the catalog cannot name a
 * chain from one by itself; the panel asks for a name and the language it is in.
 *
 * Importing takes a supermarket id, and the field is offered rather than
 * required: a place whose chain catalog already knows can be imported without
 * one.
 *
 * **The rows are a column beside the open place, and there is no list of
 * checkboxes** (admin plan 0049). The list view and its bulk import and bulk
 * reject were removed with the list view of the other two queues. "Grouped by
 * chain" stays: it is a view of this queue's own.
 */
@Component({
  selector: 'lib-places-queue-page',
  imports: [
    RokuTranslatorPipe,
    QueueFrame,
    HarvestNotice,
    ReferencePicker,
    InfoButton,
    PlaceGroupsView,
  ],
  template: `
    <!-- A chain with no brand key cannot be told apart in what discovery
         found, so the queue says that it shows every place. -->
    @if (unnarrowed()) {
      <p class="unnarrowed" role="status">
        {{ 'harvest.places.chainHasNoKey' | rokuT }}
      </p>
    }

    <lib-queue-frame
      (confirm)="importPlace()"
      (loadMore)="queue.loadMore()"
      (openRow)="open($event)"
      (reject)="reject()"
      (skip)="skip()"
      [busy]="locked()"
      [canLoadMore]="queue.canLoadMore()"
      [currentId]="queue.current()?.id ?? null"
      [empty]="queue.empty()"
      [errorKey]="errorKey()"
      [extraViews]="extraViews"
      [failed]="queue.failed()"
      [loading]="queue.loading()"
      [loadingMore]="queue.loadingMore()"
      [rows]="queue.items()"
      confirmKey="harvest.places.import"
      emptyKey="harvest.places.empty"
      rejectKey="harvest.places.reject"
      titleKey="harvest.places.heading"
    >
      <!-- The bulk act, always there and costing no request until it is
           pressed (admin plan 0061, decision B). Held and not disabled while
           a write is in flight: a disabled button drops the focus to the
           body, and the press that it ignores sends nothing. -->
      <button
        (click)="previewByRef()"
        [attr.aria-disabled]="locked() ? 'true' : null"
        [attr.aria-expanded]="byRefOpen()"
        class="tool"
        queueTool
        type="button"
        data-tool="by-ref"
      >
        {{ 'harvest.places.byRef.start' | rokuT }}
      </button>

      @if (banner()) {
        <div class="banner" queueBanner>
          @if (notice(); as said) {
            <p class="linked" role="status">
              {{ said.key | rokuT: said.args }}
              @for (more of said.more; track more.key) {
                {{ more.key | rokuT: more.args }}
              }
            </p>
          }

          @if (byRefOpen()) {
            <section
              aria-labelledby="places-byref-heading"
              class="byref"
              role="region"
            >
              <h3 id="places-byref-heading">
                {{ 'harvest.places.byRef.heading' | rokuT }}
              </h3>

              @if (byRefErrorKey(); as key) {
                <p class="refused" role="alert">{{ key | rokuT }}</p>
              }

              @if (byRef(); as preview) {
                @if (preview.linked.length === 0) {
                  <p class="lead">{{ 'harvest.places.byRef.none' | rokuT }}</p>
                } @else {
                  <p class="lead">{{ 'harvest.places.byRef.lead' | rokuT }}</p>
                  <ul class="pairs">
                    @for (line of preview.linked; track line.placeId) {
                      <li>
                        <span class="who">
                          <strong>{{ line.place }}</strong>
                          <span class="muted">{{ line.where }}</span>
                        </span>
                        <span class="who">
                          <span>{{
                            'harvest.places.byRef.to'
                              | rokuT: { shop: shopName({ title: line.shop }) }
                          }}</span>
                          <span class="muted">
                            @if (line.filledKeys.length === 0) {
                              {{ 'harvest.places.byRef.fillsNothing' | rokuT }}
                            } @else {
                              {{
                                'harvest.places.byRef.fills'
                                  | rokuT: { fields: words(line.filledKeys) }
                              }}
                            }
                          </span>
                        </span>
                      </li>
                    }
                  </ul>
                }

                @if (preview.skipped.length > 0) {
                  <h4>{{ 'harvest.places.byRef.skipped' | rokuT }}</h4>
                  <ul class="pairs skipped">
                    @for (line of preview.skipped; track line.placeId) {
                      <li>
                        <span class="who">
                          <strong>{{ line.place }}</strong>
                          <span class="muted">{{ line.where }}</span>
                        </span>
                        <span>{{ line.reasonKey | rokuT }}</span>
                      </li>
                    }
                  </ul>
                }
              } @else if (byRefBusy()) {
                <p class="lead">{{ 'harvest.places.byRef.reading' | rokuT }}</p>
              }

              <div class="controls">
                @if (byRef(); as preview) {
                  @if (preview.linked.length > 0) {
                    <button
                      (click)="applyByRef()"
                      [disabled]="locked()"
                      class="primary"
                      type="button"
                      data-apply
                    >
                      {{
                        (byRefBusy()
                          ? 'resource.action.working'
                          : 'harvest.places.byRef.apply'
                        ) | rokuT: { count: preview.linked.length }
                      }}
                    </button>
                  }
                }
                <button
                  (click)="closeByRef()"
                  [disabled]="byRefBusy()"
                  class="plain"
                  type="button"
                  data-close
                >
                  {{ 'harvest.places.byRef.close' | rokuT }}
                </button>
              </div>
            </section>
          }
        </div>
      }

      <lib-harvest-notice
        (retry)="reload()"
        [absent]="shell.absent()"
        queueFailure
      />

      @if (queue.current(); as place) {
        <!-- What to do with the card, behind an info button beside its name
             (admin plan 0041, section 3). -->
        <div class="named">
          <h2>{{ place.name ?? place.externalRef }}</h2>
          <lib-info-button [info]="info" align="start" />
        </div>

        <dl>
          @for (line of lines(); track line.key) {
            @if (line.value !== '') {
              <div>
                <dt>{{ 'harvest.places.field.' + line.key | rokuT }}</dt>
                <dd>{{ line.value }}</dd>
              </div>
            }
          }
        </dl>

        <!-- A place that names another chain than the shop is asked about
             once, and it stays in front (admin plan 0061, target 6). The
             question names the shop it is about, and "Link anyway" sends
             that shop and no other. -->
        @if (question(); as asked) {
          <div class="ask" role="alert">
            <p>
              <span>
                @if (asked.chain === '') {
                  {{
                    'harvest.places.otherChain.askUnnamed'
                      | rokuT: { shop: asked.shop.title }
                  }}
                } @else {
                  {{
                    'harvest.places.otherChain.ask'
                      | rokuT: { chain: asked.chain, shop: asked.shop.title }
                  }}
                }
              </span>
              @if (asked.shop.where !== '') {
                <span class="where">{{ asked.shop.where }}</span>
              }
            </p>
            <div class="controls">
              <button
                (click)="linkAnyway()"
                [disabled]="locked()"
                class="plain"
                type="button"
                data-link-anyway
              >
                {{ 'harvest.places.otherChain.confirm' | rokuT }}
              </button>
              <button
                (click)="cancelQuestion()"
                [disabled]="locked()"
                class="plain"
                type="button"
                data-cancel-question
              >
                {{ 'resource.action.cancel' | rokuT }}
              </button>
            </div>
          </div>
        }

        <!-- An import that another shop holds the reference of (backend
             plan 0195). No new shop is offered: the place is linked to an
             existing shop, or left. -->
        @if (refTaken(); as taken) {
          <div class="ask" role="alert" data-holder>
            <p>
              {{
                'harvest.places.refTaken.said' | rokuT: { holder: taken.holder }
              }}
            </p>
            <div class="controls">
              <button
                (click)="startLinking()"
                class="plain"
                type="button"
                data-holder-link
              >
                {{ 'harvest.places.link.start' | rokuT }}
              </button>
            </div>
          </div>
        }

        <!-- The shops this place may be, above the chain picker: the link
             is the first thing to read when there is one to make. -->
        @if (candidates(); as found) {
          <section
            [class.hints]="hintsOnly()"
            aria-labelledby="places-match-heading"
            class="matches"
            role="region"
          >
            <h3 id="places-match-heading">
              {{
                (hintsOnly()
                  ? 'harvest.places.match.headingNear'
                  : 'harvest.places.match.heading'
                ) | rokuT
              }}
            </h3>
            <p class="lead">
              {{
                (refused()
                  ? 'harvest.places.match.lead'
                  : hintsOnly()
                    ? 'harvest.places.match.leadNear'
                    : 'harvest.places.match.leadFound'
                ) | rokuT
              }}
            </p>

            <ul>
              @for (candidate of found; track candidate.supermarketLocationId) {
                <li>
                  <div class="who">
                    <strong>{{ shopTitle(candidate) }}</strong>
                    @if (candidate.address !== candidate.title) {
                      <span>{{ candidate.address }}</span>
                    }
                    <span class="muted"
                      >{{ candidate.postalCode }} {{ candidate.city }}</span
                    >
                  </div>
                  <div class="why">
                    <span class="rung">{{
                      'harvest.places.match.rung.' + candidate.rung
                        | rokuT: { metres: candidate.metres ?? 0 }
                    }}</span>
                    @if (!candidate.hint && candidate.metres !== null) {
                      <span class="muted">{{
                        'harvest.places.match.metres'
                          | rokuT: { metres: candidate.metres }
                      }}</span>
                    }
                  </div>
                  <button
                    (click)="link(candidate)"
                    [class.primary]="!candidate.hint"
                    [class.quiet]="candidate.hint"
                    [disabled]="locked()"
                    type="button"
                  >
                    {{ 'harvest.places.match.link' | rokuT }}
                  </button>
                </li>
              }
            </ul>

            @if (refused()) {
              <button
                (click)="forceImport()"
                [disabled]="locked()"
                class="force"
                type="button"
              >
                {{ 'harvest.places.match.force' | rokuT }}
              </button>
            }
          </section>
        }

        <!-- Any shop of a chain, for the place that no rule found one for
             (admin plan 0061, target 4). Nothing is sent before "Link". -->
        <div class="assign linking">
          @if (linking(); as form) {
            <strong>{{ 'harvest.places.link.heading' | rokuT }}</strong>
            <span>{{ 'harvest.places.link.chain' | rokuT }}</span>
            <lib-reference-picker
              (valueChange)="chooseLinkChain($event)"
              [controlId]="'places-link-chain'"
              [empty]="'none'"
              [label]="'harvest.places.link.chain' | rokuT"
              [lookup]="references"
              [resource]="'supermarkets'"
              [value]="linkChain()"
            />
            @if (linkChain() === '') {
              <small>{{ 'harvest.places.link.chainFirst' | rokuT }}</small>
            } @else {
              <span>{{ 'harvest.places.link.shop' | rokuT }}</span>
              <lib-reference-picker
                (valueChange)="pickShop($event)"
                [controlId]="'places-link-shop'"
                [label]="'harvest.places.link.shop' | rokuT"
                [lookup]="references"
                [resource]="'locations'"
                [scope]="linkScope()"
                [value]="form.shop?.id ?? ''"
              />
            }
            @if (form.shop; as shop) {
              <p class="picked">
                <span class="who">
                  <strong>{{ shopTitle(shop) }}</strong>
                  @if (shop.address !== shop.title) {
                    <span>{{ shop.address }}</span>
                  }
                  <span class="muted"
                    >{{ shop.postalCode }} {{ shop.city }}</span
                  >
                </span>
                <button
                  (click)="linkPicked()"
                  [disabled]="locked()"
                  class="primary"
                  type="button"
                  data-link-picked
                >
                  {{ 'harvest.places.link.submit' | rokuT }}
                </button>
              </p>
            }
            <button (click)="cancelLinking()" class="quiet" type="button">
              {{ 'resource.action.cancel' | rokuT }}
            </button>
          } @else {
            <button
              (click)="startLinking()"
              class="quiet"
              type="button"
              data-link-start
            >
              {{ 'harvest.places.link.start' | rokuT }}
            </button>
          }
        </div>

        <div class="assign">
          <span>{{ 'harvest.places.supermarketId' | rokuT }}</span>
          @if (creatingChain()) {
            <div class="new-chain">
              <label>
                <span>{{ 'harvest.places.newChain.name' | rokuT }}</span>
                <input
                  (input)="onChainName($event)"
                  [value]="newChainName()"
                  id="places-new-chain-name"
                  maxlength="200"
                  type="text"
                />
              </label>
              <label>
                <span>{{ 'harvest.places.newChain.locale' | rokuT }}</span>
                <select
                  (change)="onChainLocale($event)"
                  [value]="newChainLocale()"
                  id="places-new-chain-locale"
                >
                  @for (locale of chainLocales; track locale) {
                    <option [value]="locale">
                      {{ 'harvest.places.newChain.language.' + locale | rokuT }}
                    </option>
                  }
                </select>
              </label>
              <p class="hint">{{ 'harvest.places.newChain.hint' | rokuT }}</p>
              <button (click)="cancelNewChain()" class="quiet" type="button">
                {{ 'harvest.places.newChain.cancel' | rokuT }}
              </button>
            </div>
          } @else {
            <lib-reference-picker
              (valueChange)="chooseChain($event)"
              [controlId]="'places-chain'"
              [empty]="'none'"
              [label]="'harvest.places.supermarketId' | rokuT"
              [lookup]="references"
              [resource]="'supermarkets'"
              [value]="supermarketId()"
            />
            @if (offersNewChain()) {
              <button
                (click)="startNewChain(place)"
                class="quiet"
                type="button"
              >
                {{ 'harvest.places.newChain.start' | rokuT }}
              </button>
            }
          }
        </div>

        <div class="assign scope">
          <span>{{ 'harvest.places.scope.heading' | rokuT }}</span>
          <p class="declared">
            @if (place.scopeKey; as key) {
              {{ 'harvest.places.scope.declared' | rokuT: { key: key } }}
            } @else {
              {{ 'harvest.places.scope.none' | rokuT }}
            }
          </p>
          @if (supermarketId() !== '') {
            <lib-reference-picker
              (valueChange)="priceScopeId.set($event)"
              [controlId]="'places-scope'"
              [empty]="'none'"
              [label]="'harvest.places.scope.heading' | rokuT"
              [lookup]="references"
              [resource]="'price-scopes'"
              [scope]="scopeOfChain()"
              [value]="priceScopeId()"
            />
            <small>{{ 'harvest.places.scope.pick' | rokuT }}</small>
          } @else {
            <small>{{ 'harvest.places.scope.chainFirst' | rokuT }}</small>
          }
        </div>
      }

      <section class="near" queueContext>
        <h3>{{ 'harvest.places.near.heading' | rokuT }}</h3>

        @if (near().length === 0) {
          <p class="none">{{ 'harvest.places.near.none' | rokuT }}</p>
        } @else {
          <ul>
            @for (other of near(); track other.id) {
              <li>
                <strong>{{ other.name ?? other.externalRef }}</strong>
                <span>{{ other.street }}</span>
                <span>{{ other.city }}</span>
                <span class="ref">{{ other.externalRef }}</span>
              </li>
            }
          </ul>
        }

        <h3>{{ 'harvest.places.nearCatalog.heading' | rokuT }}</h3>
        @if (catalogOthers().length === 0) {
          <p class="none">
            {{
              (catalogNear().length === 0
                ? 'harvest.places.nearCatalog.none'
                : 'harvest.places.nearCatalog.above'
              ) | rokuT
            }}
          </p>
        } @else {
          <ul class="catalog">
            @for (shop of catalogOthers(); track shop.id) {
              <li>
                <strong>{{ shopTitle(shop) }}</strong>
                @if (shop.address !== shop.title) {
                  <span>{{ shop.address }}</span>
                }
                <span>{{ shop.postalCode }}</span>
                <span class="ref">
                  @if (shop.metres === null) {
                    {{ 'harvest.places.nearCatalog.unplaced' | rokuT }}
                  } @else {
                    {{
                      'harvest.places.nearCatalog.metres'
                        | rokuT: { metres: shop.metres }
                    }}
                  }
                </span>
                <button
                  (click)="link(shop)"
                  [disabled]="locked()"
                  class="quiet"
                  type="button"
                >
                  {{ 'harvest.places.match.link' | rokuT }}
                </button>
              </li>
            }
          </ul>
        }
      </section>

      <!-- One line of the column: the name, the street, the city and the
           provider's own reference. The same facts the open place leads
           with. A place with a candidate says so in words (admin plan
           0061, target 1). -->
      <ng-template #queueLine let-row>
        <strong>{{ row.name ?? row.externalRef }}</strong>
        <span>{{ row.street }}</span>
        <span>{{ row.city }}</span>
        <span class="ref">{{ row.externalRef }}</span>
        @if (markOf(row); as mark) {
          <span [class.hint]="mark.hint" class="mark">{{
            mark.key | rokuT
          }}</span>
        }
      </ng-template>

      <!-- The same places read by chain (admin plan 0034). A view of this
           queue, built when it is first opened and not before. -->
      @if (grouped()) {
        <lib-place-groups queueExtra />
      }
    </lib-queue-frame>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    .unnarrowed {
      margin-block-end: var(--admin-space-3);
      padding: var(--admin-space-2) var(--admin-space-3);
      border-radius: var(--admin-radius-control);
      background: var(--admin-waiting-wash);
      font-size: 0.875rem;
      color: var(--admin-waiting-on-wash);
    }

    h2 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    h3 {
      font-size: 0.875rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .named {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      margin-block-end: var(--admin-space-2);
    }

    dl {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
      margin-block-end: var(--admin-space-3);
    }

    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .assign {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      margin-block-end: var(--admin-space-3);
    }

    .assign > span,
    .new-chain label > span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .assign small,
    .hint,
    .declared {
      color: var(--admin-ink-muted);
    }

    .declared {
      margin: 0;
    }

    .new-chain {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: var(--admin-space-2) var(--admin-space-3);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .new-chain label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .new-chain .hint,
    .new-chain button {
      grid-column: 1 / -1;
    }

    @media (max-width: 40rem) {
      .new-chain {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .quiet {
      align-self: flex-start;
      min-block-size: var(--admin-control);
      border: 1px dashed var(--admin-border);
      background: transparent;
      color: var(--admin-accent);
      cursor: pointer;
    }

    /* The candidates. A shop the catalog already holds is the answer the
       operator is most likely to want, so each one carries its own button and
       the rule that found it, and the new shop is the quieter choice below. */
    .matches {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      margin-block: var(--admin-space-3);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-waiting-on-wash);
      border-radius: var(--admin-radius);
      background: var(--admin-waiting-wash);
    }

    .matches h3,
    .matches .lead {
      margin: 0;
      color: var(--admin-waiting-on-wash);
    }

    /* Only hints: a shop of the chain is near, and nothing says it is this
       one. So the panel does not take the color of a decision that waits. */
    .matches.hints {
      border-color: var(--admin-border);
      background: transparent;
    }

    .matches.hints h3,
    .matches.hints .lead {
      color: var(--admin-ink-muted);
    }

    .matches ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .matches li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, auto) auto;
      gap: var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    @media (max-width: 40rem) {
      .matches li {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .who {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-inline-size: 0;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .why {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      align-items: flex-start;
      font-size: 0.8125rem;
    }

    .rung {
      padding: 0.125rem var(--admin-space-2);
      border: 1px solid var(--admin-border);
      border-radius: 999px;
      font-size: 0.75rem;
      color: var(--admin-ink-muted);
    }

    /* The button that links, wherever it is drawn: a candidate, the picked
       shop and the bulk act. A hint and the nearby panel take the quiet
       button instead, so that a filled button always means a strict match
       or a shop a person named. */
    .primary {
      min-block-size: var(--admin-control);
      border: 1px solid var(--admin-accent);
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
      cursor: pointer;
    }

    .plain,
    .tool {
      min-block-size: var(--admin-control);
      border: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
      cursor: pointer;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
    }

    /* The mark on a line of the column. Words, with a wash behind them and
       an edge, so it does not depend on the color. */
    .mark {
      padding: 0.0625rem var(--admin-space-2);
      border: 1px solid var(--admin-waiting-on-wash);
      border-radius: var(--admin-radius-control);
      background: var(--admin-waiting-wash);
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-waiting-on-wash);
    }

    .mark.hint {
      border-color: var(--admin-border);
      background: var(--admin-surface-raised);
      font-weight: 400;
      color: var(--admin-ink-muted);
    }

    /* What a tool of the header answered. */
    .banner {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
    }

    .linked {
      margin: 0;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius-control);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .byref {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .byref .lead {
      margin: 0;
    }

    h4 {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    .pairs {
      display: flex;
      flex-direction: column;
      max-block-size: 22rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      list-style: none;
    }

    .pairs li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--admin-space-3);
      padding: var(--admin-space-2) var(--admin-space-3);
    }

    .pairs li + li {
      border-block-start: 1px solid var(--admin-border);
    }

    @media (max-width: 40rem) {
      .pairs li {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--admin-space-1);
      }
    }

    .refused {
      margin: 0;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    /* The other chain question: one line and its two answers. */
    .ask {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
      margin-block-end: var(--admin-space-3);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-waiting-on-wash);
      border-radius: var(--admin-radius);
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    .ask p {
      display: flex;
      flex: 1 1 16rem;
      flex-direction: column;
      gap: 0.125rem;
      margin: 0;
    }

    /* The address line of the shop that the question is about. */
    .ask .where {
      font-size: 0.875rem;
    }

    /* The shop a person picked, and the button that links to it. */
    .picked {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
      margin: 0;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .near .quiet {
      margin-inline-start: auto;
    }

    .matches .force {
      align-self: flex-start;
      min-block-size: var(--admin-control);
      background: var(--admin-surface-raised);
      cursor: pointer;
    }

    button:active:not(:disabled) {
      transform: translateY(1px);
    }

    button:disabled,
    button[aria-disabled='true'] {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .near {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .near ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .near li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      padding: var(--admin-space-3);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .near .catalog li {
      border-style: solid;
    }

    .none,
    .ref {
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlacesQueuePage {
  /** What the info button on the card says (admin plan 0041, section 3). */
  readonly info: InfoContent = {
    title: 'harvest.places.info.title',
    points: ['harvest.places.info.found', 'harvest.places.info.decide'],
  };

  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _route = inject(ActivatedRoute);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _content = inject(ContentLocaleStore);

  readonly shell = inject(HarvestShell);
  readonly references = inject(ResourceReferences);

  private readonly _review = inject(ReviewChain);
  private readonly _status = inject(HarvestStatus);
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);

  readonly chainLocales = CONTENT_LOCALES as readonly ChainLocale[];

  /** "Grouped by chain" is a view of this queue (admin plan 0044, target 4). */
  readonly extraViews: readonly QueueExtraView[] = [
    { id: PLACES_GROUPED_VIEW, labelKey: 'harvest.places.groups.view' },
  ];

  private readonly _frame = viewChild(QueueFrame);

  /** Whether the grouped view is on screen, which is when it is built. */
  readonly grouped = computed(
    () => this._frame()?.extra()?.id === PLACES_GROUPED_VIEW
  );

  /**
   * The brand key the queue is narrowed to, which is the chosen chain's own.
   *
   * A discovered place names a brand and never a chain, so the shared chain
   * filter narrows this queue through the key the chain is known by. `''`
   * with no chain chosen.
   */
  private readonly _brandKey = signal('');

  /**
   * Whether a chain is chosen and the queue could not be narrowed to it,
   * because that chain has no brand key. The queue then shows every place and
   * says so.
   */
  readonly unnarrowed = signal(false);

  /** Bumped on every chain change, so that a slow answer for an old one is dropped. */
  private _narrowing = 0;

  /**
   * The chain the picker holds, or `''`.
   *
   * Reset after every decision that went through: a visible
   * leftover choice quietly filing the next place under the previous chain is
   * the mistake the reset prevents, and the picker makes re-choosing cheap. It
   * survives a refusal, so "Create a new shop anyway" sends what was asked.
   */
  readonly supermarketId = signal('');

  /**
   * A scope of the picked chain to import under instead of the declared one,
   * or `''` for the declared one (backend plan 0152, section 1).
   */
  readonly priceScopeId = signal('');

  /** Whether the chain is being named here rather than picked (plan 0153). */
  readonly creatingChain = signal(false);
  readonly newChainName = signal('');
  readonly newChainLocale = signal<ChainLocale>('es');

  /**
   * The postal code this queue was opened on, from the URL, or `''`.
   *
   * The postal code detail page links here filtered to one code (admin plan
   * 0021, section 5), which backend plan 0097 section 9 added the filter for.
   * Read once from the snapshot rather than watched: nothing on this screen
   * changes it, and arriving with a different one is a fresh navigation.
   */
  readonly postalCode =
    this._route.snapshot.queryParamMap.get('postalCode') ?? '';
  private readonly _country =
    this._route.snapshot.queryParamMap.get('country') ?? '';

  /**
   * The queue, behind a signal and read through a getter (admin plan 0044).
   *
   * The shared chain filter builds a **new** store, and a computed that had
   * read the old one's signals would never hear about it.
   */
  private readonly _queue = signal(this._build());

  get queue(): QueueStore<Place> {
    return this._queue();
  }

  private _build(): QueueStore<Place> {
    const brandKey = this._brandKey();

    return new QueueStore<Place>(
      async (cursor) => {
        try {
          // Only the undecided ones. An imported or rejected place is not a
          // question any more, and a queue that offered it again would be
          // asking an operator to answer their own earlier answer.
          const page = await this._service.listPlaces({
            status: 'NEW',
            cursor,
            country: this._country === '' ? undefined : this._country,
            postalCode: this.postalCode === '' ? undefined : this.postalCode,
            brandKey: brandKey === '' ? undefined : brandKey,
          });
          this.shell.observeReachable();
          return page;
        } catch (error) {
          this.shell.observeFailure();
          throw error;
        }
      },
      (place) => place.id
    );
  }

  /**
   * The candidates the last import of a place answered with, by place.
   *
   * Keyed on the place so a skip does not carry them onto the next one: they
   * are an answer about one place, and drawn under another they would offer to
   * link the wrong shop.
   */
  private readonly _matches = signal<{
    readonly placeId: string;
    readonly candidates: readonly PlaceCandidate[];
  } | null>(null);

  /**
   * Whether the last import of the place in front was refused with
   * candidates. The panel then lists those and offers "Create a new shop
   * anyway", which is the other answer to that refusal and to nothing else.
   */
  readonly refused = computed(() => {
    const matches = this._matches();
    const place = this.queue.current();
    return matches !== null && place !== null && matches.placeId === place.id;
  });

  /**
   * The candidates for the place in front, or null when there are none.
   *
   * The ones a refused import named, when there was one: that answer is newer
   * than the list read. Otherwise the ones the list read carried (admin plan
   * 0061, target 2).
   */
  readonly candidates = computed<readonly PlaceCandidate[] | null>(() => {
    const place = this.queue.current();
    if (place === null) {
      return null;
    }
    const matches = this._matches();
    if (matches !== null && matches.placeId === place.id) {
      return matches.candidates;
    }
    const listed = candidatesOf(place.candidates, this._content.order());
    return listed.length === 0 ? null : listed;
  });

  /**
   * Whether every candidate in front is a hint. The panel then says that a
   * shop of the chain is near, and not that the catalog may hold this shop.
   */
  readonly hintsOnly = computed(
    () =>
      !this.refused() &&
      (this.candidates() ?? []).every((candidate) => candidate.hint)
  );

  /**
   * The link form of one place: the chain its shop picker is over, and the
   * shop that was picked. Keyed on the place, like the candidates, so that a
   * picked shop is never drawn under another place.
   *
   * `chain` is null until a person names one in the form. Until then the
   * picker is over the chain the chain picker holds, or the chain of the
   * first candidate.
   */
  private readonly _linking = signal<{
    readonly placeId: string;
    readonly chain: string | null;
    readonly shop: PickedShop | null;
  } | null>(null);

  /** The link form of the place in front, or null while it is closed. */
  readonly linking = computed(() => {
    const form = this._linking();
    return form !== null && form.placeId === this.queue.current()?.id
      ? form
      : null;
  });

  /** The chain the shop picker is over, or `''` when one must be named. */
  readonly linkChain = computed(() => {
    const named = this.linking()?.chain ?? null;
    if (named !== null) {
      return named;
    }
    return (
      this.supermarketId() || (this.candidates()?.[0]?.supermarketId ?? '')
    );
  });

  /** What the shop picker reads: the shops of that chain, and no other's. */
  readonly linkScope = computed(() => ({ supermarketId: this.linkChain() }));

  /**
   * The question a link was answered with: the place names another chain
   * than the shop (backend plan 0193, target 4). Keyed on the place.
   *
   * **It is a question about one shop, and it holds that shop.** "Link
   * anyway" sends the shop of the question and nothing that is on screen
   * beside it. So the question goes as soon as what is on screen is another
   * shop: a shop or a chain picked in the link form, that form opened or
   * cancelled, a skip, and the start of any other link. A question left
   * standing over a newly picked shop sent the old shop across chains.
   */
  private readonly _question = signal<{
    readonly placeId: string;
    readonly shop: LinkTarget;
    readonly chain: string;
  } | null>(null);

  readonly question = computed(() => {
    const asked = this._question();
    return asked !== null && asked.placeId === this.queue.current()?.id
      ? asked
      : null;
  });

  /**
   * The refusal that a panel of this page already answers, or that the
   * operator dismissed. It draws no sentence above the queue as well.
   */
  private readonly _handled = signal<GatewayError | null>(null);

  /**
   * What the last link or the bulk act did, and the place it is drawn over.
   *
   * A link takes its place out of the queue, so the sentence is read over
   * the next one. It names the place it is about, and it goes when another
   * place comes up.
   */
  private readonly _notice = signal<{
    readonly over: string | null;
    readonly key: string;
    readonly args: Readonly<Record<string, string | number>>;
    /** Sentences after the first: what the answer did not do as expected. */
    readonly more: readonly Sentence[];
  } | null>(null);

  readonly notice = computed(() => {
    const said = this._notice();
    return said !== null && said.over === (this.queue.current()?.id ?? null)
      ? said
      : null;
  });

  /**
   * The shop that holds the reference of a place whose import was refused
   * for it (backend plan 0195), or null in `holder` when the refusal named
   * none. Keyed on the place.
   */
  private readonly _refTaken = signal<{
    readonly placeId: string;
    readonly holder: RefHolder | null;
  } | null>(null);

  /** The refused import of the place in front, with its holder in words. */
  readonly refTaken = computed(() => {
    const taken = this._refTaken();
    return taken !== null && taken.placeId === this.queue.current()?.id
      ? { holder: this._holderName(taken.holder) }
      : null;
  });

  /**
   * The names of chains, by id, as far as this page asked for them. Asked
   * for only for a candidate that has no label and no address, which is then
   * called "a shop of Deza with no address" and not by its id.
   */
  private readonly _chainNames = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _chainsAsked = new Set<string>();

  /** Whether the preview of the bulk act is on screen. */
  readonly byRefOpen = signal(false);
  /** What the bulk act would do, as its dry answer said, or null before it. */
  readonly byRef = signal<RefLinkPreview | null>(null);
  /** A read or a write of the bulk act is in flight. */
  readonly byRefBusy = signal(false);
  readonly byRefErrorKey = signal<string | null>(null);
  /** Bumped when a preview is dropped, so that a slow read is not shown. */
  private _byRefTurn = 0;

  /**
   * A write of this page is in flight: a decision of the queue, or a read or
   * a write of the bulk act.
   *
   * One lock for both. The bulk act links places of the queue, so a link
   * sent while it runs is a link of a place that the act may be linking,
   * and an apply sent while a link is in flight reads a queue that is about
   * to change.
   */
  readonly locked = computed(() => this.queue.busy() || this.byRefBusy());

  /** Whether anything is drawn under the header of the queue. */
  readonly banner = computed(() => this.notice() !== null || this.byRefOpen());

  /**
   * The sentence above the queue.
   *
   * A `place_matches_location` refusal draws the candidates instead, so it
   * has no sentence of its own here: the panel is the answer. The places
   * queue's own refusals are named; anything else is the generic sentence.
   */
  readonly errorKey = computed(() => {
    const error = this.queue.error();
    if (error?.code === 'place_matches_location' && this.refused()) {
      return null;
    }
    // The other chain question is the answer to its refusal, and a question
    // that was cancelled leaves nothing to say.
    if (error !== null && error === this._handled()) {
      return null;
    }
    if (this._needsChain()) {
      return 'harvest.places.error.needsChain';
    }
    return placeRefusalKey(error) ?? gatewayErrorKey(error);
  });

  /** An import was refused because the place cannot name its own chain. */
  private readonly _needsChain = signal(false);

  readonly lines = computed(() => {
    const place = this.queue.current();
    return place === null ? [] : placeLines(place);
  });

  /**
   * The places this one might be a duplicate of.
   *
   * Same brand key and within a short distance, which is the rule that decided
   * to ask in the first place, applied to what is still in the queue. Grouping
   * is on `brand:wikidata` and never on the name, because `Dia` and `Maxi Dia`
   * share one QID while name matching would split exactly the pair somebody
   * needs to see together.
   */
  readonly near = computed(() => {
    const place = this.queue.current();
    return place === null ? [] : nearby(place, this.queue.upcoming());
  });

  /**
   * The catalog's own shops of the place's chain near it (admin plan 0034,
   * section 1).
   *
   * The chain is the picked one, or the one whose Wikidata key the place
   * carries. A place with neither has no chain to read shops of, and the panel
   * says there is nothing near rather than guessing.
   */
  readonly catalogNear = signal<readonly NearbyShop[]>([]);

  /**
   * The nearby shops that are not candidates above, so that no shop is
   * listed twice (admin plan 0061, target 5).
   */
  readonly catalogOthers = computed(() => {
    const above = new Set(
      (this.candidates() ?? []).map(
        (candidate) => candidate.supermarketLocationId
      )
    );
    return this.catalogNear().filter((shop) => !above.has(shop.id));
  });
  /** Which read is the latest, so a slow earlier answer cannot overwrite it. */
  private _nearRead = 0;
  /** Chains by Wikidata key, as far as this screen has asked. */
  private readonly _chainsByKey = new Map<string, string | null>();

  /** Offered for an OpenStreetMap place only, which is the one that needs it. */
  readonly offersNewChain = computed(() => {
    const place = this.queue.current();
    return place !== null && fromOpenStreetMap(place);
  });

  /** What the scope picker reads: the picked chain's scopes, and no other's. */
  readonly scopeOfChain = computed(() => ({
    supermarketId: this.supermarketId(),
  }));

  constructor() {
    // The chain the four queues share. Each change builds the queue again,
    // and the first read is this effect's first run.
    effect(() => {
      const chain = this._review.chain();
      untracked(() => void this._narrow(chain));
    });

    effect(() => {
      const place = this.queue.current();
      // The chain a person named, in the chain picker or in the link form.
      // The nearby panel then lists the shops of that chain, each with its
      // own link button.
      const chain = this.supermarketId() || (this.linking()?.chain ?? '');
      void this._readCatalogNear(place, chain);
    });

    // The chain of a candidate that has nothing else to be called by.
    effect(() => {
      const chains = (this.candidates() ?? [])
        .filter(
          (candidate) =>
            candidate.title === '' && candidate.supermarketId !== ''
        )
        .map((candidate) => candidate.supermarketId);
      untracked(() => {
        for (const chain of chains) {
          void this._readChainName(chain);
        }
      });
    });
  }

  /**
   * A different chain means a different set of scopes to pick from. It is
   * also the chain of the link form until a person names one there, so the
   * other chain question goes with it.
   */
  chooseChain(supermarketId: string): void {
    this.supermarketId.set(supermarketId);
    this.priceScopeId.set('');
    this._question.set(null);
  }

  /**
   * Import the place in front.
   *
   * Refused with `place_matches_location`, the place stays in front and the
   * candidates come up under it. Refused because an OpenStreetMap place cannot
   * name its own chain, the chain form opens with the place's brand in it.
   */
  async importPlace(force = false): Promise<void> {
    const queue = this.queue;
    const place = queue.current();
    // A second press while a write is in flight sends nothing. It must not
    // read the answer either: the queue holds no refusal yet, and that would
    // read as an import that went through.
    if (place === null || this.locked()) {
      return;
    }

    this._refTaken.set(null);
    const body = this._importBody(force);
    await queue.decide((row) => this._service.importPlace(row.id, body));
    this._settle(place, body);
  }

  /** "Create a new shop anyway", which is the same import with `force`. */
  forceImport(): Promise<void> {
    return this.importPlace(true);
  }

  /**
   * Bind the place to a shop the catalog already holds (backend plan 0152,
   * section 3). The one call that writes nothing new to the catalog.
   *
   * Called by the button of a candidate and by the button of a shop of the
   * nearby panel. Both name the shop they link to.
   */
  link(shop: PlaceCandidate | NearbyShop): Promise<void> {
    return this._link(
      this._target(
        'supermarketLocationId' in shop ? shop.supermarketLocationId : shop.id,
        shop
      )
    );
  }

  /**
   * "Link", under the shop that was picked in the link form. A link that went
   * through closed the form, so the focus goes to the button that opens it.
   */
  async linkPicked(): Promise<void> {
    const shop = this.linking()?.shop ?? null;
    if (shop === null) {
      return;
    }
    await this._link(this._target(shop.id, shop));
    if (this.linking() === null) {
      this._focus('[data-link-start]');
    }
  }

  /**
   * "Link anyway": the shop that the question names, across chains.
   *
   * The shop comes from the question and from nowhere else, and the question
   * says its name. What the link form or the panels hold by now is not read.
   */
  linkAnyway(): Promise<void> {
    const asked = this.question();
    return asked === null ? Promise.resolve() : this._link(asked.shop, true);
  }

  /** A shop as the target of a link, with the words that name it. */
  private _target(
    id: string,
    shop: NamedShop & {
      readonly address: string;
      readonly city: string;
      readonly postalCode: string;
    }
  ): LinkTarget {
    return { id, title: this.shopName(shop), where: shopWhere(shop) };
  }

  /**
   * What a row calls a shop: its label, or its address, or "Shop with no
   * address", with its chain when the page knows it. Never its id.
   */
  shopTitle(shop: NamedShop): string {
    return this._named(shop, 'untitled');
  }

  /** The same, as it reads inside a sentence: "a shop with no address". */
  shopName(shop: NamedShop): string {
    return this._named(shop, 'unnamed');
  }

  private _named(shop: NamedShop, form: 'untitled' | 'unnamed'): string {
    if (shop.title !== '') {
      return shop.title;
    }
    const chain = this._chainNames().get(shop.supermarketId ?? '') ?? '';
    return chain === ''
      ? this._say(`harvest.places.shop.${form}`)
      : this._say(`harvest.places.shop.${form}Of`, { chain });
  }

  /**
   * The shop that holds a reference, in words: its label or its address, then
   * its chain and its city. A holder with neither reads "a shop with no
   * address", and a holder that the answer could not name reads "another
   * shop".
   */
  private _holderName(holder: RefHolder | null): string {
    if (holder === null) {
      return this._say('harvest.places.holder.unknown');
    }
    const shop =
      holder.shop !== ''
        ? holder.shop
        : this._say('harvest.places.shop.unnamed');
    const where = [holder.chain, holder.city]
      .filter((part) => part.trim() !== '')
      .join(', ');
    return where === ''
      ? shop
      : this._say('harvest.places.holder.named', { shop, where });
  }

  private _say(
    key: string,
    args?: Readonly<Record<string, string | number>>
  ): string {
    return this._translate.t(key, undefined, undefined, args);
  }

  private async _readChainName(id: string): Promise<void> {
    if (this._chainsAsked.has(id)) {
      return;
    }
    this._chainsAsked.add(id);
    try {
      const name = (await this.references.resolve('supermarkets', id))?.title;
      if (name !== undefined && name !== '') {
        this._chainNames.update((names) => new Map(names).set(id, name));
      }
    } catch {
      // The shop is then called a shop with no address, with no chain.
    }
  }

  /** Move the focus once the next render drew what it goes to. */
  private _focus(selector: string): void {
    afterNextRender(
      () => {
        this._host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this._injector }
    );
  }

  /** "Cancel" under the other chain question. Nothing was sent across. */
  cancelQuestion(): void {
    this._question.set(null);
  }

  /**
   * Open the link form of the place in front.
   *
   * With no chain in the chain picker and no candidate, the form opens on the
   * chain whose brand key the place carries, when the catalog holds one. A
   * place of a chain with no shop near it thus needs no chain picked. A
   * person can still name another chain in the form.
   */
  startLinking(): void {
    const place = this.queue.current();
    if (place === null) {
      return;
    }
    this._linking.set({ placeId: place.id, chain: null, shop: null });
    // A form that opens is a new link, and it holds no shop yet.
    this._question.set(null);
    // The focus goes into the form: to the shop picker when the chain is
    // known, and to the chain picker when it must be named first.
    this._focus(
      this.linkChain() === '' ? '#places-link-chain' : '#places-link-shop'
    );
    if (this.linkChain() !== '') {
      return;
    }

    void this._chainOf(place).then((chain) => {
      const form = this.linking();
      // Only while the form is still this place's, and still asks.
      const asks =
        form !== null &&
        form.placeId === place.id &&
        form.chain === null &&
        this.linkChain() === '';
      if (chain !== null && form !== null && asks) {
        this._linking.set({ ...form, chain });
      }
    });
  }

  /** Close the link form, and give the focus back to what opened it. */
  cancelLinking(): void {
    this._linking.set(null);
    this._question.set(null);
    this._focus('[data-link-start]');
  }

  /**
   * Another chain means another set of shops, so the picked shop goes, and
   * the question about it.
   */
  chooseLinkChain(supermarketId: string): void {
    const form = this.linking();
    this._question.set(null);
    if (form !== null) {
      this._linking.set({ ...form, chain: supermarketId, shop: null });
    }
  }

  /**
   * A shop was picked. It is drawn with its address above "Link", and
   * nothing is sent (admin plan 0061, target 4).
   */
  async pickShop(supermarketLocationId: string): Promise<void> {
    const form = this.linking();
    if (form === null) {
      return;
    }
    // Another shop is on screen now, so a question about the last one goes.
    this._question.set(null);
    if (supermarketLocationId === '') {
      this._linking.set({ ...form, shop: null });
      return;
    }

    const chain = this.linkChain();
    const option = await this.references.resolve(
      'locations',
      supermarketLocationId
    );
    // The lookup took a moment. The answer belongs to the form it was asked
    // from: the same place, and the same chain.
    const now = this.linking();
    if (now === null || now.placeId !== form.placeId) {
      return;
    }
    if (this.linkChain() !== chain) {
      return;
    }
    this._linking.set({
      ...now,
      shop: pickedShop(option?.row, this._content.order()) ?? {
        id: supermarketLocationId,
        title: option?.title ?? '',
        address: '',
        city: '',
        postalCode: '',
      },
    });
  }

  /**
   * Send one link, and read what it answered.
   *
   * Linked, the queue moves on and the page says what the link filled. Asked
   * about the chain, the place stays in front under the question. Refused any
   * other way, the place stays in front under the sentence of the refusal.
   */
  private async _link(shop: LinkTarget, acrossChains = false): Promise<void> {
    const queue = this.queue;
    const place = queue.current();
    if (place === null || this.locked()) {
      return;
    }

    // A link is a new question. Only "Link anyway" keeps the one it answers.
    if (!acrossChains) {
      this._question.set(null);
    }
    this._refTaken.set(null);

    const answers: Wire.HarvestPlaceLinkResult[] = [];
    await queue.decide(async (row) => {
      answers.push(
        await this._service.linkPlace(row.id, {
          supermarketLocationId: shop.id,
          // Sent only when it was asked for, so that a plain link is the
          // request it always was.
          ...(acrossChains ? { acrossChains: true } : {}),
        })
      );
    });

    const answer = answers[0];
    if (answer !== undefined) {
      this._decided();
      const fields = filledFieldKeys(answer.filled);
      this._notice.set({
        over: this.queue.current()?.id ?? null,
        key:
          fields.length === 0
            ? 'harvest.places.linked.nothing'
            : 'harvest.places.linked.filled',
        args: {
          place: placeLabel(place),
          shop: shop.title,
          fields: this.words(fields),
        },
        // Present only when the reference was left empty because another
        // shop holds it (backend plan 0195). Null is a holder that is gone.
        more:
          answer.refHeldBy === undefined
            ? []
            : [
                {
                  key: 'harvest.places.linked.refHeld',
                  args: {
                    holder: this._holderName(
                      refHolderOf(answer.refHeldBy, this._content.order())
                    ),
                  },
                },
              ],
      });
      return;
    }

    const error = queue.error();
    if (error?.code === 'place_names_another_chain' && !acrossChains) {
      this._handled.set(error);
      this._question.set({
        placeId: place.id,
        shop,
        chain: refusedChainName(error.details, this._content.order()),
      });
      return;
    }

    // Somebody else decided the place: a second tab, or a run. It is no
    // longer a question, so its row leaves, and the page says why.
    if (error?.code === 'place_already_imported') {
      queue.drop(place.id);
      this._decided();
      this._notice.set({
        over: this.queue.current()?.id ?? null,
        key: 'harvest.places.linked.already',
        args: { place: placeLabel(place) },
        more: [],
      });
    }
  }

  /**
   * The names of fields as one phrase: "the address, the city and the postal
   * code". Each name is translated, and so is the word that joins the last
   * one to the others.
   */
  words(keys: readonly string[]): string {
    const names = keys.map((key) => this._translate.t(key));
    if (names.length < 2) {
      return names[0] ?? '';
    }
    return this._translate.t(
      'harvest.places.linked.list',
      undefined,
      undefined,
      {
        others: names.slice(0, -1).join(', '),
        last: names[names.length - 1],
      }
    );
  }

  /** What the mark on a line of the column says, or null for no mark. */
  markOf(row: { readonly candidates?: unknown }): {
    readonly key: string;
    readonly hint: boolean;
  } | null {
    const key = candidateMarkKey(row.candidates);
    return key === null
      ? null
      : { key, hint: key === 'harvest.places.mark.near' };
  }

  /**
   * Ask what the bulk act would do, and show it (admin plan 0061, target 8).
   *
   * The request carries no `apply`, so it changes nothing. The act reads
   * every undecided place, whatever chain the queue is narrowed to.
   */
  async previewByRef(): Promise<void> {
    // Held while a decision of the queue is in flight too: the answer would
    // be a list that the decision is about to change.
    if (this.locked()) {
      return;
    }
    const turn = ++this._byRefTurn;
    this.byRefOpen.set(true);
    this.byRef.set(null);
    this.byRefErrorKey.set(null);
    this.byRefBusy.set(true);
    try {
      const answer = await this._service.linkPlacesByRef({});
      // The queue was read again while this was asked: the answer is stale.
      if (turn === this._byRefTurn) {
        this.byRef.set(refLinkPreview(answer, this._content.order()));
      }
    } catch (error) {
      if (turn === this._byRefTurn) {
        this.byRefErrorKey.set(
          gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
        );
      }
    } finally {
      this.byRefBusy.set(false);
    }
  }

  /**
   * Take the preview away, because the queue is no longer the one it read.
   *
   * The apply sends no list: the server works it out again. A preview that
   * stayed after an import, a link or a reject would keep "Link N places"
   * armed over a list that is not the one that would be linked.
   */
  private _dropPreview(): void {
    this._byRefTurn += 1;
    this.byRefOpen.set(false);
    this.byRef.set(null);
    this.byRefErrorKey.set(null);
  }

  /**
   * "Link N places", under the preview. The one call that sends `apply`, and
   * it is refused here while no preview with a place to link is on screen,
   * and while any other write is in flight.
   *
   * The request names no place: the server reads the queue again. So the
   * places that the answer linked are compared with the ones that were
   * shown, and the notice says how many more and how many fewer.
   */
  async applyByRef(): Promise<void> {
    const preview = this.byRef();
    if (
      !this.byRefOpen() ||
      preview === null ||
      preview.linked.length === 0 ||
      this.locked()
    ) {
      return;
    }

    this.byRefErrorKey.set(null);
    this.byRefBusy.set(true);
    let linked: ReadonlySet<string> | null = null;
    try {
      const answer = await this._service.linkPlacesByRef({ apply: true });
      linked = new Set(answer.linked.map((row) => row.place.id));
    } catch {
      // A catalog write that fails stops the act, and the links before it
      // stay. So the queue is read again either way, and nothing is said to
      // be linked.
      this.byRefErrorKey.set('harvest.places.byRef.failed');
      this.byRef.set(null);
    }

    // The queue and the counts of the rail, read again.
    const queue = this.queue;
    this._reset();
    await queue.load();
    this._status.refresh();
    this.byRefBusy.set(false);

    if (linked !== null) {
      const applied = linked;
      const shown = new Set(preview.linked.map((line) => line.placeId));
      const more = [...applied].filter((id) => !shown.has(id)).length;
      const fewer = [...shown].filter((id) => !applied.has(id)).length;
      const differs: Sentence[] = [];
      if (more > 0) {
        differs.push({
          key: 'harvest.places.byRef.more',
          args: { count: more },
        });
      }
      if (fewer > 0) {
        differs.push({
          key: 'harvest.places.byRef.fewer',
          args: { count: fewer },
        });
      }

      this.byRefOpen.set(false);
      this.byRef.set(null);
      this._notice.set({
        over: this.queue.current()?.id ?? null,
        key: 'harvest.places.byRef.done',
        args: { count: applied.size },
        more: differs,
      });
      // The panel that held the pressed button is gone.
      this._focus('[data-tool="by-ref"]');
    }
  }

  closeByRef(): void {
    this._dropPreview();
    this._focus('[data-tool="by-ref"]');
  }

  reject(): void {
    const queue = this.queue;
    if (this.locked()) {
      return;
    }
    void queue
      .decide((place) => this._service.rejectPlace(place.id))
      .then(() => {
        // A refused reject took nothing out of the queue.
        if (queue.error() === null) {
          this._decided();
        }
      });
  }

  /**
   * Read the queue again from its first page, after a read that failed.
   * What the panel and the preview held was about the queue before it.
   */
  reload(): void {
    this._reset();
    this._dropPreview();
    void this.queue.load();
  }

  /**
   * Narrow the queue to the places of one chain, or widen it back.
   *
   * The chain's row holds the brand key that discovery files its places
   * under. A chain with none cannot be asked for, so the queue stays whole
   * and {@link unnarrowed} says so.
   */
  private async _narrow(chain: string): Promise<void> {
    const turn = ++this._narrowing;
    let brandKey = '';

    if (chain !== '') {
      const option = await this.references.resolve('supermarkets', chain);
      if (turn !== this._narrowing) {
        return;
      }
      const key = option?.row?.['externalBrandKey'];
      brandKey = typeof key === 'string' ? key : '';
    }

    this.unnarrowed.set(chain !== '' && brandKey === '');
    this._brandKey.set(brandKey);
    this._reset();
    this._dropPreview();

    const queue = this._build();
    this._queue.set(queue);
    await queue.load();
  }

  /**
   * A line of the column was pressed: that place is the one in front.
   *
   * The panel is cleared when the place changes. The picked chain, the scope
   * and the chain form were answers about the place before it, and left in
   * place they would file this one under the wrong chain in one press.
   */
  open(id: string): void {
    this._follow(() => this.queue.focus(id));
  }

  /** The next place, without deciding this one, with the panel cleared. */
  skip(): void {
    const queue = this.queue;
    // Also in a queue of one place, where a skip comes back to that place.
    this._question.set(null);
    const moved = this._follow(() => queue.skip());
    const front = queue.current()?.id ?? null;
    // On the last place that is loaded, the queue reads the next page first
    // and the place changes a moment later.
    void moved.then(() => {
      if (this.queue === queue && this._changedFrom(front)) {
        this._reset();
      }
    });
  }

  /** Move the queue, and clear the panel when another place came up. */
  private _follow<R>(move: () => R): R {
    const front = this.queue.current()?.id ?? null;
    const result = move();
    if (this._changedFrom(front)) {
      this._reset();
    }
    return result;
  }

  private _changedFrom(id: string | null): boolean {
    return (this.queue.current()?.id ?? null) !== id;
  }

  /** Name the chain here, starting from the brand the place prints. */
  startNewChain(place: Place): void {
    this.creatingChain.set(true);
    this.supermarketId.set('');
    this.priceScopeId.set('');
    if (this.newChainName().trim() === '') {
      this.newChainName.set(place.brandName ?? place.name ?? '');
    }
  }

  cancelNewChain(): void {
    this.creatingChain.set(false);
    this._needsChain.set(false);
  }

  onChainName(event: Event): void {
    this.newChainName.set((event.target as HTMLInputElement).value);
  }

  onChainLocale(event: Event): void {
    this.newChainLocale.set(
      (event.target as HTMLSelectElement).value as ChainLocale
    );
  }

  /**
   * What an import of the place in front sends.
   *
   * A chain named here wins over a picked one, and the two are never both
   * sent: the harvester refuses that pair. Nothing is sent that was not
   * chosen, so an untouched panel still sends `{}` and the harvester resolves
   * the chain from the brand and the scope from the run.
   */
  private _importBody(force: boolean): Wire.ImportDiscoveredPlaceDto {
    const body: Wire.ImportDiscoveredPlaceDto = {};
    const name = this.newChainName().trim();
    const supermarketId = this.supermarketId().trim();

    if (this.creatingChain() && name !== '') {
      body.newChain = { name, locale: this.newChainLocale() };
    } else if (supermarketId !== '') {
      body.supermarketId = supermarketId;
      const priceScopeId = this.priceScopeId().trim();
      if (priceScopeId !== '') {
        body.priceScopeId = priceScopeId;
      }
    }
    if (force) {
      body.force = true;
    }
    return body;
  }

  /** Read what the import answered, and set the panel up for the next step. */
  private _settle(place: Place, body: Wire.ImportDiscoveredPlaceDto): void {
    const error = this.queue.error();
    if (error === null) {
      this._decided();
      return;
    }

    if (error.code === 'place_matches_location') {
      this._matches.set({
        placeId: place.id,
        candidates: placeCandidates(error.details, this._content.order()),
      });
      return;
    }

    // Another shop holds the reference of the place (backend plan 0195).
    // `force` does not get past it, so the candidates of an earlier refusal
    // go, and "Create a new shop anyway" with them. The panel names the
    // holder and offers the link form.
    if (error.code === 'location_external_ref_taken') {
      this._matches.set(null);
      this._handled.set(error);
      this._refTaken.set({
        placeId: place.id,
        holder: refusedRefHolder(error.details, this._content.order()),
      });
      return;
    }

    // The plain conflict an OpenStreetMap place gets when nothing names its
    // chain (backend plan 0153). Opening the form is the answer to it.
    const unnamed =
      body.supermarketId === undefined && body.newChain === undefined;
    if (error.code === 'conflict' && unnamed && fromOpenStreetMap(place)) {
      this._needsChain.set(true);
      this.startNewChain(place);
    }
  }

  /**
   * A decision went through: clear the panel for the next place, drop the
   * preview of the bulk act, which read the queue as it was, and read the
   * counts again so that the rail says what the queue holds.
   */
  private _decided(): void {
    this._reset();
    this._dropPreview();
    this._status.refresh();
  }

  private _reset(): void {
    this.supermarketId.set('');
    this.priceScopeId.set('');
    this.creatingChain.set(false);
    this.newChainName.set('');
    this.newChainLocale.set('es');
    this._matches.set(null);
    this._needsChain.set(false);
    this._linking.set(null);
    this._question.set(null);
    this._refTaken.set(null);
    this._notice.set(null);
  }

  /**
   * The catalog shops near the place in front, for the duplicates panel.
   *
   * A read that fails costs the panel its catalog half and nothing else: the
   * import still asks the catalog itself, so this is evidence for a person and
   * never the check.
   */
  private async _readCatalogNear(
    place: Place | null,
    picked: string
  ): Promise<void> {
    const read = ++this._nearRead;
    const done = (shops: readonly NearbyShop[]) => {
      if (read === this._nearRead) {
        this.catalogNear.set(shops);
      }
    };

    if (place === null) {
      done([]);
      return;
    }

    const chain = picked !== '' ? picked : await this._chainOf(place);
    const locations = this._registry.byName('locations');
    if (chain === null || locations === undefined) {
      done([]);
      return;
    }

    try {
      const page = await this._registry.gatewayFor(locations).list({
        filters: { supermarketId: chain },
        limit: CATALOG_SHOPS_READ,
      });
      done(nearbyShops(place, page.items, this._content.order()));
    } catch {
      done([]);
    }
  }

  /**
   * The chain whose Wikidata key the place carries, or null.
   *
   * Searched by the key, which the chains route matches, and then compared
   * exactly: a search is a substring match and `Q2` is inside `Q217599`.
   */
  private async _chainOf(place: Place): Promise<string | null> {
    const key = place.brandKey;
    if (key === null || key === '') {
      return null;
    }
    const known = this._chainsByKey.get(key);
    if (known !== undefined) {
      return known;
    }

    const supermarkets = this._registry.byName('supermarkets');
    if (supermarkets === undefined) {
      return null;
    }

    try {
      const page = await this._registry.gatewayFor(supermarkets).list({
        filters: { query: key },
        limit: 20,
      });
      const found = page.items.find((row) => row['externalBrandKey'] === key);
      const id = typeof found?.['id'] === 'string' ? found['id'] : null;
      this._chainsByKey.set(key, id);
      return id;
    } catch {
      return null;
    }
  }
}
