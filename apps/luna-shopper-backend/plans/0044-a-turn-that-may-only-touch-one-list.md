# 0044 A turn that may only touch one list

> **The microphone on a list page is not the assistant panel.** Somebody standing over an
> open fridge, speaking into the add button of a list they already have open, has already
> answered the question the assistant spends most of a turn working out: which list. They
> have also not asked for a chat, a rename, or a report about their other groups.
>
> This plan gives a turn a **scope**: a zone and a list stated by the caller, verified by
> the server, which fixes the list, narrows the tool catalog to the things you can do to a
> list, and makes the context fetch a fraction of what an open turn costs.
>
> Prerequisite reading: plan `0039` sections 5, 6.1 and 7, plan `0041` (the voice route this
> extends), plan `0043` (two of the four tools a scoped turn keeps), and velista `0038`,
> which is the caller.

## 1. What is being built

One optional field on the turn request, and everything that follows from it:

```ts
interface TurnScope {
  readonly zoneId: string;
  readonly listId: string;
}
```

Present, the turn is scoped. Absent, the turn is exactly what plan `0039` built and every
existing test keeps testing the thing it tested.

**It is a field on the turn, not a second route.** The voice route's multipart handling, its
byte cap, its transcription step and its rate limit answer are all identical either way, and
a second route would be a copy of `0041` section 4 with one thing changed. It goes on the
typed route too, for the same reason: the machinery is the same, so the field is stated once.
The first caller is the list page's microphone (velista `0038`); the assistant panel opened
from a list is an obvious second one and needs no server change when it arrives.

## 2. What a scope does

Four things, and each one removes a decision the model would otherwise make.

### 2.1 The list is settled before the model is called

Plan `0039` section 6.1 resolves a list in four steps and ends by asking a question when it
cannot, on the argument that a write that guessed is worse than a question. In a scoped turn
**there is nothing to resolve**: the list is in the request.

So list resolution does not run, and a tool call naming any other list is refused by the
service before it reaches the gateway. The model is told, in the tool descriptions, that
there is one list and it is this one, so this refusal is a backstop rather than a normal
path.

The consequence people will notice is the one that matters: a scoped turn **never asks which
list**. On a screen with one list open, that question is the assistant failing to understand
where it is.

### 2.2 The catalog is four tools, and `rename_me` is not one of them

| Tool | In a scoped turn |
| --- | --- |
| `upsert_lines` (plan `0040`) | yes, fixed to the scoped list |
| `set_line_status` (plan `0043`) | yes |
| `remove_lines` (plan `0043`) | yes, with the confirmation that plan keeps |
| `query_lists` | yes, narrowed to the scoped list |
| `rename_me` | **no** |

`rename_me` goes because changing your username is not an operation on a list. It is a
perfectly good thing to ask the assistant for, and the assistant panel is where you ask it.
Somebody speaking into a shopping list's add button has not asked to be renamed, and the one
plausible way it fires is a misheard sentence, which is the worst possible reason for it to
be reachable.

**The catalog is assembled per turn from the scope**, not filtered inside a tool. An absent
capability is a much harder boundary than an instruction (plan `0039` section 7), and that
argument only holds if absence is real: a tool that is defined and then refuses is a tool the
model can still call, whose refusal it has to be told how to handle.

### 2.3 The context fetch collapses

Plan `0039` section 5 fetches the caller's zones and every list they can see, up front, on
every turn, because almost anything needs the index to resolve against. That is the price of
rule A1 and it buys the guarantee that the bot cannot see a row its caller could not.

A scoped turn needs neither. The list is known, so **one fetch**, of that list and its lines,
replaces the zone and list index entirely. Rule A1 is unchanged and is in fact easier to
satisfy: the single fetch is made with the caller's token, so a caller who cannot read the
list gets the gateway's refusal and the turn never starts.

That is a real saving on the path that most needs it. A voice turn already pays for a
transcription call before the turn call (plan `0041` section 3.1), so it is the turn with the
most latency in it and the fewest fetches to spare.

