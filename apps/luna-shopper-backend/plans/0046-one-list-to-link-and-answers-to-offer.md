# 0046 One list to link, and answers to offer

> **A link is only useful when there is one place to go.** Plan `0039` rule A3 emits a
> reference for every zone, list and line a turn touched, and the panel draws a chip for
> each. In practice that is a row of chips under a one sentence answer, two of which lead
> to the same screen, and none of which is the one thing the person wanted next.
>
> This plan cuts the answer's outgoing links to **at most one, always a list, and only
> when the turn narrowed to a single one**. In exchange it adds the thing the panel has
> never had: when the assistant ends a turn with a question, the **answers to that
> question** come back with it, so the person taps one instead of typing a list name back.
>
> It also names the zone. A list called "Compra" in two zones is two different lists, and
> an answer that says only "Compra" is ambiguous to everybody except the person who has
> one zone.
>
> And it fixes a real defect from plan `0044`: a turn scoped to one list **still asks
> which list**, because the scope narrowed the catalog and not the tool descriptions the
> model reads.
>
> Prerequisite reading: plan `0039` sections 6.1, 7 and 8, plan `0043` section 5, plan
> `0044` sections 2.1 and 2.2, and velista `0042`, which is the caller and the other half
> of this plan.

## 1. What is being built

Four changes, in one wire release:

1. **`references` becomes `link`.** Zero or one, always a list, never a line, never a zone.
2. **`choices` is new.** The answers to a question the turn asked, emitted from the tool
   result that asked it, never written by the model.
3. **The zone is named**, in the sentence and on the link, when the caller has more than
   one zone.
4. **A scoped turn stops asking which list**, which plan `0044` said it already did.

Nothing about the tool catalog, the gateway routes, the rate limit, the transcript cap or
the turn record changes.

## 2. One link, and it is a list

### 2.1 The shape

```ts
/** Where an answer can send somebody, when there is exactly one such place. */
export interface AssistantListLink {
  readonly zoneId: string;
  readonly listId: string;
  /** The list's own name, as the gateway returned it. */
  readonly label: string;
  /**
   * The zone's name, when the caller is in more than one zone. Null otherwise,
   * because naming the only zone somebody is in is noise.
   */
  readonly zoneLabel: string | null;
}
```

`AssistantTurnResponse.references: AssistantReference[]` is **replaced** by
`link: AssistantListLink | null`. `AssistantReference` and `AssistantReferenceKind` go
with it, along with their schemas and their entries in `ENUM_IDS`.

### 2.2 Why lines go

A line reference addressed the list it is on plus a query parameter, so a chip for a line
and a chip for its list led to the same screen, one of them scrolled. The reply already
says the thing ("the olive oil is still to buy"); what the link is for is **going to where
that is true**, and that place is the list.

There is a second reason, and it is the one that shows in a transcript: a turn that read a
whole list emitted up to twenty line references, which is not a set of links, it is a
table of contents nobody asked for.

### 2.3 Why zones go

Nothing emits one. `ReferenceCollector.zone` has no caller anywhere in the service, so the
zone branch has been dead since plan `0039` shipped. It is deleted rather than kept warm
for a caller that never arrived.

### 2.4 The narrowing rule

> A link is emitted only when every list the turn touched is the same list.

`ReferenceCollector` becomes `ListLinkCollector`, holding a set of `ContextList` keyed by
`listId`:

| What the turn did | What comes back |
| --- | --- |
| read or wrote one list | that list |
| read every list (a `query_lists` with no `list` argument) | `null` |
| touched two lists in two calls | `null` |
| called no tool at all (a refusal, a redirect, a chat) | `null` |
| asked which list | `null`, and the candidates come back as **choices** (section 4) |

The last row is what keeps the rule honest. The ASKED branch of `upsert_lines` currently
emits a list reference per candidate (`tools.ts`, the `needsList` result), which under this
rule would guarantee "several lists touched" on exactly the turn that most needs the
person to pick one. Candidates go to the choice collector and **never** to the link
collector.

