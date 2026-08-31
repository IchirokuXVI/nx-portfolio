# 0005 (backlog) The assistant, and talking to it

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

**Low priority, by the owner's own ranking.** Recorded now because the decision it forces, that
the assistant is a client of the public API and not a second way into the database, is much
cheaper to hold from the start than to retrofit.

A conversational assistant that fills a zone's lists ("add milk, eggs and two kilos of tomatoes
to the flat list") and explains the app to whoever is lost in it, reachable by typing or by
speaking. Depends on 0019 for the reason given in section 2, and is far more useful after
0048, 0049 and backlog 0004, since half of what a user would want to say to it is about baskets and
prices.

## 1. The rule the whole plan hangs on

> The assistant calls the same HTTP API the app calls, with the caller's own token, and can
> therefore do exactly what that user could do by tapping, and nothing more.

No direct database access, no service to service shortcut, no privileged internal client. Every
authorization check, throttle, validation rule and event emission in 0004 through 0019 applies
without being restated. If the assistant tries to add a line to a list the user cannot write,
it gets the same 403 the app would get, and it says so.

The alternative, giving the assistant its own core connection for speed, was considered and
rejected outright: it would put a natural language interface in front of an unauthenticated
write path, which is the one architecture in this system that could lose someone else's data on
a misread sentence.

## 2. The tool catalog is the OpenAPI document

The assistant is a tool using loop, and its tools are the gateway's endpoints. Those endpoints
are already described, precisely and machine readably, by
`apps/luna-shopper-backend/gateway/docs/openapi.json`, the committed artifact from 0019 that CI
keeps in step with the code.

So the tool definitions are **generated from that document at build time**, not hand written.
The consequences are worth stating because they are the point:

- A new endpoint becomes a new assistant capability with no separate registration step.
- A changed request shape cannot leave the assistant calling the old one, because the same file
  that failed the pull request also feeds the generator.
- The set of things the assistant can do is reviewable as a list, in a file, in a diff.

A curated allowlist sits on top: not every endpoint belongs in a chat, and section 7 says which
ones are excluded on purpose. The allowlist names patterns; the shapes still come from the
document.

If the tool count grows past what is comfortable to send on every request, the Anthropic API's
tool search (mark most tools `defer_loading: true` and let the model search them) is the escape
hatch, and it is another reason the catalog wants to be generated rather than curated by hand.

## 3. Where it runs

**A new `luna-shopper-backend-assistant` service**, for the same reasons backlog 0001 section 4
gave the harvester its own: it holds a provider credential nothing else needs, its failure mode
(a slow or unavailable third party) must not degrade the gateway, its resource profile is long
lived streaming connections rather than short requests, and its cost is per call in a way no
other service's is.

It exposes a small surface of its own (start a conversation, send a turn, stream the reply) and
calls the gateway over HTTP for everything else, forwarding the user's token.

Rejected: a module inside the gateway. The gateway is the request path for the whole app, and a
provider outage or a runaway conversation would sit inside it.

## 4. The provider, the model, and the loop

Anthropic's API through the official TypeScript SDK (`@anthropic-ai/sdk`), which is the default
for this repository and fits a NestJS service directly.

- **Model**: `claude-opus-5` for the conversation. A cheaper model (`claude-haiku-4-5`) is worth
  measuring for narrow, high volume side tasks such as classifying whether a turn is even a
  request to act, but the conversation itself is the product and starts on the strong model.
- **Thinking**: adaptive (`thinking: { type: 'adaptive' }`), with `output_config.effort` tuned
  down for routine turns. Most turns here are short and mechanical; a few (splitting a rambling
  paragraph into eight list lines with quantities) are not.
- **Streaming**, always. The user is waiting, and a spoken reply cannot begin until text does.
- **The loop**: the SDK's tool runner (`client.beta.messages.toolRunner`) rather than a hand
  written `while (stop_reason === 'tool_use')`, because its per turn hooks are exactly where the
  confirmation gate in section 7 belongs. A manual loop stays the fallback if the hooks do not
  fit.
- **Prompt caching** on the stable prefix: the system prompt and the tool definitions are
  identical across every turn of every user and are large, which is the textbook case. Volatile
  content (the current zone, the user's lists, the time) goes after the last cache breakpoint,
  never inside the cached prefix, or the cache never hits.

The provider sits behind an interface in the service, with a fake implementation used by every
test. **No test in this repository may reach a model provider**, for the same reason 0015's
suites bring their own stack: a test whose result depends on a paid third party is a test that
will be deleted the first week it is flaky.

## 5. What it is allowed to know

Context is assembled per turn, from the caller's own token and nothing else: their zones, the
lists they can write, the pending lines of the zone being discussed, their shopping preferences
(0048). It never sees another user's data, and it never sees a zone the caller is not an
approved member of, because it fetches all of it through the same API with the same token.

Conversation state lives in the assistant's own database: `Conversation` (owner, optional zone,
title, status) and `ConversationTurn` (role, content, tool calls, token usage). Two reasons it is
stored rather than kept in the client: a spoken interaction is worthless if it forgets the last
sentence when the phone locks, and the token usage per turn is how section 8's quota is enforced
at all.

