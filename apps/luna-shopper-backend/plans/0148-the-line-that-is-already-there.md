# 0148: the line that is already there

> **Blocked on `0147`**, which builds the operation store this plan's question is answered
> through. Build `0147` first. The frontend half is a velista plan and is not written yet, so
> until that lands the question is answered in words rather than by tapping.
>
> Prerequisite reading: `0040` sections 2 and 7 (why `upsert_lines` takes a mode and what an
> `add` means), `0091` (a batch add answers whether each item merged), `0112` section 4 (what
> core does when two lines become one), `0147` sections 2, 4, 6 and 10, and in the code
> `upsertLines`, `findSameProduct` and `normalize` in
> `apps/luna-shopper-backend/assistant/src/app/assistant/`.

Somebody with "leche entera" on the list asks for milk and gets a second line. This plan
finds the line that is already there, asks whether to add to it, and writes nothing until
the answer arrives.

## Brief for the agent

### Objective

Make `upsert_lines` notice that a list already holds something like what was asked for, ask
which was meant, and write the answer through an operation from `0147`, without slowing down
the ordinary case where nothing matches.

### Context

- `findSameProduct` in `tools.ts` is **exact equality after `normalize`**, which lowercases,
  strips accents and collapses punctuation to single spaces. "leche" and "leche entera" are
  two different products to it, and so are "tomate" and "tomates".
- Core merges on the same exact rule. `addLines` answers `merged` per item since `0091`, and
  that merge fires only when the text matches exactly. So nothing anywhere in the stack
  notices a near duplicate today.
- `upsert_lines` already reads the whole target list before it writes
  (`runtime.context.lines(list.listId)`), once per call, for the lost update reason in `0040`
  section 2. **The matcher costs no extra request**, because that read is already paid for.
- The tool already has a branch that asks and writes nothing: `ListResolutionBranch.ASKED`,
  when it cannot tell which list was meant. Its shape is the precedent this plan follows.
- `TurnContext` fetches a list's lines lazily on purpose. A turn that turns out to be "hello"
  must not cost a request per list.
- `0147` stores an operation keyed to the caller for five minutes and executes it once.

### Target state

- `upsert_lines` compares every product it was given against the lines already on the target
  list, by a deterministic rule in its own file, with its own fixture table of a spec.
- A call with at least one near match **writes nothing** and offers two operations: fold the
  matches into the lines that are already there, or put everything on as new lines.
- A call with no near match behaves exactly as it does today, in one round trip.
- An exact match still merges silently, with no question asked.
- With the store unreachable, the same question is asked and answered by calling
  `upsert_lines` again with an explicit `onSimilar` argument.

### Scope

Work only in:

- `apps/luna-shopper-backend/assistant/src/app/assistant/product-similarity.ts` (new) and its
  spec
- `apps/luna-shopper-backend/assistant/src/app/assistant/tools.ts` and its spec
- `apps/luna-shopper-backend/assistant/src/app/assistant/prompt.ts`
- `apps/luna-shopper-backend/assistant/src/app/operations/` (the `ADD_LINES` executor `0147`
  left with no caller)
- `libs/luna-shopper/contracts/src/lib/enums/assistant.enums.ts` if an effect value is
  missing, and the regenerated `openapi.json` and `wire-types.ts` if anything reaches the wire

Do not touch: core's merge rules, `line-merge.service.ts`, `query_lists`, `remove_lines`,
`settle_lines`, `rename_me`, `list-resolution.ts`, the catalog, or anything under
`libs/velista/` or `apps/velista/`.

### Constraints

- **No stemmer, and no new npm dependency.** The catalog's own search already proved a Spanish
  stemmer conflates "salado" into "sal", and a matcher that does that to a shopping list will
  fold olives into olive oil.
- **The matcher is pure.** No clock, no network, no injection, no `async`. It takes two strings
  and answers.
- **Nothing merges on a near match without a person saying so.** Exact matches keep merging
  silently because core does it anyway.
- Only make changes directly requested. No catalog lookups, no learning from past answers, no
  change to how core stores a line.

### Action boundaries

