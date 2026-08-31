import {
  LINE_BATCH_MAX_ITEMS,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  LineApprovalStatus,
  LineStatus,
  ListResolutionBranch,
  UsernamePropagation,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type { ModelToolDeclaration } from '../provider/model-provider';
import { GatewayApiClient, GatewayApiError } from './gateway-api.client';
import {
  normalize,
  resolveList,
  type ContextList,
  type ListResolution,
} from './list-resolution';
import type { ReferenceCollector } from './references';
import type { TurnContext } from './turn-context';

/**
 * The three tools (plan 0039, section 6), hand written.
 *
 * Backlog 0005 section 2 wants the catalog generated from the gateway's OpenAPI
 * document, and that stays right for an assistant with a wide surface. Three
 * tools is not a wide surface, and a generator plus its tests would dwarf the
 * thing being tested.
 *
 * **The freedom is in the text and the constraint is in the actions** (section
 * 7). There is no fourth thing the bot can do because there is no fourth tool,
 * and an absent capability is a much harder boundary than an instruction. What
 * section 12 excludes — every deletion, all zone governance, every account
 * operation but the rename, creating or joining zones, creating lists, the whole
 * catalog service and every platform admin route — is absent from this file
 * rather than discouraged in the prompt.
 *
 * Two properties every tool here shares:
 *
 * - **It never receives or returns an id.** Arguments name things the way a
 *   person does, results are shaped for a sentence, and the ids the client needs
 *   are emitted separately as references (rule A3).
 * - **It acts through the gateway with the caller's token.** A write the caller
 *   could not make by tapping fails with the ordinary error, which the bot
 *   relays in words.
 */

/** Everything a tool is allowed to reach. Assembled per turn, dropped with it. */
export interface ToolRuntime {
  context: TurnContext;
  api: GatewayApiClient;
  references: ReferenceCollector;
  /** The conversation so far as plain text, for branch 2 of list resolution. */
  transcript: string[];
  /** Recorded when a write resolved a list, for section 10's turn record. */
  recordListResolution(branch: ListResolutionBranch): void;
}

export interface AssistantTool {
  declaration: ModelToolDeclaration;
  execute(
    args: Record<string, unknown>,
    runtime: ToolRuntime
  ): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// 6.1 upsert_lines (plan 0040, section 7)
// ---------------------------------------------------------------------------

/** How an item's quantity is meant (plan 0040, section 7.2). */
type UpsertMode = 'set' | 'add';

/** One item of an `upsert_lines` call, after its arguments have been read. */
interface UpsertItem {
  product: string;
  mode: UpsertMode;
  /**
   * Absent only for `set`, and it means the caller named no number. That is not
   * the same as one: on a line that already exists it is what makes the call
   * write nothing at all (section 7.2).
   */
  quantity: number | undefined;
}

const upsertLines: AssistantTool = {
  declaration: {
    name: 'upsert_lines',
    description:
      "Put things on one of this person's shopping lists, or change how many of something is on it. Use it whenever they ask for something to be added. Pass every product they named in one call: ten things is one call with ten items, never ten calls. Give each product exactly as they said it, without the quantity. Only name a list or a zone that appears in the context you were given; if they did not say which list and the context does not make it obvious, call this anyway with no list and you will be told to ask.",
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: LINE_BATCH_MAX_ITEMS,
          description: 'Everything they asked for, in the order they said it.',
          items: {
            type: 'object',
            properties: {
              product: {
                type: 'string',
                description:
                  "The thing to buy, in this person's own words, without the quantity.",
              },
              quantity: {
                type: 'integer',
                minimum: LINE_QUANTITY_MIN,
                maximum: LINE_QUANTITY_MAX,
                description:
                  'How many. Omit when they did not say. With mode "add" it is how many to add, and omitting it means one more.',
              },
              mode: {
                type: 'string',
                enum: ['set', 'add'],
                description:
                  '"set" is the default and means the list should end up with this many. Send "add" when they asked for more of something on top of what is already there: "two more", "another", "a couple extra". Never work out the new total yourself.',
              },
            },
            required: ['product'],
          },
        },
        list: {
          type: 'string',
          description:
            'The name of the list, exactly as it appears in the context. Omit when they did not name one. Everything in one call goes on the same list; two lists is two calls.',
        },
        zone: {
          type: 'string',
          description:
            'The name of the zone, when they named one and it narrows which list is meant.',
        },
      },
      required: ['items'],
    },
  },

  async execute(args, runtime) {
    const items = foldDuplicates(readItems(args['items']));
    if (items.length === 0) {
      return { ok: false, problem: 'no products were given' };
    }

    // One list per call, still (section 7.1). List resolution runs once, so the
    // branch recorded for the turn stays one branch per call and keeps meaning
    // what it meant. "Milk on the flat list and bread on the office list" is two
    // calls, which is correct: they are two decisions about which list, and each
    // deserves its own record and its own chance to ask.
    //
    // On a scoped turn there is nothing to resolve: the list came in the request
    // and `resolveScoped` either returns it or refuses the call outright (plan
    // 0044, section 2.1).
    const scopedList = runtime.context.scopedList;
    if (scopedList !== undefined && namesAnotherList(args, scopedList)) {
      return outOfScope(scopedList);
    }

    const resolution: ListResolution =
      scopedList !== undefined
        ? { branch: ListResolutionBranch.ONLY_LIST, list: scopedList }
        : resolveList({
            named: readString(args['list']),
            zone: readString(args['zone']),
            transcript: runtime.transcript,
            lists: runtime.context.lists,
          });
    runtime.recordListResolution(resolution.branch);

    // Branch 4. A write that guessed is worse than a question, so the turn ends
    // with one and nothing is written. This is the ordinary case for somebody
    // with several lists, and the result says so plainly enough that the model
    // asks rather than apologizes.
    if (resolution.branch === ListResolutionBranch.ASKED) {
      for (const candidate of resolution.candidates) {
        runtime.references.list(candidate);
      }
      return {
        ok: false,
        needsList: true,
        message:
          'Nothing was written. Ask which of these lists they meant, then call this tool again with that name.',
        choices: resolution.candidates.map(describeList),
      };
    }

    const list = resolution.list;

    let lines: LineView[];
    try {
      // One read for the whole call, which is the other half of what folding the
      // duplicates buys: a second write computed against a cache that predates
      // the first is the lost update of section 2, reappearing inside one call.
      lines = await runtime.context.lines(list.listId);
    } catch (error) {
      return refused(error, 'read that list');
    }

    const planned = items.map((item, index) => ({
      item,
      index,
      existing: findSameProduct(lines, item.product),
    }));

    // One slot per item, filled by index rather than appended, so the report
    // comes back in the order the person said things even though the writes are
    // grouped: the new ones go in one request and the rest one at a time.
    const results: (ItemResult | undefined)[] = new Array(planned.length);
    let firstFailure: unknown;
    let wrote = false;

    const fresh = planned.filter((entry) => !entry.existing);
    if (fresh.length > 0) {
      try {
        const added = await runtime.api.addLines(
          runtime.context.caller,
          list.listId,
          fresh.map((entry) => ({
            content: entry.item.product,
            ...(entry.item.quantity !== undefined
              ? { quantity: entry.item.quantity }
              : {}),
          }))
        );
        wrote = true;
        // The batch answers in request order, which is what lets a line be put
        // back against the item that asked for it.
        added.forEach((line, position) => {
          runtime.references.line(list, line.id, line.content);
          results[fresh[position].index] = describeLine('added', line);
        });
      } catch (error) {
        firstFailure = error;
        for (const entry of fresh) {
          results[entry.index] = itemRefused(entry.item.product, error);
        }
      }
    }

    for (const entry of planned) {
      const existing = entry.existing;
      if (!existing) {
        continue;
      }
      const { product, mode, quantity } = entry.item;

      // Naming something already on the list with no number asks for nothing, so
      // nothing is written (section 7.2). The edit this used to send was not
      // harmless: it bumped the version, sent a `LineUpdated`, quietly returned a
      // **rejected** line to `PENDING`, and on an **approved** line refused a
      // caller without `DECIDE` outright. Somebody mentioning milk a second time
      // was told they were not allowed to do something they never meant to do.
      if (mode === 'set' && quantity === undefined) {
        runtime.references.line(list, existing.id, existing.content);
        results[entry.index] = describeLine('unchanged', existing);
        continue;
      }

      try {
        const line =
          mode === 'add'
            ? await runtime.api.addLineQuantity(
                runtime.context.caller,
                existing.id,
                quantity ?? 1
              )
            : await runtime.api.updateLine(
                runtime.context.caller,
                existing.id,
                { content: product, quantity }
              );
        wrote = true;
        runtime.references.line(list, line.id, line.content);
        results[entry.index] = describeLine(
          mode === 'add' ? 'increased' : 'updated',
          line
        );
      } catch (error) {
        firstFailure ??= error;
        results[entry.index] = itemRefused(product, error);
      }
    }

    // One invalidation for the call rather than one per write, so a later read in
    // the same turn is true and the list was not re-fetched between two writes
    // that were decided together.
    if (wrote) {
      runtime.context.invalidate(list.listId);
    } else if (firstFailure !== undefined) {
      // Nothing was written and something was refused, so the call refused: the
      // API's own localized sentence is the answer, not a per item envelope
      // describing a partial success that did not happen.
      return refused(firstFailure, 'add that to the list');
    }

    return {
      ok: true,
      list: list.listName,
      zone: list.zoneName,
      items: results.filter(
        (result): result is ItemResult => result !== undefined
      ),
    };
  },
};