Retention is bounded and the user can delete a conversation, which really deletes it. Account
deletion (0011) takes the conversations with it, and that belongs in 0011's checklist when this
plan is picked up.

## 6. Voice

Voice is two separable problems and only one of them is Anthropic's.

- **Speech to text**: not a Messages API feature. Two paths: the browser's own speech recognition
  (free, zero infrastructure, quality and availability vary by browser, and it is a plain
  fallback to typing when missing), or a server side transcription provider (consistent,
  costs money and adds a second vendor). **Start with the browser**, behind an interface, so the
  service receives text either way and the decision can be revisited without touching the
  assistant's logic at all.
- **Text to speech**: the reply is text. Speaking it is the client's job through the browser's
  speech synthesis, and it is optional. A user who wants to talk but read is a normal user.

The design consequence for the backend is small and worth stating plainly: **the assistant takes
text and returns text**, and voice is a client capability layered on top. That is what keeps
voice from being a rewrite.

What voice does change is the prompting. Dictated sentences arrive as one run on paragraph with
no punctuation and with transcription errors, so "add milk eggs and two kilos of tomatoes to the
flat list" must split cleanly, and a misheard word must produce a question rather than a wrong
line. The system prompt is written for that input, and the fixture set is dictated transcripts,
not typed ones.

## 7. Safety, in the ordinary sense

Not model safety, which the provider handles. The risk here is a confident assistant quietly
changing shared data on a misunderstanding.

- **Reads run freely.** Answering "what is left on the flat list" needs no ceremony.
- **Single writes are confirmed in the conversation** by default: the assistant says what it is
  about to add and does it on the next turn. A per user setting can relax this for adds, which
  are the cheap, obvious case, and the setting never applies to the rest.
- **Bulk and destructive operations always confirm**, with no setting to turn that off:
  deleting lines, deleting a list, applying statuses back to origins (0049 section 6).
- **Excluded from the tool catalog entirely**: zone governance (approve, kick, ban, roles,
  ownership transfer), account operations (deletion, merge, username changes), and every
  platform admin endpoint from 0012. These are decisions about people, and a chat is the wrong
  place to make them by accident. The assistant may explain how to do them and point at the
  screen that does.
- Every write the assistant makes is attributed to the user in the ordinary way, and emits the
  ordinary realtime events, so the rest of the zone sees a normal edit. Whether the audit trail
  should record that a change came from the assistant is an open decision in section 9.

## 8. Cost, quota, and abuse

The first feature in this system with a marginal cost per use, so the controls are part of the
design rather than a later reaction.

- Per user and per day token quotas, stored on the conversation turns, enforced before the call.
- The throttler from 0004 section 8, with its own tighter limits.
- A cap on tool calls per turn and on turns per conversation, so a loop that misunderstands
  itself cannot run up a bill unattended.
- Token usage recorded per turn, and the tracing and metrics from 0016 extended to cover
  provider latency, token spend and tool call counts. A feature whose cost is invisible is a
  feature nobody notices going wrong.
- Whether temporary users (0005) get the assistant at all is an open decision, and the cheapest
  abuse control available is to say no.

## 9. Open decisions

- Whether temporary users may use it.
- Server side speech to text, and which provider, if the browser proves inadequate. Deferred
  until there is a real complaint.
- Whether assistant made changes are marked as such in the data, or are indistinguishable from
  hand made ones. Leaning marked, since "why is there milk on the list" is a question somebody
  will ask.
- Whether the assistant can act across zones in one conversation, or is scoped to one zone at a
  time. Leaning scoped, because it makes "the flat list" unambiguous.
- Localization of the assistant's replies: the request locale is already resolved (0004 section
  12) and can be passed in the system prompt, but the model will follow the user's own language
  regardless, so the two need to agree.

## 10. Exit criteria

- The assistant performs every action through the gateway with the caller's token, and an action
  the user could not perform by hand fails with the ordinary error.
- Its tools are generated from the committed OpenAPI document plus an explicit allowlist, and
  adding an endpoint needs no assistant side registration.
- Governance, account and platform admin endpoints are absent from the catalog, not merely
  discouraged in the prompt.
- A user can populate a zone list by dictating one unpunctuated sentence, and gets a question
  rather than a wrong line when a word is ambiguous.
- Bulk and destructive operations are confirmed in conversation, always.
- Conversations persist across app restarts, are deletable, and go away with the account.
- Token spend, tool calls and provider latency are visible in the metrics from 0016, and per
  user quotas stop a runaway conversation.
- Every test runs against a fake provider, and the suite passes with no network access.
- Voice is a client capability over a text in, text out backend, so removing it changes no
  server code.
