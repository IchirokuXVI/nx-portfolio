import { expect, request, test } from '@playwright/test';
import { GATEWAY_URL } from '../playwright.config';
import { expectDocumentedShape } from './support/contract';
import { gateOnStack } from './support/db';

/**
 * Google sign in against a running stack (plan 0023, section 7).
 *
 * What can be driven here and what cannot is worth stating plainly. The hop to
 * Google needs a real consent screen and a real user, so no suite can complete
 * it; the compose stack runs with fictional OAuth credentials precisely so the
 * routes are live without pretending otherwise.
 *
 * What that leaves is everything on this side of the redirect, and it is the half
 * where the bugs were: the state mint and the guard on it (section 4.2), and the
 * callback's promise that it never answers with a body and never strands the user
 * on the API's origin (section 3.3). The remaining assertion, that a guest keeps
 * their `userId` through a completed sign in, is covered by the unit test that the
 * callback calls `googleLogin` with the `linkUserId` the state carried, since that
 * parameter is the whole of what makes it true.
 *
 * Infra-gated through the shared `gateOnStack`, so with no stack up this is a
 * clean skip and under LUNA_REQUIRE_STACK a failure.
 */
test.describe('Luna Shopper Google sign in', () => {
  test.beforeAll(async () => {
    await gateOnStack();
  });

  test('mints a state for a guest, and carries them rather than replacing them', async () => {
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    // A guest with something to lose: a zone, owned by a temporary identity that
    // has no password and no address, so an account minted alongside it would be
    // unreachable forever.
    const createRes = await ctx.post('/v1/zones', {
      data: { name: 'Google E2E Zone', username: 'owner' },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const guestToken: string = created.tokens.accessToken;

    const stateRes = await ctx.post('/v1/auth/google/state', {
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    expect(stateRes.status()).toBe(201);
    const minted = await stateRes.json();
    expectDocumentedShape('post', '/v1/auth/google/state', 201, minted);
    expect(typeof minted.state).toBe('string');
    expect(minted.state.length).toBeGreaterThan(0);

    // Opaque, and it has to be: anything the client could read out of it is
    // something the client could also have written.
    expect(minted.state).not.toContain(created.data.id);
  });

  test('mints a state for a caller with no token at all', async () => {
    // The genuine sign in from scratch. It carries nobody, and that is correct.
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    const res = await ctx.post('/v1/auth/google/state');

    expect(res.status()).toBe(201);
    expect(typeof (await res.json()).state).toBe('string');
  });

  test('refuses a stale token instead of minting an anonymous state', async () => {
    // The regression section 4.2 exists for. Waved through as anonymous, this
    // caller would come back from Google on a brand new account with every zone
    // they own orphaned behind the identity the stale token belonged to.
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    const res = await ctx.post('/v1/auth/google/state', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });

    expect(res.status()).toBe(401);
  });

  test('the callback redirects to the app rather than answering with a body', async () => {
    // Arriving with no code and a state nobody minted is every failure mode at
    // once. The response must still be a redirect into the app: a page rendered
    // on the API's origin is one the user has no way back from, and the app never
    // learns the flow ended.
    //
    // It is also the one case a unit test cannot reach, which is why it is here.
    // `passport-oauth2` reads a request with no code as a request to start the
    // flow, so with credentials set the callback used to answer this with a 302
    // to Google's consent screen, from inside the guard, before any of the
    // controller ran. The guard now asks for a code first.
    const ctx = await request.newContext({
      baseURL: GATEWAY_URL,
      maxRedirects: 0,
    });

    const res = await ctx.get('/v1/auth/google/callback?state=never-minted');

    expect(res.status()).toBe(302);
    const location = res.headers()['location'];
    expect(location).toBeTruthy();
    expect(location).toContain('/auth/callback#');
    expect(location).toContain('error=');
    // Not this origin. That is the entire point of the redirect.
    expect(location.startsWith(GATEWAY_URL)).toBe(false);
    // And no body to mistake for one.
    expect(await res.text()).toBe('');
  });
});