// ---------------------------------------------------------------------------
// 6.2 query_lists
// ---------------------------------------------------------------------------

const queryLists: AssistantTool = {
  declaration: {
    name: 'query_lists',
    description:
      "Look at what is actually on this person's lists: whether something is on one, how much of it, what is still pending, which list has it. Call it before answering any question about the contents of a list. Never answer such a question from memory.",
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'The thing being asked about. Omit to report on the whole list.',
        },
        list: {
          type: 'string',
          description:
            'The name of one list to look at, exactly as it appears in the context. Omit to look at every list this person can see.',
        },
        zone: {
          type: 'string',
          description:
            'The name of a zone, to narrow which lists are looked at.',
        },
        pendingOnly: {
          type: 'boolean',
          description:
            'True when they asked what is still to buy, rather than what is on the list.',
        },
      },
      required: [],
    },
  },

  async execute(args, runtime) {
    const item = readString(args['item']);
    const pendingOnly = args['pendingOnly'] === true;

    // Read only, so unlike a write there is nothing here that a wrong guess
    // would damage: an unmatched name widens the search rather than ending the
    // turn with a question. This is the one tool that should feel instant.
    const named = readString(args['list']);
    const zone = readString(args['zone']);
    const targets = selectLists(runtime.context.lists, named, zone);

    if (targets.length === 0) {
      return {
        ok: true,
        lists: [],
        message: 'This person can see no lists at all.',
      };
    }

    try {
      const lists = [];
      for (const list of targets) {
        const lines = await runtime.context.lines(list.listId);
        const matching = lines.filter(
          (line) =>
            (!item || mentionsProduct(line, item)) &&
            (!pendingOnly || line.status === LineStatus.PENDING)
        );

        runtime.references.list(list);
        for (const line of matching.slice(0, 20)) {
          runtime.references.line(list, line.id, line.content);
        }

        lists.push({
          list: list.listName,
          zone: list.zoneName,
          total: lines.length,
          // Reported as found, never derived from a count the model can guess at.
          // Every fact about a line in the reply has to come from this array.
          matches: matching.map((line) => ({
            product: line.content,
            quantity: line.quantity,
            status: line.status,
            approval: line.approvalStatus,
          })),
        });
      }

      return { ok: true, item: item ?? null, pendingOnly, lists };
    } catch (error) {
      return refused(error, 'read that list');
    }
  },
};