`forgetLine` disappears with lines. Its job (plan `0043` section 5, do not link a line that
was just deleted) cannot arise when the only thing linked is a list, and the list surviving
a deletion was already the behaviour that plan wanted.

### 2.5 What the guarantee still is

Unchanged, and it is the reason this collector exists rather than a regex over the reply:
the id in `link` came back from the gateway **during this turn**, so the list exists, the
caller can see it, and the link cannot 404. The model is still never asked to write a link,
an id, or markdown, and the prompt still says so.

## 3. The zone in the sentence

### 3.1 The rule

> When the caller is in more than one zone, a list is named with its zone.

One fact decides two things, which is why it is computed in one place. The service knows
`context.zones.length` before the model is called:

- **In the prompt.** When there is more than one zone, the operator prompt gains a line
  under "How to write": `- A list belongs to a zone, and two zones can have a list with
  the same name. Whenever you name a list, say which zone it is in, the way a person
  would: "the weekly shop, in Casa".` When there is exactly one zone the line is absent,
  and nothing tells the model about zones it has no use for.
- **On the link.** `zoneLabel` is the zone's name under the same condition and `null`
  otherwise, so the client renders "Go to Compra semanal" or "Go to Compra semanal, in
  Casa" without owning the decision or counting anything.

### 3.2 The scoped turn is exempt, and gets it for free

`TurnContextFactory.openScoped` builds a context with one zone whose name is deliberately
empty (plan `0044` section 2.3: fetching the zone index to learn a name it does not use
would undo the saving the method exists for). One zone means the condition is false, so
`zoneLabel` is null and the prompt line is absent. There is no special case to write and
no empty string reaching a client.

### 3.3 `describeForModel` is unchanged

It already lists zones with their lists, which is what makes the rule followable. The rule
is about the reply, not about the context.

## 4. Answers you can tap

### 4.1 The shape

```ts
/** One answer to the question this turn ended with. */
export interface AssistantChoice {
  /** What the chip says. */
  readonly label: string;
  /** What the client sends as the next turn when somebody taps it. */
  readonly message: string;
}
```

`AssistantTurnResponse.choices: AssistantChoice[]`, always present, empty on every turn
that asked nothing.

Two fields rather than one, because they diverge the moment a choice is not a list name: a
confirmation's chip says "Yes" and sends something the resolver can act on. This plan emits
only list choices and both fields carry the same string in the common case, and the
contract is the place to not have to change the wire for the next one.

### 4.2 Where a choice comes from

This is rule A3 applied to a question instead of an answer:

> A choice is emitted by the tool result that asked the question. The model never writes
> one.

So a chip always names a list that exists, that the caller can see, and that the resolver
will match when it comes back. A chip the model invented would have none of those
properties, and the failure would be silent: the person taps it, the next turn cannot
resolve it, and the assistant asks the same question again.

There is exactly one emitter in this plan, `upsert_lines`' ASKED branch (plan `0039`
section 6.1, branch 4). `remove_lines`' confirmation (plan `0043` section 3.3) is the
obvious next one and is **not** in this plan: its chips are "yes" and "no", which are words
in the caller's language rather than data, and the service does not have a translation
surface. Section 9 says what that would take.

### 4.3 What a choice says and sends

For each candidate, in the order the context index holds them (zone order, then list
order):

- `label`: the list's name, or `"<list> · <zone>"` when the caller has more than one zone.
  The same condition as section 3, from the same count.
- `message`: the list's name, or `"<list> (<zone>)"` when two candidates share a name. The
  parentheses are for the resolver rather than for the reader: `resolveList` normalizes
  punctuation away and matches a candidate name contained in what was said, and the zone
  is what separates two lists called "Compra".

A tapped choice is an **ordinary typed turn** carrying that text. Nothing new happens on
the wire, the transcript reads like somebody answered the question, and resolution takes
the NAMED branch it already has.

