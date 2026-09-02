# 0008 (backlog) Reading a till receipt

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> **Priority: very low, and lower than anything else in this directory.** The approach works well
> enough to be worth writing down and nowhere near well enough to build. Section 3 is the list of
> reasons, and it is long on purpose. This plan exists so that the measurement in
> `docs/receipt-ocr/` is not lost, not because anything is ready.

Backlog `0001` section 13 parks "the submission endpoints, receipt photo upload and storage, OCR
of user receipts, the moderation queue and abuse handling" for a later plan. This is that plan's
first draft, written against evidence rather than against guesses: six of ten photographed
receipts have been read by five models and the results, the tooling and the per ticket analysis
are committed under **`apps/luna-shopper-backend/docs/receipt-ocr/`**. Read that first. Everything
asserted here comes from it.

## 1. What this would build

A user photographs a supermarket receipt. The app reads it and does two different things with what
it finds, which is the one decision the whole feature hangs on.

## 2. Rule R1, the rule everything else follows from

> **A receipt is authoritative for the scanner's own basket, and merely a suggestion for the
> shared catalog.**

One scan, two write paths, two trust levels:

|                          | Basket reconcile                                      | Catalog price                          |
| ------------------------ | ----------------------------------------------------- | -------------------------------------- |
| Writes to                | core, through the API carrying the caller's own token | catalog, as a `PriceSubmission`        |
| Trust                    | authoritative: this person bought this                | a suggestion, aggregated and moderated |
| Needs a catalog match    | only to correct a quantity                            | always                                 |
| Blast radius of an error | one person's own list                                 | every user who sees that price         |
| Dependency               | core, **which exists**                                | backlog `0001`, **which does not**     |

This resolves the tension in "a receipt price is stronger user input that still cannot be trusted".
It is fully trusted for the thing it is evidence of and untrusted for the thing it is only weak
evidence of, and conflating the two is the most expensive mistake available here.

**The two halves have different dependencies and could ship years apart.** The basket half needs
nothing that is not already built. The catalog half cannot start until backlog `0001` exists.

## 3. Why this is not scheduled

Eight reasons, roughly in order of how much they would cost to fix.

**3.1 The catalog half has no table to write into.** `ItemPrice`, `PricePolicy` and
`PriceSubmission` are all designed in backlog `0001` sections 2.3, 2.4 and 2.6 and none of them
exists. `SupermarketItem` still carries a single `price` column with a `priceSourceKind` beside
it, which is explicitly "not `ItemPrice`". Nothing in this plan's catalog half can be built until
that one is. This alone is enough to park it.

**3.2 Product identity is the weak half, and it is the half the feature is about.** On the 64 line
ticket 5 the two models agreed on 63 of 64 line totals (98%) and on only 54 of 64 normalized
product keys (84%), and two product names were wrong in _both_ readings, so cross-model agreement
would not have caught them. Money is close to solved; naming the thing that was bought is not.

**3.3 Alias stability across visits is measured on exactly one product.** Section 6 argues an
alias key must be _stable_ rather than correct. The only direct evidence is that `ESPETEC ELIGES`
appears on tickets 3 and 4, different days and photographs, and both models read it identically
both times. One product is not a result. This is the largest untested risk in the design and the
cheapest thing to go and measure.

**3.4 The receipt features most likely to break the checksum have not been seen yet.** No ticket
read so far carries a multibuy discount, a loyalty deduction or a returned or refunded item. All
three change the sign or the arithmetic of a line, which is precisely where a checker built on
"the lines sum to the total" needs re-examining. Four photographs in the corpus remain unread.

**3.5 The prompt is at v2 and three known v3 changes are unmade.** They are listed in
`docs/receipt-ocr/README.md` section 9 and were deliberately deferred so the corpus stayed
comparable: capture the tax breakdown, never substitute an illegible character, and name the
receipt as the authoritative document when the photo also holds a card slip. None is hard; none
has been done.

**3.6 The schema throws away the only thing that caught ticket 4's error.** `schema.json` keeps a
scalar `taxTotal`, so the tax block cannot be checked. On ticket 4 every reader misread the 4% VAT
figures and `validate.mjs` reported `BALANCED` for all of them. Section 5.2 is the fix and it is a
schema change, which means re-reading the corpus.

