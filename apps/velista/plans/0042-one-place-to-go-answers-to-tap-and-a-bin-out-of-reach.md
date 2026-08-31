# 0042 One place to go, answers to tap, and a bin out of reach

> **A row of chips under a one sentence answer is not a set of links, it is a bill of
> materials.** Plan `0032` draws one chip per reference, and a turn that read a list emits
> a chip for the list and a chip for every line on it, two of which lead to the same
> screen. What somebody wants after "there is no milk on the weekly shop" is to go to the
> weekly shop.
>
> So the panel draws **one** link, always to a list, as a line of text under the reply
> saying where it goes. In its place the chips get a better job: when the assistant asks
> which list, the **answers to that question** sit under the question, and tapping one
> answers it.
>
> The list page gets two fixes. Its microphone still gets asked which list, on a screen
> showing one list, and the fix for that is entirely on the server. Its recorder puts the
> bin and the stop button side by side while its own comment says they are at opposite
> ends, which is how a recording gets thrown away by a thumb.
>
> Prerequisite reading: plan `0032` sections 3 and 7 (the panel and its links), plan `0038`
> section 4.1 (the recorder this changes), and luna `0046`, which is the other half of
> this plan and the source of every wire shape below.

## 1. What is being built

Four things, and only the last one is on the list page:

1. **One link, to one list**, rendered as text rather than a chip.
2. **Answers you can tap**, under the question that asked for them.
3. **The zone in the link**, when the server says the person has more than one.
4. **The bin moves to the far end** of the recording row, away from stop.

Plus a defect that needs no code here: the list page's microphone is asked which list, and
section 5 says why this side is already correct.

## 2. The wire this plan reads

From luna `0046`, and the only place these words appear on this side is `mappers.ts`
(rule D4):

```ts
// POST /v1/assistant and /v1/assistant/voice, response
{
  reply: string;
  link: {
    zoneId: string;
    listId: string;
    label: string;          // the list's name
    zoneLabel: string | null; // the zone's name, when there is more than one zone
  } | null;
  choices: { label: string; message: string }[];  // empty when nothing was asked
  listResolution?: 'NAMED' | 'CONVERSATION' | 'ONLY_LIST' | 'ASKED';
  heard?: string;
}
```

`references` is gone. Neither side waits for the other: against an old backend `link` is
absent and `choices` is absent, and section 8 says what that looks like.

## 3. One link, and it says where it goes

### 3.1 The model

`AssistantReference`, the three way union in `@portfolio/velista/models`, collapses to one
shape:

```ts
/** The one place an answer can send somebody. */
export interface AssistantListLink {
  readonly zoneId: string;
  readonly listId: string;
  readonly label: string;
  /** The zone's name when the server says it is worth saying. Never composed here. */
  readonly zoneLabel: string | null;
}
```

`AssistantReply.references` and `AssistantEntry.references` both become
`link: AssistantListLink | null`. The mapper keeps the rule it had: a link missing an id is
**dropped**, never half built, because a link that 404s is worse than no link.

**The zone is not decided here.** Whether to name it is one rule about how many zones
somebody is in, and the server is where that rule lives (luna `0046` section 3). This side
renders what it is handed and counts nothing.

### 3.2 What it looks like

Not a chip. A line of text under the bubble, in the panel's link colour, with a small
glyph before it:

```
  It is not on the weekly shop, so I have added it.

  → Go to Compra semanal
```

- Text: `assistant.goTo` = "Go to {{list}}", or `assistant.goToInZone` = "Go to {{list}},
  in {{zone}}" when `zoneLabel` is set. Two keys rather than one with an optional
  fragment, because the two read as different sentences in Spanish and a translator should
  see both.
- Colour: `--app-status-attention-fg`, which is what the chips already used and is
  visibly not body text in both themes. Never colour alone: the glyph and the word "Go"
  both say it is a link.
- Glyph: `ChevronRightIcon` at `--app-icon-sm`, from the app's own icon set. No new icon.
- It keeps `routerLink`, so it is a real anchor with a real href that the app routes
  internally.
