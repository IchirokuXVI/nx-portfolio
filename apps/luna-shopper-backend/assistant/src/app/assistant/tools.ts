import {
  LINE_BATCH_MAX_ITEMS,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  LineApprovalStatus,
  ListResolutionBranch,
  SettlementOutcome,
  UsernamePropagation,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type { ModelToolDeclaration } from '../provider/model-provider';
import { GatewayApiClient, GatewayApiError } from './gateway-api.client';
import type { ChoiceCollector, ListLinkCollector } from './link-and-choices';
import {
  matchByName,
  normalize,
  resolveList,
  type ContextList,
  type ListResolution,
} from './list-resolution';
import type { KnownLine, TurnContext } from './turn-context';

/**
 * The five tools (plan 0039 section 6, plan 0043 section 1), hand written.
 *
 * Backlog 0005 section 2 wants the catalog generated from the gateway's OpenAPI
 * document, and that stays right for an assistant with a wide surface. Five
 * tools is not a wide surface, and a generator plus its tests would dwarf the
 * thing being tested.
 *
 * **The freedom is in the text and the constraint is in the actions** (section
 * 7). There is no sixth thing the bot can do because there is no sixth tool, and
 * an absent capability is a much harder boundary than an instruction. What plan
 * 0039 section 12 excludes is absent from this file rather than discouraged in
 * the prompt, and plan 0043 section 2 reopened exactly one entry on that list:
 * **a line** can now be deleted. Deleting a list, a zone or an account, all zone
 * governance, and approving or rejecting a line are still not here, and that
 * section's table is the argument for why a line is different in kind from every
 * one of them.
 *
 * Two properties every tool here shares:
 *
 * - **It names things the way a person does, with one deliberate exception.**
 *   Arguments are product text and list names, results are shaped for a
 *   sentence, and the ids the client needs are emitted separately, as a link
 *   and as choices (rule A3, plan 0046). The exception is a **line id**, which `query_lists` returns and
 *   the two tools from plan 0043 take back: removing a line and settling one
 *   have to say which line, and a description would be a guess where an id is a
 *   fact. It is bounded rather than trusted — an id is accepted only if this
 *   turn genuinely read it from the gateway (plan 0043, section 3.1), so an
 *   invented one is refused here rather than handed to a `DELETE`.
 * - **It acts through the gateway with the caller's token.** A write the caller
 *   could not make by tapping fails with the ordinary error, which the bot
 *   relays in words.
 */

/** Everything a tool is allowed to reach. Assembled per turn, dropped with it. */
export interface ToolRuntime {
  context: TurnContext;
  api: GatewayApiClient;
  /**
   * The one list this answer may send somebody to, when the turn touches exactly
   * one (plan 0046, section 2.4).
   */
  link: ListLinkCollector;
  /**
   * The answers to a question this turn asked, when it asked one (section 4).
   * Separate from the link on purpose: candidates are lists the turn could not
   * choose between, not lists it touched.
   */
  choices: ChoiceCollector;
  /** The conversation so far as plain text, for branch 2 of list resolution. */
  transcript: string[];
  /** Recorded when a write resolved a list, for section 10's turn record. */
  recordListResolution(branch: ListResolutionBranch): void;
  /**
   * Facts about this call for the turn record (plan 0043, section 6).
   *
   * Kept apart from the result the model sees, and from the arguments, because
   * neither carries what that section asks the record to carry. **A deletion is
   * recorded with the number of lines and the list, never with the line
   * contents**: the count is in the arguments, the contents are in the result,
   * and the list is in neither. **A refusal by this service is recorded
   * separately from a failure**, because "the model tried to delete lines it had
   * not read" and "the gateway said no" are different facts about the prompt,
   * and the first one is the number to watch.
   */
  noteForRecord(fields: { list?: string; refused?: true }): void;
}

export interface AssistantTool {
  declaration: ModelToolDeclaration;
  /**
   * The same tool as a scoped turn sees it, when a scope changes what it can be
   * asked (plan 0046, section 5.2). Defaults to {@link declaration}.
   *
   * A tool declares **per scope** so that an absent parameter is genuinely
   * absent. Narrowing the catalog and leaving the declarations alone left a
   * scoped turn reading a `list` parameter and a description about being told to
   * ask, which is the model being taught the question in the same breath the
   * context tells it there is only one list.
   */
  scopedDeclaration?: ModelToolDeclaration;
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

/**
 * What to put on the list, which is the same question in both scopes (plan 0046,
 * section 5.2).
 *
 * Hoisted so the open and the scoped declaration share it by reference. The only
 * thing a scope changes about `upsert_lines` is whether there is a list to name,
 * and two copies of this schema would drift on the first edit to a product's
 * wording.
 */
const upsertItemsParameter = {
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
};

const upsertLines: AssistantTool = {
  declaration: {
    name: 'upsert_lines',
    description:
      "Put things on one of this person's shopping lists, or change how many of something is on it. Use it whenever they ask for something to be added. Pass every product they named in one call: ten things is one call with ten items, never ten calls. Give each product exactly as they said it, without the quantity. Only name a list or a zone that appears in the context you were given; if they did not say which list and the context does not make it obvious, call this anyway with no list and you will be told to ask.",
    parameters: {
      type: 'object',
      properties: {
        items: upsertItemsParameter,
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

  /**
   * Scoped, there is no list to name, so there is no `list` and no `zone` (plan
   * 0046, section 5.2).
   *
   * The parameters are the argument. A `list` property says plainly that there is
   * a choice of list to make, and the open description's closing sentence, "call
   * this anyway with no list and you will be told to ask", teaches the question
   * outright. Plan 0044 enforced the scope inside `execute` and the person was
   * asked anyway, because the model asked **instead of** calling the tool and
   * enforcement inside a tool cannot answer a question asked before reaching it.
   */
  scopedDeclaration: {
    name: 'upsert_lines',
    description:
      'Put things on the list this person is looking at, or change how many of something is on it. Use it whenever they ask for something to be added. Pass every product they named in one call: ten things is one call with ten items, never ten calls. Give each product exactly as they said it, without the quantity. There is one list and it is the one they are looking at. Never ask which list they meant.',
    parameters: {
      type: 'object',
      properties: {
        items: upsertItemsParameter,
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
      // The candidates are the answers to the question, not lists this turn
      // touched (plan 0046, section 2.4). Sending them to the link collector
      // would guarantee "several lists" on exactly the turn that most needs the
      // person to pick one, and the link would come back null anyway.
      runtime.choices.lists(resolution.candidates);
      return {
        ok: false,
        needsList: true,
        message:
          'Nothing was written. Ask which of these lists they meant, then call this tool again with that name.',
        // The model's own copy, so it can ask the question in words naming
        // real lists. The chips the person taps are the collector's above, and
        // the two are deliberately not the same object: this one is prose the
        // model rewrites, and that one is what comes back as the next turn.
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
          runtime.link.list(list);
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
        runtime.link.list(list);
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
        runtime.link.list(list);
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

  /**
   * Scoped, there is one list to look at and it is not chosen (plan 0046,
   * section 5.2).
   *
   * `list` and `zone` are gone for the same reason as on `upsert_lines`: a
   * parameter offering a choice is a statement that there is one to make. What
   * changes here is only the wording of the remaining two, because reading is not
   * the operation a wrong guess damages.
   */
  scopedDeclaration: {
    name: 'query_lists',
    description:
      'Look at what is actually on the list this person is looking at: whether something is on it, how much of it, what is still pending. Call it before answering any question about the contents of the list. Never answer such a question from memory.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'The thing being asked about. Omit to report on the whole list.',
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
            // Wanted, since plan 0047: a line's quantity is the only thing
            // that says whether the household still needs it, and a line at zero
            // is one nobody has to go and get.
            (!pendingOnly || line.quantity > 0)
        );

        runtime.link.list(list);

        lists.push({
          list: list.listName,
          zone: list.zoneName,
          total: lines.length,
          // Reported as found, never derived from a count the model can guess at.
          // Every fact about a line in the reply has to come from this array.
          matches: matching.map((line) => ({
            // The one id the model is given, and the reason this tool is the
            // prerequisite for the two that change a line (plan 0043, section
            // 3.1). It goes back in a tool argument and never into the reply,
            // which the prompt says in those words. Handing it out here is what
            // "the model has to have looked" is made of: an id it did not get
            // from a result in this turn is refused before it reaches a write.
            id: line.id,
            product: line.content,
            quantity: line.quantity,
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

// ---------------------------------------------------------------------------
// 0043.3 remove_lines
// ---------------------------------------------------------------------------

/**
 * The most lines one call may take off a list (plan 0043, section 3.4).
 *
 * Small enough that a plausible misunderstanding cannot take a whole list with
 * it, and large enough for the way people actually talk: nobody names eleven
 * things to remove in one breath, and somebody who means the whole list is asking
 * for something this tool deliberately cannot do. A call over the cap is refused
 * whole rather than truncated, because a partially executed deletion is the worst
 * outcome available here.
 */
const REMOVE_LINES_MAX = 10;

const removeLines: AssistantTool = {
  declaration: {
    name: 'remove_lines',
    description:
      'Take one or more lines off a shopping list. Use it when they ask for something to come off: "take the olive oil off", "we do not need the rice". It works only with line ids that came back from query_lists in this same turn, so look the list up first and never write an id yourself. Before it removes anything, tell them exactly which things are about to go, by name, and call it with confirmed true only once they have said yes. Everything in one call comes off the same list. It cannot empty a list.',
    parameters: {
      type: 'object',
      properties: {
        lineIds: {
          type: 'array',
          minItems: 1,
          maxItems: REMOVE_LINES_MAX,
          description:
            'The ids of the lines to remove, exactly as query_lists gave them to you in this turn. If two things on the list could be what they meant, do not pick one: ask them which.',
          items: { type: 'string' },
        },
        confirmed: {
          type: 'boolean',
          description:
            'True only after they have agreed, in this conversation, to these exact things being removed.',
        },
      },
      required: ['lineIds'],
    },
  },

  async execute(args, runtime) {
    const ids = readIds(args['lineIds']);

    // There is no "empty the list" (section 3.4). A call with no ids is not a
    // call to delete everything, and the answer names the screen that does it,
    // which is what plan 0039 section 12's last line provides for everything the
    // catalog leaves out.
    if (ids.length === 0) {
      return blocked(
        runtime,
        'Nothing was removed. This takes lines off one at a time and cannot empty a list. If that is what they want, tell them the list settings screen deletes a whole list and asks them to type its name first.'
      );
    }

    if (ids.length > REMOVE_LINES_MAX) {
      return blocked(
        runtime,
        `Nothing was removed. That is more than ${REMOVE_LINES_MAX} lines at once, which is more than this can take off in one call. Ask them which ones they mean and do it a few at a time.`
      );
    }

    // Rule A3 applied to a write (section 3.1). An id that came back from the
    // gateway during this turn exists and the caller can see it; an id the model
    // wrote into a sentence has neither property, and a deletion is the turn
    // least worth being relaxed about it on.
    const resolved: KnownLine[] = [];
    for (const id of ids) {
      const known = runtime.context.knownLine(id);
      if (known === undefined) {
        return blocked(
          runtime,
          'Nothing was removed, because you named a line this turn has not read. Call query_lists first and use the ids it gives you.',
          { notInContext: true }
        );
      }
      resolved.push(known);
    }

    const list = resolved[0].list;
    if (resolved.some((known) => known.list.listId !== list.listId)) {
      return blocked(
        runtime,
        'Nothing was removed. Everything in one call has to come off the same list, so make one call per list.'
      );
    }

    const scopedList = runtime.context.scopedList;
    if (scopedList !== undefined && list.listId !== scopedList.listId) {
      runtime.noteForRecord({ refused: true });
      return outOfScope(scopedList);
    }

    // Section 3.3, and the reason it is one round trip rather than a stored
    // gate: the transcript is the state (plan 0039, section 4), so the question
    // ends the turn and the answer arrives in the next one with nothing kept in
    // between. On a voice turn it is read back, which is the case this matters
    // most in.
    if (args['confirmed'] !== true) {
      runtime.link.list(list);
      return {
        ok: false,
        needsConfirmation: true,
        list: list.listName,
        count: resolved.length,
        // By their text, and not "those two items": a confirmation of a pronoun
        // is not a confirmation.
        wouldRemove: resolved.map((known) => known.line.content),
        message:
          'Nothing has been removed yet. Name these to them exactly, ask them to confirm, then call this again with the same ids and confirmed true.',
      };
    }

    // The list, beside the count the arguments already carry, and nothing about
    // what was on the lines (section 6).
    runtime.noteForRecord({ list: list.listId });

    const removed: string[] = [];
    let failure: unknown;

    for (const known of resolved) {
      try {
        await runtime.api.deleteLine(runtime.context.caller, known.line.id);
        removed.push(known.line.content);
        // Gone, so nothing later in this turn can name it again (plan 0043,
        // section 3.1). There is no second half to this any more: the collector
        // used to need telling as well, because the `query_lists` that found the
        // line a moment ago had emitted a chip for it, and since plan 0046 the
        // only thing a link can be is a list.
        runtime.context.forgetLine(known.line.id);
      } catch (error) {
        failure = error;
        break;
      }
    }

    if (removed.length > 0) {
      runtime.context.invalidate(list.listId);
      // Rule A3, and plan 0043 section 5: the link is the **list** they came
      // off. Since plan 0046 that is the only thing a link can ever be, so the
      // deleted lines cannot be linked to and there is nothing to forget: the
      // list surviving a deletion was the behaviour plan 0043 wanted all along.
      runtime.link.list(list);
    }

    if (failure !== undefined) {
      const { reason } = refused(failure, 'remove that line');
      return {
        ok: false,
        list: list.listName,
        // Exactly what happened. **It never claims a rollback it did not
        // perform** (section 3.5): a wrong sentence about what is on the list is
        // the worst output this feature can produce.
        removed,
        stillThere: resolved
          .slice(removed.length)
          .map((known) => known.line.content),
        reason,
        message:
          removed.length > 0
            ? 'Some of them went and the rest are still on the list. Say exactly that, naming which is which. Nothing was put back.'
            : 'Nothing was removed.',
      };
    }

    return { ok: true, list: list.listName, zone: list.zoneName, removed };
  },
};

// ---------------------------------------------------------------------------
// 0047.4 settle_lines
// ---------------------------------------------------------------------------

/**
 * The same sentence said out loud, mapped onto a settlement (plan 0047, section
 * 2.4).
 *
 * It replaced `set_line_status`, whose subject went with the trip status a zone
 * line no longer carries. The array shape and the resolution rule plan 0043 gave
 * that tool are unaffected and are kept verbatim: ids from this turn or nothing
 * is written, and every line they named goes in one call.
 *
 * The third value is gone with the state machine. "Put the bread back" is a
 * quantity, not an outcome, and nothing here writes one: the person is looking at
 * the screen that has the control on it.
 */
const settleLines: AssistantTool = {
  declaration: {
    name: 'settle_lines',
    description:
      'Record that lines were bought, or that the shop did not have them. It works only with line ids that came back from query_lists in this same turn, so look the list up first and never write an id yourself. Pass every line they mentioned in one call: "we have got the milk and the bread" is one call with two ids. Do not ask them to confirm first, and do not ask afterwards either: they are looking at the screen it changes.',
    parameters: {
      type: 'object',
      properties: {
        lineIds: {
          type: 'array',
          minItems: 1,
          maxItems: LINE_BATCH_MAX_ITEMS,
          description:
            'The ids of the lines to settle, exactly as query_lists gave them to you in this turn.',
          items: { type: 'string' },
        },
        outcome: {
          type: 'string',
          enum: Object.values(SettlementOutcome),
          description:
            'BOUGHT when they have it: "got the milk", "we have got the bread", "that is in the trolley". NOT_AVAILABLE when the shop did not have it: "they had no eggs", "there was none left". These two are not the same thing and must never be swapped: BOUGHT means that errand is done and takes the units off what is still wanted, NOT_AVAILABLE means somebody still has to go somewhere else for it and changes nothing about how many are needed.',
        },
        quantity: {
          type: 'integer',
          minimum: 1,
          description:
            'How many were bought, when they said a number: "I got two of the milk". Leave it out for "we got the milk", which is one. It has no meaning when the shop did not have it, so do not send it then.',
        },
      },
      required: ['lineIds', 'outcome'],
    },
  },

  async execute(args, runtime) {
    const outcome = readOutcome(args['outcome']);
    if (outcome === undefined) {
      return {
        ok: false,
        problem: 'that is not something that can happen to a line',
      };
    }
    const quantity = readQuantity(args['quantity']);
    if (quantity !== undefined && outcome === SettlementOutcome.NOT_AVAILABLE) {
      // Refused here rather than passed on, because core refuses it too and the
      // model has plainly misread the two fields for each other.
      return {
        ok: false,
        problem:
          'a line the shop did not have carries no quantity. Say what happened, or say how many they bought, not both',
      };
    }

    const ids = readIds(args['lineIds']);
    if (ids.length === 0) {
      return blocked(
        runtime,
        'Nothing was changed, because no line was named. Call query_lists and use the ids it gives you.'
      );
    }

    // The same rule as the deletion, identical in shape and one level lighter in
    // consequence (section 4): ids from this turn, or nothing is written.
    const resolved: KnownLine[] = [];
    for (const id of ids) {
      const known = runtime.context.knownLine(id);
      if (known === undefined) {
        return blocked(
          runtime,
          'Nothing was changed, because you named a line this turn has not read. Call query_lists first and use the ids it gives you.',
          { notInContext: true }
        );
      }
      resolved.push(known);
    }

    const scopedList = runtime.context.scopedList;
    if (
      scopedList !== undefined &&
      resolved.some((known) => known.list.listId !== scopedList.listId)
    ) {
      runtime.noteForRecord({ refused: true });
      return outOfScope(scopedList);
    }

    // **No confirmation**, and that is a decision rather than an omission: it is
    // visible, it is one tap to put right on the screen they are looking at, and
    // confirming every "got it" is nagging.
    const results: SettleResult[] = [];
    const touched = new Set<string>();
    let firstFailure: unknown;

    for (const known of resolved) {
      try {
        const { line, settlement } = await runtime.api.settleLine(
          runtime.context.caller,
          known.line.id,
          outcome,
          quantity
        );
        touched.add(known.list.listId);
        runtime.link.list(known.list);
        results.push({
          product: line.content,
          // The server's values, reported rather than assumed to be the ones
          // that were asked for: how many it recorded, and how many are still
          // wanted afterwards, which is what makes a partial settle sayable.
          settled: settlement.quantity,
          stillWanted: line.quantity,
          list: known.list.listName,
        });
      } catch (error) {
        firstFailure ??= error;
        const { reason } = refused(error, 'that');
        results.push({ product: known.line.content, refused: true, reason });
      }
    }

    for (const listId of touched) {
      runtime.context.invalidate(listId);
    }

    if (touched.size === 0 && firstFailure !== undefined) {
      // Nothing was written and something was refused, so the call refused: the
      // API's own localized sentence is the answer rather than an envelope
      // describing a partial success that did not happen.
      return refused(firstFailure, 'change that');
    }

    if (touched.size > 0) {
      runtime.noteForRecord({ list: [...touched].join(',') });
    }

    return { ok: true, outcome, lines: results };
  },
};

export const ASSISTANT_TOOLS: AssistantTool[] = [
  upsertLines,
  queryLists,
  removeLines,
  settleLines,
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
 * All four of the plan's tools are here now that plan 0043 has built
 * `remove_lines` and the tool plan 0047 turned into `settle_lines`. Both belong
 * on this list for the reason `rename_me` does not: they are operations on a
 * list, and taking something off the list in front of you or saying you have got
 * it is among the likeliest things to be said into that microphone.
 */
export const SCOPED_TOOLS: AssistantTool[] = [
  upsertLines,
  queryLists,
  removeLines,
  settleLines,
];

export const TOOL_DECLARATIONS: ModelToolDeclaration[] = ASSISTANT_TOOLS.map(
  (tool) => tool.declaration
);

export const SCOPED_TOOL_DECLARATIONS: ModelToolDeclaration[] =
  SCOPED_TOOLS.map((tool) => tool.scopedDeclaration ?? tool.declaration);

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
 * Matching is the same {@link matchByName} list resolution uses, so a name that
 * matches the scoped list loosely **is** the scoped list. Strict normalized
 * equality was a second way to fail the promise this backstop exists to keep
 * (plan 0046, section 5.3): a model writing "the shopping list" for a list called
 * "Compra semanal" was told it was out of scope, and then told the person to go
 * and find the other list, which is the very thing a scope is meant to prevent.
 *
 * A call that named nothing is not out of scope: it meant the list on the screen,
 * which is the only one. And a call naming a genuinely different list is still
 * refused, which is the whole job.
 *
 * It survives section 5.2's scoped declarations because a model can still put a
 * `list` key in a call whose schema has no such property.
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
    matchByName([scoped], named).length === 0
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

/** What one line of a `settle_lines` call ended up saying. */
interface SettleResult {
  product: string;
  /** Units recorded, and 0 when the shop did not have it. */
  settled?: number;
  /** What the line still asks for afterwards, which a partial settle leaves. */
  stillWanted?: number;
  list?: string;
  refused?: true;
  reason?: string;
}

/**
 * A call this service refused, before anything reached the gateway (plan 0043,
 * section 6).
 *
 * Recorded as a refusal rather than as a failure, because "the model tried to
 * delete lines it had not read" and "the gateway said no" are different facts
 * about the prompt, and the first one is the number to watch. The model is told
 * plainly enough that its next move is the tool call that would have made the
 * request legal, rather than an apology.
 */
function blocked(
  runtime: ToolRuntime,
  message: string,
  extra: Record<string, unknown> = {}
): unknown {
  runtime.noteForRecord({ refused: true });
  return { ok: false, blocked: true, ...extra, message };
}

/** The ids of a call, in the order given, without the repeats. */
function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of value) {
    const id = readString(entry);
    if (id !== undefined && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * The outcome asked for, or `undefined` for anything that is not one of the two.
 *
 * Matched against the enum rather than lowercased and mapped, because the two
 * values are what the tool schema offers and what the gateway takes, and a
 * spelling this does not recognize is a call that should fail here rather than
 * be turned into whichever of the two looks closest.
 */
function readOutcome(value: unknown): SettlementOutcome | undefined {
  const wanted = readString(value);
  return Object.values(SettlementOutcome).find((outcome) => outcome === wanted);
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

/**
 * A count a tool argument carries, or `undefined` when it carries none.
 *
 * Shared by `upsert_lines` and `settle_lines`. Anything that is not a number at
 * least one is dropped rather than refused, and the caller then uses its own
 * default: a model that answered "a couple" has still said the thing was bought,
 * and losing the count is a smaller error than losing the purchase.
 */
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