Stop and ask before: adding a similarity rule that is not a pure function of the two strings,
adding a dependency, changing what an exact match does, or making the matcher configurable
through the environment.

### Progress evidence

After each section output: the files changed, the spec you ran, and for section 3 the full
fixture table with its verdicts, so the rule can be read as a table rather than as code.

## 1. Two lines for one product

"Leche entera" is on the list. Somebody says "add milk". `normalize` gives "leche entera" and
"leche", which are not equal, so `findSameProduct` finds nothing, `addLines` creates a line,
and core does not merge them either because its rule is the same equality. The list now says
buy milk twice, and the person who wrote the first line and the person who spoke are the two
people least likely to notice.

It is worse by voice than by typing, because a person typing sees the list while they type.
The microphone is used with the list out of sight, which is the case this assistant exists
for.

## 2. Where the matching goes, and where it must not go

**It goes in the tool, against the list the tool has already read.**

The alternative is to put the list's lines in the system prompt so the model can spot the
duplicate itself, and it is written down here because it is the obvious idea and it is wrong
in three separate ways:

- **It costs a request per list on every turn**, including "hello". The lazy fetch in
  `TurnContext` exists for exactly that reason and says so in a comment. A household with
  three zones and six lists pays six gateway calls and one to three thousand prompt tokens
  before the model has read the first word of what was said.
- **It is the thing models are worst at.** Scanning two hundred short strings for near
  duplicates is a deterministic comparison with a defined answer, and asking a model to eyeball
  it buys a probabilistic answer at a token price. The code has the list in a variable.
- **It weakens the one rule doing real safety work.** The prompt says every fact about a line
  must come from a tool result in this same turn, because a confident and wrong "yes, milk is
  on the flat list" is the worst output this feature can produce. Lines in the prompt are
  plausible looking line data from before any write in the turn, and they make "if you have
  not looked, look" unenforceable.

`upsert_lines` reads the target list before writing anyway. The comparison happens there, for
free, and the model's job stays what it is good at: wording the question.

## 3. The rule: one name contains the other

After `normalize`, split into tokens, drop the stop words, and apply one plural rule. Then:

**Two names match when one token set is a subset of the other, and neither set is empty.**

That is the whole rule, and it is chosen because it is how people actually shorten a name:
they say the head noun and drop the qualifiers. It gives the right answer on the cases that
matter without a threshold to tune.

| Asked for       | On the list                | Tokens                             | Verdict               |
| --------------- | -------------------------- | ---------------------------------- | --------------------- |
| leche           | leche entera               | {leche} ⊂ {leche, entera}          | match, ask            |
| leche entera    | leche                      | {leche} ⊂ {leche, entera}          | match, ask            |
| tomates         | tomate                     | {tomate} = {tomate} after plurals  | match, ask            |
| leche           | leche                      | identical before any of this       | exact, merge silently |
| huevos camperos | huevos                     | {huevo} ⊂ {huevo, campero}         | match, ask            |
| pan de molde    | pan                        | {pan} ⊂ {pan, molde}               | match, ask            |
| aceite de oliva | aceite de girasol          | {aceite, oliva} vs {aceite, girasol} | no match, write     |
| papel higienico | papel de cocina            | {papel, higienico} vs {papel, cocina} | no match, write    |
| sal             | salmon                     | {sal} vs {salmon}                  | no match, write       |
| agua            | agua con gas               | {agua} ⊂ {agua, gas}               | match, ask            |
| whole milk      | milk                       | {milk} ⊂ {whole, milk}             | match, ask            |

The two negative rows are the reason the rule is subset rather than a shared token count.
"Aceite de oliva" and "aceite de girasol" share their head noun and are different products,
and every scoring rule that calls them similar also calls half a shopping list similar to the
other half.

Four details, with the stop words and the length floor as named constants in the same file:

- **Stop words**, per language and short: `de`, `del`, `la`, `el`, `los`, `las`, `un`, `una`,
  `con`, `y`, and `of`, `the`, `a`, `an`, `with`, `and`. They are dropped from both sides. A
  name made only of stop words keeps its tokens rather than becoming empty.