### 4.4 The cap

At most **six** choices. Past that the tool emits none and the model asks in prose, as it
does today. Chips are a shortcut past typing a list name, not a menu system, and twenty
chips under a one sentence question is a worse thing to hand somebody standing in a shop
than the question on its own.

## 5. The defect: a scoped turn still asks which list

### 5.1 What happens

Plan `0044` section 2.1 promises that a scoped turn never asks which list, and the
enforcement is real: `upsert_lines` short circuits resolution to `ONLY_LIST` when
`context.scopedList` is set, so the ASKED branch is unreachable. The person still gets
asked, because the model asks **instead of calling the tool**, and enforcement inside a
tool cannot answer a question the model asked before reaching it.

The cause is one line:

```ts
export const SCOPED_TOOL_DECLARATIONS: ModelToolDeclaration[] =
  SCOPED_TOOLS.map((tool) => tool.declaration);
```

The scope narrows the **catalog** and not the **declarations**. A scoped turn therefore
still shows the model:

- `list` and `zone` parameters on `upsert_lines` and on `query_lists`, which say plainly
  that there is a choice of list to make; and
- `upsert_lines`' description, which ends: _"Only name a list or a zone that appears in the
  context you were given; if they did not say which list and the context does not make it
  obvious, call this anyway with no list and you will be told to ask."_

The model is being taught the question in the same breath the context tells it there is
only one list. Plan `0044`'s own argument (section 2.2: an absent capability is a much
harder boundary than an instruction) applies here exactly, and was applied to the tool set
and not to the tools' own text.

### 5.2 The fix

A tool declares **per scope**, so an absent parameter is genuinely absent:

```ts
interface AssistantTool {
  readonly declaration: ModelToolDeclaration;
  /** The same tool as a scoped turn sees it. Defaults to `declaration`. */
  readonly scopedDeclaration?: ModelToolDeclaration;
  execute(...): Promise<unknown>;
}
```

`SCOPED_TOOL_DECLARATIONS` maps `scopedDeclaration ?? declaration`. Two tools need one:

- **`upsert_lines`**: no `list`, no `zone`, and the sentence about being told to ask is
  replaced by _"There is one list and it is the one they are looking at. Never ask which
  list they meant."_
- **`query_lists`**: no `list`, no `zone`. "Omit to look at every list this person can
  see" becomes a description of the one list.

`remove_lines` and `set_line_status` take line ids and name no list, so they are unchanged.

### 5.3 The backstop stays, and stops misfiring

`namesAnotherList` compares a named list to the scoped one with strict normalized
equality, so a model that writes a paraphrase ("the shopping list" for "Compra semanal")
is told it is out of scope and then tells the person to go and find the other list. That is
a second way to fail the same promise, and it survives section 5.2 because a model can
still put a `list` key in a call whose schema has no such property.

It keeps its job (a call naming a genuinely different list is refused) and gets the
matching `resolveList` already uses: `matchByName` against the scoped list. A name that
matches it loosely is the scoped list, not another one.

### 5.4 The gateway leg is right, and is untested

`assistant.controller.ts` folds the `zoneId` and `listId` form fields into `scope`, both or
neither, and the frontend sends both (velista `0042` section 5). Nothing in
`assistant-voice.http.spec.ts` covers it, which is why a regression here would be silent.
The spec gains one case: a multipart voice request with both fields reaches the broker with
`scope` set, and one with only `zoneId` reaches it with `scope` undefined.

## 6. What does not change

- The tool catalog. Four tools scoped, five open, exactly as plan `0044` left them.
- Rule A1. The service still holds only the caller's own header and mints nothing.
- Rule A2. Still stateless, transcript on the request, nothing stored between turns.
- The rate limit, the transcription route, the audio caps, and `heard`.
- `listResolution` on the response. Still the branch that decided a write, still the
  measurement plan `0039` section 10 wanted.