// ---------------------------------------------------------------------------
// 6.3 rename_me
// ---------------------------------------------------------------------------

/**
 * The three propagation values, in the words a person uses for them.
 *
 * `MATCHING_ZONES` is the default the bot sends, which is what "change the name
 * on zones too" means in practice and is the only one of the three that is safe
 * as a default: somebody who deliberately became "Mamá" in the family zone keeps
 * it, which is exactly the case plan 0018's own comment says the default exists
 * to protect. `ALL_ZONES` would clobber it, and it is sent only when the caller
 * says something that plainly means everywhere.
 */
const SCOPES: Record<string, UsernamePropagation> = {
  everywhere: UsernamePropagation.ALL_ZONES,
  account_only: UsernamePropagation.GLOBAL_ONLY,
  account_and_matching_zones: UsernamePropagation.MATCHING_ZONES,
};

const renameMe: AssistantTool = {
  declaration: {
    name: 'rename_me',
    description:
      "Change this person's own username. It changes what other people see, so tell them what you are about to do and call this only once they have agreed, with confirmed set to true. Before they have agreed, call it with confirmed false to check the change is possible and get the sentence to ask.",
    parameters: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'The new username they asked for.',
        },
        scope: {
          type: 'string',
          enum: Object.keys(SCOPES),
          description:
            'account_and_matching_zones is the default and is right for "change my name": their account, and the groups where they are still called the old name. account_only when they say to leave the groups alone. everywhere only when they plainly mean every group whatever it currently says.',
        },
        confirmed: {
          type: 'boolean',
          description:
            'True only after they have agreed to the exact change in this conversation.',
        },
      },
      required: ['username'],
    },
  },

  async execute(args, runtime) {
    const username = readString(args['username']);
    if (!username) {
      return { ok: false, problem: 'no username was given' };
    }

    const scopeKey = readString(args['scope']) ?? 'account_and_matching_zones';
    const propagation = SCOPES[scopeKey] ?? UsernamePropagation.MATCHING_ZONES;

    // The one line ceremony section 6.3 describes. It is a single reversible
    // call, so this is a sentence and not the multi step gate the destructive
    // operations would need if they were here, which they are not.
    if (args['confirmed'] !== true) {
      return {
        ok: false,
        needsConfirmation: true,
        wouldChange: describeScope(propagation),
        username,
        message:
          'Nothing has changed yet. Tell them exactly what will change and ask them to confirm, then call this again with confirmed true.',
      };
    }

    try {
      // One request. Plan 0018 built the cascade server side, so there is nothing
      // to orchestrate here and nothing that can half succeed.
      const profile = await runtime.api.setUsername(
        runtime.context.caller,
        username,
        propagation
      );
      return {
        ok: true,
        username: profile.username,
        changed: describeScope(propagation),
      };
    } catch (error) {
      // Usernames are global and unique since plan 0018, so this genuinely comes
      // back saying the name is taken. That is an answer the bot relays in words,
      // not an error, and the API already wrote the sentence in their language.
      return refused(error, 'change that name');
    }
  },
};