**3.7 Which model to use flipped between small and large receipts.** Gemini 3.1 Flash-Lite was
clean on four small tickets and then produced both money errors in the corpus, on both large ones.
Gemini 3.5 Flash-Lite is the current pick on the argument in section 7, from six tickets. That is
a thin basis for pinning a dependency.

**3.8 Nothing is known about production latency or quota.** Every measurement was taken on a free
tier where `gemini-3.1-flash-lite` took 3.0 s on one ticket and 11.0 s on another, and where
`gemini-3.7-flash` accepts a request and never answers at all. Those numbers measure a queue.

## 4. What the evaluation did establish

Three things, and they are the reason this is worth keeping rather than deleting.

**4.1 It generalizes across chains with no per-chain work.** Ticket 5 is 64 lines from Super Cash,
in a format sharing almost nothing with the four El Jamón tickets before it: apostrophe decimal
separators (`1'29`), headed columns, alphabetically sorted lines, descriptions truncated by the
till, fractional kilogram quantities, a differently shaped tax table, and department lines with no
numbers at all. **Not one line of the prompt or schema was changed for it**, and both models read
it. A per format parser would have needed a new parser. This is the difference between work that
scales with the number of supermarkets and work that does not, and it is the whole argument for
the approach.

**4.2 The receipt carries its own checksum, so an extraction can be scored with no ground truth
and no human.** That is what makes the volume affordable, and section 5 is the design.

**4.3 On the worst photograph, the checksum is the entire product.** Ticket 9 is a heavily curled
41 line receipt whose numeric columns sit visibly higher than the descriptions they belong to. One
model read all 41 line totals exactly. The other **associated every description with the next
line's numbers, from line 2 to line 40**: 38 of 41 lines carried the wrong price, and every one of
them was individually plausible, a real product from that receipt paired with a real amount from
that receipt. Sampling would not find it. A person skimming the output would not find it. The
checker found it instantly, because the shift drops one value and duplicates another and the lines
then sum to 110.37 against a printed 111.79.

## 5. The checkers

Two of them, both plain arithmetic, both run before anything is written. Neither involves a model,
and that is the point: "the model says it is confident" is worth nothing here.

### 5.1 Lines against the total

Every line's total sums to the receipt total, and each line's quantity times its unit price equals
its line total.

**Rule R2. A weighed quantity is a rounded display value and the per line check must treat it as
an interval.** Super Cash prints kilograms to one decimal, so `0'1 x 13'90 = 0'90` is a _correct_
line for 0.0647 kg. All six weighed lines on ticket 5 fail a strict check. An integer quantity
gets no slack and is still checked exactly, which is where a genuine transposition is caught.

**Rule R3. Why it works is that its two sides fail independently.** On ticket 9 both models read
the total correctly while one had every line shifted, because the total sits in the flat lower
third of the photograph and the corrupted lines are in the curl. A systematic corruption of the
lines cannot corrupt the total to match. Anything that makes the total depend on the lines
destroys the check.

### 5.2 The tax block against the lines

A Spanish receipt is tax inclusive, so every line belongs to exactly one VAT group and each
group's gross is the sum of its own lines. **The tax block therefore partitions the lines**, which
is a far stronger constraint than a second total: on ticket 4 the 4% group grossed to 3.80 and _no
subset of the lines could reach 3.80_, which proves the figure wrong rather than merely suspicious,
localizes the error to one group, and derives what it had to be (gross 3.08, base 2.96, tax 0.12).

This needs `taxBreakdown: [{ rate, base, tax }]` in the schema, which v2 does not have. Allow one
cent of drift per group: three independently rounded taxes can miss the total by a cent with
nothing wrong.

**The subset test weakens as the receipt grows.** With 64 lines almost any value is reachable, so
on a large basket this degenerates to the sum check. It is strongest exactly where ticket 4 was.

### 5.3 What they do not catch

