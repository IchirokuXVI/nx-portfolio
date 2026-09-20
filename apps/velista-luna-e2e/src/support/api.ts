import { expect, request, type APIRequestContext } from '@playwright/test';
import {
  DEMO_PASSWORD,
  ITEM_BREAD_ID,
  ITEM_MILK_ID,
  LINE_APPLES_ID,
  LINE_BREAD_ID,
  LINE_EGGS_ID,
  LINE_MILK_ID,
  LINE_NAILS_ID,
  LIST_GROCERIES_ID,
  LIST_HARDWARE_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import { GATEWAY_URL } from '../../playwright.config';

/**
 * The gateway, for what a spec sets up before it opens a page and reads back
 * after it acted (velista plan 0080, section 2). Each helper names the route it
 * calls. Nothing under test goes through here: the browser drives the app, and
 * this file only puts the world in a known state and reads what the app wrote.
 *
 * Every response is bare (the gateway wraps only the zone handshake routes in
 * `{ tokens, data }`, and no helper here calls one), and every paged read is
 * `{ items, nextCursor }`.
 */

/** A signed in user: a request context carrying their bearer token. */
export class Session {
  constructor(
    readonly ctx: APIRequestContext,
    readonly userId: string,
    readonly accessToken: string
  ) {}

  private get headers() {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.ctx.get(path, { headers: this.headers });
    await expect(res, `GET ${path}`).toBeOK();
    return (await res.json()) as T;
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const res = await this.ctx.post(path, { headers: this.headers, data });
    await expect(res, `POST ${path}`).toBeOK();
    return (await res.json()) as T;
  }

  async patch<T>(path: string, data: unknown): Promise<T> {
    const res = await this.ctx.patch(path, { headers: this.headers, data });
    await expect(res, `PATCH ${path}`).toBeOK();
    return (await res.json()) as T;
  }

  async delete(path: string): Promise<void> {
    const res = await this.ctx.delete(path, { headers: this.headers });
    await expect(res, `DELETE ${path}`).toBeOK();
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

/** `POST /v1/auth/login` as a demo user (they all share DEMO_PASSWORD). */
export async function login(email: string): Promise<Session> {
  const ctx = await request.newContext({
    baseURL: GATEWAY_URL,
    ignoreHTTPSErrors: true,
  });
  const res = await ctx.post('/v1/auth/login', {
    data: { email, password: DEMO_PASSWORD },
  });
  await expect(res, `login as ${email}`).toBeOK();
  const body = (await res.json()) as { userId: string; accessToken: string };
  return new Session(ctx, body.userId, body.accessToken);
}

export const ALICE_EMAIL = 'alice@example.com';
export const DANA_EMAIL = 'dana@example.com';

// --- Zone lines --------------------------------------------------------------

export interface LineView {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  itemIds: string[];
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  version: number;
}

export interface LineSettlementView {
  id: string;
  lineId: string;
  itemId: string | null;
  outcome: 'BOUGHT' | 'NOT_AVAILABLE';
  quantity: number;
  settledAt: string;
  revertedAt: string | null;
}

/** `GET /v1/lists/:id/lines`: every line of a zone list. */
export async function listLines(
  s: Session,
  listId: string
): Promise<LineView[]> {
  const page = await s.get<{ items: LineView[] }>(
    `/v1/lists/${listId}/lines?limit=100`
  );
  return page.items;
}

/** `GET /v1/lists/:id/lines`, then the one line asked for. */
export async function readLine(
  s: Session,
  listId: string,
  lineId: string
): Promise<LineView> {
  const line = (await listLines(s, listId)).find((l) => l.id === lineId);
  if (!line) throw new Error(`line ${lineId} is not on list ${listId}`);
  return line;
}

/** `PATCH /v1/lines/:id`: the absolute quantity a zone line asks for. */
export async function setLineQuantity(
  s: Session,
  lineId: string,
  quantity: number
): Promise<LineView> {
  return s.patch<LineView>(`/v1/lines/${lineId}`, { quantity });
}

/** `PATCH /v1/lines/:id`: the whole product set of a zone line, replaced. */
export async function setLineProducts(
  s: Session,
  lineId: string,
  itemIds: string[]
): Promise<LineView> {
  return s.patch<LineView>(`/v1/lines/${lineId}`, { itemIds });
}

/** `POST /v1/lines/:id/approval`: approve a pending line. */
export async function approveLine(
  s: Session,
  lineId: string
): Promise<LineView> {
  return s.post<LineView>(`/v1/lines/${lineId}/approval`, {
    approvalStatus: 'APPROVED',
  });
}

/** `DELETE /v1/lines/:id`. */
export async function deleteLine(s: Session, lineId: string): Promise<void> {
  await s.delete(`/v1/lines/${lineId}`);
}

/** `GET /v1/lines/:id/settlements`: a zone line's settlement history, newest first. */
export async function lineSettlements(
  s: Session,
  lineId: string
): Promise<LineSettlementView[]> {
  const page = await s.get<{ items: LineSettlementView[] }>(
    `/v1/lines/${lineId}/settlements?limit=100`
  );
  return page.items;
}

// --- Shopping profile --------------------------------------------------------

interface ShoppingProfileView {
  id: string;
  isDefault: boolean;
  postalCodes: { postalCode: string }[];
}

/**
 * `GET /v1/account/shopping-profiles`, then `POST .../:id/postal-codes` on the
 * default one unless it already lists the code. The demo store sits in 46004,
 * and a basket has a price scope only when the profile can see a shop.
 */
export async function ensurePostalCode(
  s: Session,
  postalCode: string
): Promise<void> {
  const { profiles } = await s.get<{ profiles: ShoppingProfileView[] }>(
    '/v1/account/shopping-profiles'
  );
  const profile = profiles.find((p) => p.isDefault) ?? profiles[0];
  if (!profile) throw new Error('the user has no shopping profile');
  if (profile.postalCodes.some((c) => c.postalCode === postalCode)) return;
  await s.post(`/v1/account/shopping-profiles/${profile.id}/postal-codes`, {
    postalCode,
    country: 'ES',
  });
}

// --- Baskets -----------------------------------------------------------------

export interface GeneratedListSummary {
  id: string;
  name: string | null;
  status: 'OPEN' | 'FINISHED' | 'ARCHIVED';
}

/** `GET /v1/generated-lists`: the user's own baskets, live and finished. */
export async function listBaskets(s: Session): Promise<GeneratedListSummary[]> {
  const page = await s.get<{ items: GeneratedListSummary[] }>(
    '/v1/generated-lists?includeArchived=true&limit=50'
  );
  return page.items;
}

/**
 * `PATCH /v1/generated-lists/:id` to FINISHED on every open basket.
 *
 * An open basket claims the zone lines it carries, so a spec that reads a claim
 * needs every earlier basket out of the way first. It no longer clears the way
 * for a **run**: backend `0133` section 7 deleted the rule that refused a line
 * another basket of the owner's was holding.
 */
export async function finishOpenBaskets(s: Session): Promise<void> {
  for (const basket of await listBaskets(s)) {
    if (basket.status === 'OPEN') {
      await s.patch(`/v1/generated-lists/${basket.id}`, {
        status: 'FINISHED',
      });
    }
  }
}

export interface BasketLineView {
  id: string;
  content: string;
  quantity: number;
  settledQuantity: number;
}

/** `GET /v1/generated-lists/:id/basket`: the basket as a participant reads it. */
export async function readBasketLines(
  s: Session,
  basketId: string
): Promise<BasketLineView[]> {
  const body = await s.get<{ lines: BasketLineView[] }>(
    `/v1/generated-lists/${basketId}/basket`
  );
  return body.lines;
}

/** `GET /v1/generated-lists/:id/share-link`: the link, if one exists. */
export async function readShareLink(
  s: Session,
  basketId: string
): Promise<{ secret: string } | undefined> {
  const body = await s.get<{ link?: { secret: string } }>(
    `/v1/generated-lists/${basketId}/share-link`
  );
  return body.link;
}

// --- The world every spec starts from ----------------------------------------

/** The five seeded lines, and what each one asks for at the start of a spec. */
export const SEEDED_QUANTITIES: Record<string, number> = {
  [LINE_MILK_ID]: 2,
  [LINE_BREAD_ID]: 1,
  [LINE_EGGS_ID]: 12,
  [LINE_NAILS_ID]: 100,
};

/**
 * Put Alice's household in the state section 5 of the plan describes, as
 * absolute values rather than deltas, so the suite passes on a fresh database
 * and on the run after it:
 *
 * - every live basket of hers finished, so the lines are free to be drawn again;
 * - any line an earlier run added to Groceries or Hardware deleted;
 * - Milk asking for 2 and carrying Bread as a second product, Bread approved,
 *   Eggs and Nails back at their seeded amounts;
 * - postal code 46004 on her default profile, where the demo store is.
 */
export async function resetAliceWorld(alice: Session): Promise<void> {
  await finishOpenBaskets(alice);

  const seeded = new Set([
    LINE_MILK_ID,
    LINE_APPLES_ID,
    LINE_BREAD_ID,
    LINE_EGGS_ID,
    LINE_NAILS_ID,
  ]);
  for (const listId of [LIST_GROCERIES_ID, LIST_HARDWARE_ID]) {
    for (const line of await listLines(alice, listId)) {
      if (!seeded.has(line.id)) await deleteLine(alice, line.id);
    }
  }

  const groceries = await listLines(alice, LIST_GROCERIES_ID);
  const bread = groceries.find((l) => l.id === LINE_BREAD_ID);
  if (bread?.approvalStatus === 'PENDING')
    await approveLine(alice, LINE_BREAD_ID);

  for (const [lineId, quantity] of Object.entries(SEEDED_QUANTITIES)) {
    await setLineQuantity(alice, lineId, quantity);
  }
  await setLineProducts(alice, LINE_MILK_ID, [ITEM_MILK_ID, ITEM_BREAD_ID]);

  await ensurePostalCode(alice, '46004');
}