export const ASSISTANT_TOOLS: AssistantTool[] = [
  upsertLines,
  queryLists,
  renameMe,
];

/**
 * What a turn scoped to one list may do (plan 0044, section 2.2).
 *
 * `rename_me` is **not here**, and that is the whole point of assembling a
 * catalog per turn rather than filtering inside a tool. Changing your username is
 * not an operation on a list; it is a perfectly good thing to ask the assistant
 * for, and the assistant panel is where you ask it. Somebody speaking into a
 * shopping list's add button has not asked to be renamed, and the one plausible
 * way it fires from there is a misheard sentence, which is the worst possible
 * reason for it to be reachable.
 *
 * **An absent capability is a much harder boundary than an instruction** (plan
 * 0039, section 7), and that argument only holds if the absence is real. A tool
 * that is declared and then refuses is a tool the model can still call and whose
 * refusal it has to be told how to handle.
 *
 * Two tools rather than the plan's four: `set_line_status` and `remove_lines`
 * are backend plan 0043's and are not built yet. They join this list where they
 * join the other, and nothing here has to change when they do.
 */
export const SCOPED_TOOLS: AssistantTool[] = [upsertLines, queryLists];

export const TOOL_DECLARATIONS: ModelToolDeclaration[] = ASSISTANT_TOOLS.map(
  (tool) => tool.declaration
);