**Rule R4. The checkers catch invented money and nothing else.** A misread timestamp and a misread
product name are unconstrained by anything on the paper. A clean run means "the money adds up",
not "the reading is right". The timestamp matters because it becomes `observedAt`, which drives the
14 day eligibility window in backlog `0001` section 2.4.

For those fields the cheap signal is **cross model disagreement**, not a more expensive model. Two
Flash-Lite reads cost about $21 per thousand on a large basket, still a fraction of one Opus read.

## 6. Matching a line to a catalog product

The receipt string is not the storefront string. Mercadona's site says
`Leche semidesnatada Hacendado 1 L brik`; a till prints `LECHE SEMI HACENDADO`. `ItemSourceRef`
(backlog `0001` section 6.1) is the Item to chain identity join and has no field for receipt text.

**A child table, not a column**, because one product prints under several strings over time (the
chain re-abbreviates, a weighed line differs from a unit line, a promo line carries a suffix) and a
column forces you to overwrite and lose the earlier string:

```
ItemReceiptAlias
  itemId, supermarketId        -- chain scoped, matching section 6.1's rule
  receiptTextRaw               -- exactly as printed
  receiptTextNormalized        -- the lookup key
  timesSeen, lastSeenAt
  status  CANDIDATE | ACTIVE
  confidence
```

**It is self improving.** First ticket: fuzzy match, the user confirms, an alias is written. Every
later ticket from that chain hits `receiptTextNormalized` on an exact index lookup, which is O(1),
deterministic and far more reliable than fuzzy matching. A household buys the same sixty or so
products repeatedly, so after a handful of receipts most lines resolve with no fuzzy step and no
model call.

Four rules, each earned from a specific observation:

**Rule R5. Normalization must be aggressive, and it is necessary rather than sufficient.**
Uppercase, decompose accents, strip every non-alphanumeric, collapse whitespace. That collapses
`FONTVELLA 1|5L`, `1.5L`, `1+5L` and `1>5L` to one key. It does **not** collapse a mangled letter:
`QUESO EL JAMÓN` yielded `QUESOELJAMN`, `QUESOELJAMON` and `QUESOELJAMUN` across five readers.
Matching therefore needs one character of edit distance slack, not an equality test.

**Rule R6. Never substitute an illegible character; omit it.** Omission normalizes correctly and
substitution does not. Both key splits in the whole corpus came from a reader guessing a letter,
and one of them was Opus 5 guessing `r` for a mangled `É` in `PATÉ`.

**Rule R7. Pin one model, for consistency rather than accuracy.** An alias key does not need to be
correct, only stable. A model that misreads a word the same way every time still builds one working
alias; rotating models builds several broken ones. Gemini 3.5 Flash-Lite's wrong `FONRVELLA` was
wrong consistently and would have worked.

**Rule R8. A freshly fuzzy matched alias must not write a price.** It lands `CANDIDATE`, a person
confirms it, then it goes `ACTIVE`. This is backlog `0001` section 6.2's rule and it applies here
unchanged: a bad match writing a wrong price onto a real product is worse than having no price.

**`rawText` is not unique within a single receipt either.** Ticket 3 has two byte identical
`FONTVELLA 1|5L` lines differing only in price. Basket reconcile must key on line position, not
description.

## 7. Reading

**One pinned Flash-Lite model at `temperature: 0`**, with the photograph as taken, a strict
`responseSchema`, and no OCR step. There is no preprocessing and none is currently justified.

Current pick is **Gemini 3.5 Flash-Lite**, on this argument: 3.1 Flash-Lite produced both money
errors in the corpus and 3.5 Flash-Lite's failures are in product text. **The two failure kinds
are not equal.** A text error is recoverable and the alias table tolerates it as long as it is
stable; a money error is silent and unrecoverable. Pin the model whose errors the checker can see.

**Cost scales with basket size, not image size.** Input is about 1,600 tokens on every receipt
regardless of length; output ran ~600 tokens on an 8 line receipt and ~5,000 on a 64 line one.
Measured, per thousand receipts across the six tickets: $0.87 to $7.41 for Gemini 3.1 Flash-Lite
and $1.27 to $13.54 for 3.5 Flash-Lite, against $31 to $77 for Opus 5, which never returned
anything the cheap models did not. Escalate to a larger model when a check fails, not by default.