- Touch target: it is a single line of text, so it takes the `--app-control-height`
  minimum the chips had, as a block level anchor with room around it.

`AssistantMessageVm.links: readonly AssistantLinkVm[]` becomes
`link?: AssistantLinkVm`, and `AssistantLinkVm` loses `kind` and `queryParams`: there is
one kind and a list needs no query parameter. `assistant-page.ts`'s `_toLink` collapses to
one branch building `appPath(locale, base, 'zones', zoneId, 'lists', listId)`.

`PersonIcon`, `CheckOutlineIcon` and `ListLinesIcon` leave `assistant-message.ts`'s imports
with the branch that used them. They stay exported from the icon set, which other screens
use.

## 4. Answers you can tap

### 4.1 What they are

When a turn ends with a question, the server sends the answers to it (luna `0046` section
4). They render under the message the same way the links used to, and they take the chip
treatment the links are giving up: a wrapping row of chips, `--app-status-attention-*`,
`--app-control-height` each, because a chip in a wrapping row is what has to reach the
touch target on its own.

```
  Which list did you mean?

  [ Compra semanal · Casa ]  [ Compra · Oficina ]
```

They are `<button>`s in a `<ul>`, not links: tapping one **says something**, it does not
go anywhere. Each is labelled by its own text and the group is labelled by the question
above it (`aria-labelledby` onto the bubble's id).

### 4.2 Tapping one is typing one

A tap calls the same `send()` the composer calls, with `choice.message`. Everything that
follows is an ordinary typed turn: the caller's own bubble shows the text that was sent,
the transcript records it, and the store's cap counts it. There is no second request shape
and nothing new for the store to remember.

### 4.3 Only the last message keeps its chips

An answer to a question three turns ago is a wrong answer, and a chip that is still tappable
is a chip that invites it. So the page renders `choices` for the **last entry only**; every
earlier message keeps its text and loses its chips.

The question stays readable, which is what matters: it was asked in words and the words are
still there.

`AssistantEntry` gains `choices: readonly AssistantChoice[]` (empty by default on every
entry the store makes on its own: pending, failed, throttled, unconfigured, dropped,
spoken, too long, bad format). `AssistantMessageVm` gains `choices` too, and the page fills
it only for the last entry.

### 4.4 Both at once

A turn that asked a question sends no link, and a turn that sends a link asked nothing
(luna `0046` section 2.4). The template handles both anyway, link first and chips under it,
because a template that renders whatever it is handed is one fewer thing that can be wrong
when the server changes its mind.

## 5. The list page is asked which list, and this side is right

`askAboutList` posts `zoneId` and `listId` as form fields beside the recording, and both
come from the route the page is already on (`zoneIdOf` / `listIdOf`). `addAloud` returns
without sending when either is null, so a request that leaves this app either carries the
scope or does not exist.

The defect is in the assistant service: a scoped turn narrows the tool **catalog** and not
the tool **descriptions**, so the model is still shown a `list` parameter and still told it
will be asked to ask. Luna `0046` section 5 has the diagnosis and the fix.

What this plan adds here is the test that would have caught it from this side: a spec on
`AssistantApi.askAboutList` asserting the posted `FormData` carries `zoneId` and `listId`
with the ids it was given. It is one assertion and it locks the half of the contract this
app owns.

## 6. The bin moves to the far end

### 6.1 What is wrong

`line-composer.scss` says it plainly:

> Trash at one end, stop at the other, and the meter taking every pixel between them. The
> distance is the safeguard, which is `RecordingRow`'s rule (plan `0032`, section 4.3).

The layout does not do that. `.listening` is a flex row of trash, stop, meter, hint with a
single `gap`, and only the meter grows, so the two buttons sit **side by side at the left
end**, one `--app-space-4` apart. The safeguard the comment describes was never built, and
the two controls a recording can end with are a thumb's width apart, one of which throws
the recording away.

### 6.2 What it becomes

Stop at the leading end, the bin at the trailing end, and the meter and its hint taking
every pixel between them:

```
[ ■ stop ]  ▁▂▃▅▃▂  Listening                      [ 🗑 ]
```

- DOM order becomes stop, meter, hint, bin. The visual order and the reading order agree,
  and nothing is moved with `order`.
- The bin is pushed to the end (`margin-inline-start: auto` on `.discard`), so the gap
  between the two controls is whatever the row is wide, and it is not a value somebody can
  tune down.
- Logical properties, so right to left keeps the relationship rather than the side.
- The colours do not change: outlined coral for the bin because it destroys, filled amber
  for stop because it is the send.
- The comments that describe the old arrangement are rewritten to describe this one. A
  comment that says a safeguard exists is worse than no comment when the safeguard does
  not.

### 6.3 Why this end for the bin

The microphone that starts a recording is the composer's trailing button, so the finger
that just pressed it is at the trailing end. That is an argument for putting stop there and
it is the wrong one: stop is pressed once at the end of a sentence, when the person is
looking at the screen, and the bin is pressed by accident. The control that costs a
recording gets the deliberate reach.

### 6.4 The comment recorder is left alone, for now

`RecordingRow` (voice comments, plan `0041`) already puts its two controls at opposite ends
with `space-between`, with the bin leading and stop trailing, which is the mirror of what
this plan builds. Mirroring is itself a small hazard: same two glyphs, same two jobs,
opposite sides.

It is out of scope here because this plan changes the composer somebody asked about, and
swapping the comment recorder is a change to a screen nobody reported. **Recommendation:
mirror it in a follow up** so both recorders read the same way, and do it as its own change
so it can be looked at on its own.

## 7. Translations

`libs/velista/ui/assets/i18n/{en,es}.json`, under `assistant`:

| Key | en | es |
| --- | --- | --- |
| `assistant.goTo` | Go to {{list}} | Ir a {{list}} |
| `assistant.goToInZone` | Go to {{list}}, in {{zone}} | Ir a {{list}}, en {{zone}} |
| `assistant.choices.label` | Answers | Respuestas |

`assistant.choices.label` is the accessible name of the chip group when the bubble it
belongs to has no id to point at, which happens for a reply the panel wrote itself.

Nothing on the list page needs a new key: section 6 moves two buttons that already have
`list.add.discard` and `list.add.stopListening`.

## 8. Against an old backend

`link` absent reads as null, `choices` absent reads as empty, and the mapper defaults both
without complaining. The panel then draws the answer and nothing under it, which is the
whole answer anyway. Nobody sees an error and nothing retries.

The reverse (this app old, the backend new) is luna `0046` section 8 and looks the same
from the outside.

## 9. Testing

- `mappers.spec.ts`: a reply with a link, one without, one whose link is missing `listId`
  (dropped), one with choices, one with neither, and one from the old wire shape (a stray
  `references` array is ignored rather than read).
- `assistant-message.spec.ts`: a link renders one anchor with the right `routerLink` and
  the "in {{zone}}" text only when `zoneLabel` is set; choices render as buttons; a message
  with neither renders neither.
- `assistant-page.spec.ts`: chips appear only on the last entry; tapping one sends its
  `message` through the same path a typed message takes, and the caller's bubble shows that
  text.
- `assistant-api.spec.ts`: `askAboutList` posts `zoneId` and `listId` (section 5).
- `line-composer.spec.ts`: the recording row's DOM order is stop, then the meter, then the
  bin, and the bin is the last focusable control in the row.
- The e2e assistant suite, if it asserts on chips, follows the new markup.

## 10. Acceptance

- A reply that touched one list shows one link under it, reading "Go to <list>", in the
  link colour, with a glyph, and tapping it opens that list.
- With more than one zone the same link reads "Go to <list>, in <zone>".
- No reply ever shows a link to a line or to a zone, and no reply shows two links.
- When the assistant asks which list, its answers appear as chips under the question, and
  tapping one sends that answer and gets on with the turn.
- Chips on older messages are gone, and their questions are still readable.
- A recording in progress shows stop at one end of the row and the bin at the other, and
  neither can be hit while reaching for the other.
- `nx test velista/ui`, `nx test velista/data-access`,
  `nx test velista/feature-assistant` and `nx lint` for the touched projects are green.