export const SCOPED_TOOL_DECLARATIONS: ModelToolDeclaration[] =
  SCOPED_TOOLS.map((tool) => tool.declaration);

/** The catalog this turn was given, which is the only place a tool may be found. */
export function catalogFor(scoped: boolean): AssistantTool[] {
  return scoped ? SCOPED_TOOLS : ASSISTANT_TOOLS;
}

export function findTool(
  name: string,
  scoped = false
): AssistantTool | undefined {
  return catalogFor(scoped).find((tool) => tool.declaration.name === name);
}

/**
 * Whether a call named a list that is not the scoped one.
 *
 * Matching is the same normalization list resolution uses, so "the flat list"
 * and "Flat list" are one answer here and there. A call that named nothing is
 * not out of scope: it meant the list on the screen, which is the only one.
 */
function namesAnotherList(
  args: Record<string, unknown>,
  scoped: ContextList
): boolean {
  const named = readString(args['list']);

  return (
    named !== null &&
    named !== undefined &&
    named.trim().length > 0 &&
    normalize(named) !== normalize(scoped.listName)
  );
}

/**
 * The backstop for a call that named another list (plan 0044, section 2.1).
 *
 * A backstop rather than a normal path: the model is told in the context that
 * there is one list and it is this one, so naming another is already unlikely.
 * It exists because unlikely is not the same as cannot, and a write to the wrong
 * list is exactly the failure a scope was added to prevent.
 */