- **The plural rule** strips a single trailing `s` from tokens of five characters or more, on
  both sides, before comparing. One letter, not a stemmer, and the length floor keeps `gas`,
  `mes` and `anis` whole. It misses every irregular plural, so "arroces" does not reach
  "arroz" and "jamones" does not reach "jamon". **A miss is the safe direction**: it costs a
  second line somebody can merge by hand, where a wrong fold costs a wrong number in a shop.
  Do not add a second suffix to close those cases. `es`, tried before `s`, turns "carnes" into
  "carn" and stops it matching "carne", which trades two misses for a different two.
- **A plural difference is a near match and it asks.** "Tomates" against "tomate" is not exact
  by `normalize`, so neither `findSameProduct` nor core sees them as one product, and folding
  them silently would be this plan's own rule broken in its easiest case. One rule holds
  everywhere: byte equal after `normalize` merges, and everything else asks.
- **Numbers and units are tokens like any other**, so "2 litros de leche" carries
  `{2, litro, leche}`, which has `{leche}` inside it and therefore asks. That is the right
  answer: somebody saying "two litres of milk" at a list that says "leche" is talking about
  the same milk, and the question is the cheapest way to be sure.

It lives in `product-similarity.ts`, exporting one pure function, and `normalize` is imported
from `list-resolution.ts` rather than copied.

**At most two candidates** are offered for one product, ranked by how few extra tokens they
carry and then by their position on the list. Three lines that all contain the name is a list
where the person meant something this rule cannot see, and a third chip does not help them.

## 4. What the tool does with a match

**It writes nothing at all**, which is the `ASKED` branch's shape and the same reasoning: a
write that guessed is worse than a question, and half a call written is worse than both.

Two operations are created through `0147`'s store, whatever the size of the batch:

| Operation | Items                                                            |
| --------- | ---------------------------------------------------------------- |
| fold      | every matched item carries `mergeIntoLineId`, the rest are plain |
| separate  | every item is plain                                              |

Both carry the **whole** call, so the products that matched nothing are written either way and
nobody has to ask twice. Two operations rather than two per item, so a batch of ten with three
matches is still two chips and still fits inside the three operation cap.

This adds one optional field to `0147`'s stored item, and no new kind:

```ts
items?: {
  product: string;
  mode: 'set' | 'add';
  quantity?: number;
  /** The line to fold this into, on the fold operation only. */
  mergeIntoLineId?: string;
}[];
```

The tool result names the candidate so the model can ask a question with the real text in it:

```ts
return {
  ok: false,
  needsDecision: true,
  list: list.listName,
  matches: [{ product: 'leche', existing: 'leche entera', quantity: 2 }],
  foldOperationId,
  separateOperationId,
  message:
    'Nothing was written. Tell them what is already on the list, by its exact text, and ' +
    'ask whether to add to it or to put theirs on as its own line. Confirm their answer ' +
    'with confirm_operation and the matching operation id.',
};
```

## 5. What confirming does

`0147` built the `ADD_LINES` executor and left it with no caller. This is the caller.

- An item with no `mergeIntoLineId` goes through `addLines`, exactly as `upsert_lines` does
  today, so core's exact merge still applies and the result reports `INCREASED` where it fired.
- An item with one goes through `addLineQuantity` with the delta, or `updateLine` for a `set`.
- **A candidate line that is gone is not a failure.** Re-read the list, run the matcher again,
  and fold into whatever it finds now. With nothing left to fold into, add the product as its
  own line and report `ADDED` rather than `INCREASED`. Five minutes is long enough for somebody
  else to have bought the milk, and refusing the whole operation over it would be the assistant
  punishing the person for waiting.

Everything else about execution, including never claiming a rollback, is `0147` section 7.

## 6. When the store is not there

The matcher does not need Redis and the question does not either. With no operation ids,
`upsert_lines` asks the same question and the message tells the model to call the tool again
with the answer:

```
onSimilar: 'fold' | 'separate'
```

