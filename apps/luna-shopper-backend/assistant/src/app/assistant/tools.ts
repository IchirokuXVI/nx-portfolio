import {
  LineApprovalStatus,
  LineStatus,
  ListResolutionBranch,
  UsernamePropagation,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type { ModelToolDeclaration } from '../provider/model-provider';
import { GatewayApiClient, GatewayApiError } from './gateway-api.client';
import { normalize, resolveList, type ContextList } from './list-resolution';
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
// 6.1 upsert_line
// ---------------------------------------------------------------------------

const upsertLine: AssistantTool = {
  declaration: {
    name: 'upsert_line',
    description:
      "Add something to one of this person's shopping lists, or change the quantity of something already on it. Use it whenever they ask for something to be put on a list. Give the product exactly as they said it. Only name a list or a zone that appears in the context you were given; if they did not say which list and the context does not make it obvious, call this anyway with no list and you will be told to ask.",
    parameters: {
      type: 'object',
      properties: {
        product: {
          type: 'string',
          description:
            "The thing to buy, in this person's own words, without the quantity.",
        },
        quantity: {
          type: 'integer',
          minimum: 1,
          maximum: 100000,
          description: 'How many. Omit when they did not say.',
        },
        list: {
          type: 'string',
          description:
            'The name of the list, exactly as it appears in the context. Omit when they did not name one.',
        },
        zone: {
          type: 'string',
          description:
            'The name of the zone, when they named one and it narrows which list is meant.',
        },
      },
      required: ['product'],
    },
  },

  async execute(args, runtime) {
    const product = readString(args['product']);
    if (!product) {
      return { ok: false, problem: 'no product was given' };
    }

    const resolution = resolveList({
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
    const quantity = readQuantity(args['quantity']);

    try {
      // Edit before add, which is what makes this an upsert: asking for milk
      // twice should change a number, not leave two milks on the list.
      const existing = findSameProduct(
        await runtime.context.lines(list.listId),
        product
      );

      const line = existing
        ? await runtime.api.updateLine(runtime.context.caller, existing.id, {
            content: product,
            ...(quantity !== undefined ? { quantity } : {}),
          })
        : await runtime.api.addLine(runtime.context.caller, list.listId, {
            content: product,
            ...(quantity !== undefined ? { quantity } : {}),
          });

      runtime.context.invalidate(list.listId);
      runtime.references.line(list, line.id, line.content);

      return {
        ok: true,
        action: existing ? 'updated' : 'added',
        product: line.content,
        quantity: line.quantity,
        list: list.listName,
        zone: list.zoneName,
        // Plan 0037: a list may hold new lines pending somebody's approval, and
        // the person who asked deserves to be told their milk is waiting rather
        // than to find out in the shop.
        awaitingApproval: line.approvalStatus === LineApprovalStatus.PENDING,
      };
    } catch (error) {
      return refused(error, 'add that to the list');
    }
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
  upsertLine,
  queryLists,
  renameMe,
];

export const TOOL_DECLARATIONS: ModelToolDeclaration[] = ASSISTANT_TOOLS.map(
  (tool) => tool.declaration
);

export function findTool(name: string): AssistantTool | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.declaration.name === name);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

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