function outOfScope(scoped: ContextList): unknown {
  return {
    ok: false,
    outOfScope: true,
    message: `Nothing was written. This person is looking at "${scoped.listName}" and that is the only list you can change right now. Tell them where the other list lives instead of trying again.`,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** What one item of an `upsert_lines` call ended up doing. */
interface ItemResult {
  product: string;
  action?: 'added' | 'updated' | 'increased' | 'unchanged';
  quantity?: number;
  awaitingApproval?: boolean;
  refused?: true;
  reason?: string;
}

/**
 * What a line says after the write, reported rather than computed.
 *
 * `quantity` is the server's number in every case, including `added_to`, which is
 * the point of the quantity route: the bot says five because the server said
 * five, not because it decided five (plan 0040, section 2).
 */
function describeLine(
  action: NonNullable<ItemResult['action']>,
  line: LineView
): ItemResult {
  return {
    product: line.content,
    action,
    quantity: line.quantity,
    // Plan 0037: a list may hold new lines pending somebody's approval, and the
    // person who asked deserves to be told their milk is waiting rather than to
    // find out in the shop.
    awaitingApproval: line.approvalStatus === LineApprovalStatus.PENDING,
  };
}

function itemRefused(product: string, error: unknown): ItemResult {
  const { reason } = refused(error, 'that');
  return { product, refused: true, reason };
}

/** The items of a call, dropping anything that does not name a product. */
function readItems(value: unknown): UpsertItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: UpsertItem[] = [];
  for (const entry of value) {
    const bag = (entry ?? {}) as Record<string, unknown>;
    const product = readString(bag['product']);
    if (!product) {
      continue;
    }
    const mode: UpsertMode = bag['mode'] === 'add' ? 'add' : 'set';
    const quantity = readQuantity(bag['quantity']);
    // "Another" carries no number, and for an addition that means one more. For
    // `set` the absence is meaningful and is kept.
    items.push({
      product,
      mode,
      quantity: mode === 'add' ? (quantity ?? 1) : quantity,
    });
  }
  return items;
}

/**
 * Two items naming the same product become one (plan 0040, section 7.3).
 *
 * The lines are read once for the whole call, so a second write would otherwise
 * be computed against a cache that predates the first, which is the lost update
 * of section 2 reappearing inside a single tool call.
 *
 * Folded in the order they were said, so a later instruction refines an earlier
 * one: a `set` with a number supersedes everything before it, an `add` sums onto
 * whatever the fold is holding, and a `set` with no number asks for nothing
 * beyond what its neighbours already ask for and drops out.
 */
function foldDuplicates(items: UpsertItem[]): UpsertItem[] {
  const folded: UpsertItem[] = [];
  const at = new Map<string, number>();

  for (const item of items) {
    const key = normalize(item.product);
    const index = at.get(key);
    if (index === undefined) {
      at.set(key, folded.length);
      folded.push({ ...item });
      continue;
    }

    const held = folded[index];
    if (item.mode === 'set') {
      if (item.quantity !== undefined) {
        folded[index] = { ...item };
      }
      continue;
    }
    if (held.mode === 'set' && held.quantity !== undefined) {
      held.quantity += item.quantity ?? 1;
      continue;
    }
    folded[index] = {
      product: held.product,
      mode: 'add',
      quantity:
        (held.mode === 'add' ? (held.quantity ?? 1) : 0) + (item.quantity ?? 1),
    };
  }

  return folded;
}

function describeList(list: ContextList): { list: string; zone: string } {
  return { list: list.listName, zone: list.zoneName };
}

function describeScope(propagation: UsernamePropagation): string {
  switch (propagation) {
    case UsernamePropagation.ALL_ZONES:
      return 'their account name, and their name in every group whatever it currently says';
    case UsernamePropagation.GLOBAL_ONLY:
      return 'their account name only; every group keeps the name it has';
    default:
      return 'their account name, and their name in the groups where it still matches the old one';
  }
}

/** Lists to read: the named one, else the named zone's, else all of them. */
function selectLists(
  lists: ContextList[],
  named: string | undefined,
  zone: string | undefined
): ContextList[] {
  const inZone = zone
    ? lists.filter(
        (list) =>
          normalize(list.zoneName) === normalize(zone) ||
          normalize(list.zoneName).includes(normalize(zone))
      )
    : lists;
  const scoped = inZone.length > 0 ? inZone : lists;

  if (!named) {
    return scoped;
  }
  const byName = scoped.filter(
    (list) =>
      normalize(list.listName) === normalize(named) ||
      normalize(list.listName).includes(normalize(named))
  );
  return byName.length > 0 ? byName : scoped;
}

/** The same product already on the list, matched the way a person would. */
function findSameProduct(
  lines: LineView[],
  product: string
): LineView | undefined {
  const wanted = normalize(product);
  return lines.find((line) => normalize(line.content) === wanted);
}

function mentionsProduct(line: LineView, item: string): boolean {
  const content = normalize(line.content);
  const wanted = normalize(item);
  return (
    wanted.length > 0 && (content.includes(wanted) || wanted.includes(content))
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readQuantity(value: unknown): number | undefined {
  const quantity = typeof value === 'number' ? Math.round(value) : Number.NaN;
  return Number.isFinite(quantity) && quantity >= 1 ? quantity : undefined;
}

/**
 * Turns a refusal from the API into something the model can say.
 *
 * The API's own localized `message` is passed through rather than replaced: "that
 * name is taken" is a sentence the platform already writes, in the caller's
 * language, and writing it a second time here would be a second translation of
 * one fact. Rule A1's payoff is exactly this — the blast radius of a misread
 * sentence is the blast radius of a mistaken tap, and the error is the same one.
 */
function refused(
  error: unknown,
  attempted: string
): { ok: false; refused: true; attempted: string; reason: string } {
  if (error instanceof GatewayApiError) {
    return {
      ok: false,
      refused: true,
      attempted,
      reason:
        error.apiMessage ??
        (error.status === 403
          ? 'they are not allowed to do that'
          : `the app answered ${error.status}`),
    };
  }
  return {
    ok: false,
    refused: true,
    attempted,
    reason: 'the app could not be reached',
  };
}