- The turn record. A link, choices and a zone name are all made of things it already logs.

## 7. Contracts, docs and CI

- `libs/luna-shopper/contracts`: remove `AssistantReference` and `AssistantReferenceKind`
  and their schemas; add `AssistantListLink` and `AssistantChoice` with theirs; change
  `AssistantTurnResponse` to `{ reply, link, choices, listResolution?, heard? }` with
  `reply`, `link` and `choices` required. `link` is nullable, `choices` is an array that
  may be empty, and neither is optional: absent and empty meaning the same thing is a
  question every reader has to ask once.
- The gateway's response DTO and its `@ApiProperty` descriptions follow.
- **Regenerate the OpenAPI document and commit it in the same change**:
  `npx nx run luna-shopper-backend-gateway:openapi`. `openapi-document.spec.ts` fails on a
  stale one, which is a red PR rather than silent drift.

## 8. Compatibility

The two halves of this feature deploy separately, and staging deploys only what changed, so
both mixed fleets happen:

| Fleet | What the person sees |
| --- | --- |
| new backend, old frontend | no chips and no links. The old client reads `references`, which is gone, and its mapper already collapses an absent array to empty. |
| new frontend, old backend | no chips and no links. `link` is absent so the client reads null, `choices` is absent so it reads empty. |

Both degrade to the answer's text, which is the whole answer anyway. Neither needs a client
version bump, and `min-client-version.guard.ts` is not involved.

## 9. Deliberately not in this plan

- **Confirmation chips** ("yes" / "no" for `remove_lines`). They need words in the caller's
  language, and the service has no translations. Two ways exist and neither is free: the
  contract could carry a `kind` the client renders its own words for, or the choice could
  carry a message the client shows verbatim in the language the reply is already in. The
  second is one field and no client vocabulary, and it is what the next plan should try.
- **Choices for anything the model wants to ask.** A tool asks; a model does not get to
  invent chips. See section 4.2.
- **A link to a line.** Section 2.2.
- **Scoping the assistant panel to a list it was opened from.** Plan `0044` section 1
  names it as an obvious second caller and it still needs no server change.

## 10. Testing

Unit, against the existing service specs:

- `ListLinkCollector`: one list touched gives a link; two give null; none gives null; the
  ASKED candidates never reach it.
- `zoneLabel` is the zone name with two zones and null with one, in the same turn shape.
- The prompt contains the zone line with two zones and does not with one.
- The ASKED branch emits one choice per candidate, capped at six, ordered by the index,
  with the zone in the label when there are two zones and in the message when two
  candidates share a name.
- A tapped choice's `message` resolves: feed it back as the next turn's message and assert
  the NAMED branch (this is `list-resolution.spec.ts` and needs no model).
- Scoped declarations: `SCOPED_TOOL_DECLARATIONS` for `upsert_lines` and `query_lists` have
  no `list` and no `zone` property, and their descriptions contain neither "ask which" nor
  "you will be told to ask".
- Scoped `upsert_lines` with `list: 'la lista de la compra'` against a scoped list called
  "Compra semanal" writes to the scoped list rather than refusing (section 5.3), and with
  `list: 'Oficina'` still refuses.

Gateway, HTTP: the two voice multipart cases of section 5.4, plus the response shape in
`openapi.json`.

## 11. Acceptance

- An answer that touched one list comes back with one `link` to it and nothing else.
- An answer that touched several, or none, comes back with `link: null`.
- No response ever carries a line or a zone as a link.
- A turn that asks which list comes back with `choices` naming real lists, at most six,
  `link: null`, and a reply that asks the question in words.
- With two or more zones, a reply that names a list names its zone, and the link carries
  `zoneLabel`. With one zone, neither happens.
- A voice turn from a list page never asks which list, for a sentence that names the list
  loosely and for one that names no list at all.
- `nx run-many --all --target=test` and the regenerated `openapi.json` are both green.