Present, it means the person has already decided, so the call writes and never asks. Absent,
the call asks whenever it finds a match. The matcher is deterministic and the second call
re-reads the list, so it finds the same candidate and folds into the same line without any id
having to survive between the turns.

That parameter stays on the declaration in both scopes even when the store is working, because
it is also how a person says "no, put it on separately" in words rather than by tapping.

## 7. What must never happen

**Nothing merges on a near match without somebody saying so.** The asymmetry is the argument:
a wrong suggestion costs one tap and a moment, and a wrong merge puts a number on a shopping
list that nobody finds out is wrong until they are standing in the shop. The rule in section 3
is deliberately narrow for the same reason.

**An exact match still merges silently.** It always has, core does it too, and asking about it
would be the nagging that `settle_lines` refuses to do.

**A call with no match still writes in one round trip.** This is the common case and the
reason the assistant is worth using. "Add milk" on a list with no milk on it is one turn, one
call and one write, before and after this plan.

## 8. What the model is told

One rule in the prompt, in both the open and the scoped version:

> When a tool tells you the list already holds something like what they asked for, say what is
> already there using its exact text, and ask whether to add to it or to put theirs on
> separately. Do not choose for them, and do not say anything about the list that the tool
> result did not say.

Nothing else in the prompt changes. The matcher is not described to the model and the
thresholds are not either, because the model never runs them.

## 9. The door this plan does not open

The real answer to "is this the same product" is not text. A line can carry catalog product
ids, so two names that resolve to the same catalog product are the same product whatever their
wording, and that beats every string rule at exactly the cases a string rule gets wrong:
"leche desnatada" against "leche semidesnatada" is a subset miss, and a brand name against a
generic name is invisible to both.

It is not in this plan because it needs a catalog resolution per spoken product on the write
path, which is a latency budget and a plan of its own. Section 3's rule is chosen to be honest
about what it is: a cheap, explainable rule that catches the common shortening and says
nothing about the hard cases.

## 10. Not in this plan

- The chips. velista draws them from `0147`'s `operations` array.
- Any learning from which suggestions people accept. There is nowhere to keep it and rule A6
  is not a place to start keeping it.
- Catalog backed matching, per section 9.
- A change to how core merges, or to `line-merge.service.ts`. Core's exact rule stays exactly
  as it is.
- Matching across lists. The question is only ever about the list being written to.

## 11. Tests

- `product-similarity.spec.ts`: section 3's table, every row, in both directions, plus the
  stop word cases, the plural rule at four and five characters, an empty string on either side,
  and a name that is nothing but stop words.
- `tools.spec.ts`, one case each: a match writes nothing and creates two operations, no match
  writes immediately and creates none, an exact match merges with no question, `onSimilar`
  present writes without asking, two matched items produce two entries in one pair of
  operations, and a third candidate is not offered.
- The fold executor: a normal fold, a fold whose target line was deleted falling through to an
  add, and a batch where one item folds and one is new.
- The matcher spec imports nothing from Nest and needs no module.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 12. Acceptance criteria

- [ ] Every row of section 3's table passes, in both directions.
- [ ] A call with a near match writes nothing, proved by a spec that asserts no gateway write.
- [ ] A call with no near match makes the same gateway calls it makes today.
- [ ] An exact match still merges and asks nothing.
- [ ] Confirming the fold operation adds the quantity to the existing line, and confirming the
      separate operation creates a new one, from the same offered pair.
- [ ] A deleted candidate line falls through to an add and the result says `ADDED`.
- [ ] With the store unreachable, the question is still asked and `onSimilar` still answers it.
- [ ] No stemmer, no new dependency, and the matcher is a pure function.

## 13. Verification

```sh
npx nx test luna-shopper-backend-assistant
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx lint luna-shopper-backend-assistant
```

Then, against an ephemeral luna slot: put "leche entera" on a list, ask the assistant for
milk, and check that nothing was written and two operations came back. Confirm the fold one
and check the quantity went up rather than a second line appearing. Repeat with "aceite de
oliva" on the list and "aceite de girasol" asked for, and check it wrote without asking. Put
both transcripts in the PR.