### 2.4 The prompt is narrower, and says where it is

Two additions, both small:

- **It knows the list's name**, so the reply reads as somebody who is looking at the same
  screen rather than as somebody being told about it for the first time.
- **It redirects anything that is not about this list**, in a sentence, with no tool call.
  Plan `0039` section 7 already makes off topic input a redirect; scoped, the definition of
  off topic is narrower and includes things the unscoped assistant would happily have done.
  A person who says something about another list is told which screen it lives on, which is
  the same treatment section 12 gives everything absent from the catalog.

## 3. The scope is a claim, and the server checks it

The client states the zone and the list. The client is a browser, so the statement is
untrusted in exactly the way rule D4 means. **It is verified by being used**: the context
fetch reads that list with the caller's token, and a caller who cannot read it gets a `403`
before the model is called.

There is nothing extra to enforce, and adding a second check would be adding a second answer
to a question the gateway is already the authority on. What the service must not do is skip
the fetch as an optimisation when the scope names a list the model does not end up asking
about. **The fetch is what authorizes the turn**, and skipping it would make the scope a
statement the server believed.

A scope whose zone and list disagree, or whose list does not exist, is the same `403` or
`404` the gateway gives for any other unreadable list. The service does not translate those
into anything cleverer.

## 4. What does not change

Worth listing, because a scoped turn is the same turn:

- **The rate limit.** A turn is a turn from the caller's point of view, and a scoped one
  costs the provider the same. Plan `0039` section 9's answer and its countdown are
  untouched.
- **References.** Rule A3 holds exactly as written, including plan `0043` section 5's rule
  about deleted lines.
- **Statelessness.** Rule A2: nothing is stored between turns and the client holds the
  transcript. A scope is stated on every request rather than opened once and remembered,
  which is the same decision plan `0039` section 4 made for conversations and for the same
  reason.
- **The confirmation before a deletion.** Plan `0043` section 3.3 stands. On a voice turn
  that means a second recording, which is a real cost, and it is the right one: a deletion
  triggered by a misheard sentence with no confirmation is the failure that would end the
  feature.
- **The privacy statement.** Plan `0041` section 6 is unchanged: a scoped voice turn holds
  the recording for the length of the turn, logs the transcription and never the audio.

## 5. Contracts, docs and CI

- `libs/luna-shopper/contracts`: `TurnScope`, optional on the turn request and on the voice
  request. Nothing on the response changes, which is deliberate: the client cannot tell a
  scoped reply from an unscoped one, and does not need to.
- **`gateway/docs/openapi.json` regenerated in the same commit.** A multipart route gaining a
  form field is the kind of diff worth reading rather than trusting, per plan `0041` section
  10.
- No new environment variable, no secret, no values file entry, no broker change.

## 6. Testing

Against `FakeModelProvider`, with no network, as rule A4 requires.

- A scoped turn fetches the scoped list and **not** the zone index, asserted on the fake
  gateway client's calls. That is the cost saving, and it is the one that silently regresses.
- A scoped turn's tool catalog contains four tools and not `rename_me`, asserted on what is
  handed to the provider rather than on what the provider does with it.
- A tool call naming a different list is refused and no gateway call is made.
- A scope the caller cannot read produces the gateway's refusal, before the provider is
  called at all.
- A scoped turn never emits a question about which list, driven by a fake model that would
  have asked one unscoped.
- An unscoped turn behaves exactly as it does today: every existing assistant spec passes
  unchanged, which is the real acceptance criterion for this plan.

## 7. Acceptance

- A recording sent from a list page adds lines to that list and to no other.
- A scoped turn issues one context fetch, not two.
- `rename_me` is not callable from a scoped turn, because it is not defined in one.
- A scoped turn asked about another list explains rather than acts.
- A caller who cannot read the scoped list gets a refusal and costs no provider request.
- The unscoped assistant is byte for byte the feature it was.