**Operational rule, from ticket 9:** a receipt that fails a checker is re-read with the other
model before anything is written. If the two still disagree, ask the user to **retake the
photograph flat**. That is a far better request than asking them to correct 38 lines.

## 8. Departments and companion tickets

A counter prints the department, not the product: `CARNICERIA` and a price, `PANADERIA 6 x 0.33`,
`Fruteria CASH2` with no numbers at all. On ticket 1 that is 6.88 EUR of 11.48 EUR, 60% of the
basket by value, that this ticket cannot match to any product. Three different shapes have already
been seen, so `isDepartment` is decided at extraction time and every reader agreed on it
unanimously across the whole corpus.

**The detail is not lost, it is on a second ticket.** The counter prints its own ticket for what it
weighed, and the shopper carries both.

- **Catalog prices:** department lines are skipped. The companion ticket is where that price comes
  from, scanned separately.
- **Basket reconcile:** ignore the line and **tell the user**. "This receipt has a 5.97 EUR butcher
  line; scan that counter's ticket to add what it was" is useful. A silent opaque line that can
  never be corrected is not.

**Rule R9. One basket is fed by several tickets.** Departments point at companion tickets, and
tickets 1 and 2 turned out to be consecutive invoice numbers from the same till in the same
minute, one paid cash and one by card. A reconcile that assumes one receipt equals one shop will
under count, and a user scanning both should get one reconciliation rather than two. Group scans by
store, date and close timestamps.

## 9. Basket reconcile

The user's stated goal: a basket had ten items, twenty were bought, scan the receipt to add what is
missing and correct the amounts that differ.

**Rule R10. Propose a diff; never apply one.** A receipt contains things that were never meant for
the shared basket, and plan `0056` made outstanding amounts real money, so a scan must never
auto settle a line.

**Rule R11. A weighed line reconciles on price and never on quantity.** The printed weight is
rounded to one decimal, so `0'1` covers 0.05 to 0.15 kg, a threefold range. "You bought 0.1 kg of
turkey" is wrong by up to 50%.

## 10. Forged and edited receipts

The threat is not a blurry photo, it is a receipt generated or edited to move a price. Backlog
`0001` already absorbs most of it: `USER_RECEIPT` sits at priority 50 in `PricePolicy`, below
`ADMIN` and the official sources, and the community `ItemPrice` is derived from accepted
submissions rather than written directly.

Two additions:

- **`USER_RECEIPT` has no `minSubmissions`** where `USER_REPORTED` requires three, so today one
  receipt can move a community price alone. Given that generating a plausible receipt image is now
  trivial, it wants a `minSubmissions` of its own or a cap on how far one person's receipts can
  move one price.
- **The checkers are a cheap forgery filter**, because a hand edited total usually stops summing.
  Not a strong one, and free, and it runs anyway.

## 11. Out of scope

- **Image storage.** `receiptImageRef` is a column name in backlog `0001`, not a bucket. There is
  no object storage in this stack and choosing one is its own decision.
- **The moderation queue and abuse handling**, which backlog `0001` section 13 parks alongside this
  and which are a bigger surface than the reading is.
- **Any per chain parser.** Section 4.1 is the argument; adding one would forfeit the only property
  that makes this worth building.
- **Preprocessing** (deskew, dewarp, contrast). Ticket 9 suggests dewarping might help, and nothing
  has been measured, so nothing is proposed.

## 12. What would have to be true to schedule this

- Backlog `0001` is built, so the catalog half has an `ItemPrice`, a `PricePolicy` and a
  `PriceSubmission` to write into. **Or** the basket half is taken on its own, which needs none of
  them.
- The remaining four photographs are read, and a receipt carrying a multibuy discount, a loyalty
  deduction and a refunded line has been read and checked.
- Alias stability is measured properly: every product recurring across the corpus, compared per
  model, not one product.
- The v3 prompt and schema changes are made and the corpus re-read under them, so `taxBreakdown`
  is captured and the checkers run at full strength.
- A paid tier latency and quota measurement exists, because every number in `docs/receipt-ocr/` was
  taken on a free tier.
- Image storage is chosen.
