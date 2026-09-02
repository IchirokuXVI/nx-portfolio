# Reading a till receipt with a model

An evaluation, not a design document. It answers one question with evidence:
**can a vision model read a photographed supermarket receipt accurately enough to
write prices into catalog and to reconcile a shared basket**, and if so, which
model is worth paying for.

The design this feeds is already written. Backlog `0001` section 2.6 defines
`PriceSubmission` with `receiptImageRef`, `receiptOcrText` and `ocrConfidence`,
section 2.3 defines the `USER_RECEIPT` source kind, and section 13 explicitly
parks "receipt photo upload and storage, OCR of user receipts, the moderation
queue and abuse handling" for a later plan. This is the measurement that plan
should be written from, so that it is written from usage data rather than from
guesses.

## 1. The two things a receipt is for

They are different, and conflating them is the most expensive mistake available
here.

|                          | Basket reconcile                              | Catalog price                          |
| ------------------------ | --------------------------------------------- | -------------------------------------- |
| Writes to                | core, through the API with the caller's token | catalog, as a `PriceSubmission`        |
| Trust                    | authoritative: I bought this                  | a suggestion, aggregated and moderated |
| Needs a catalog match    | only to correct a quantity                    | always                                 |
| Blast radius of an error | one person's own list                         | every user who sees that price         |

**A receipt is authoritative for my own basket and merely a suggestion for the
shared catalog.** One scan, two write paths. Stating it that way removes the
tension in "a receipt price is stronger user input that still cannot be trusted":
it is fully trusted for the thing it is evidence of, and untrusted for the thing
it is only weak evidence of.

## 2. Why a vision model and not OCR

There is no OCR step. Tesseract on a phone photo of a thermal receipt is poor
(creased, curved, glare-blown, half-faded), and it would leave a second problem
behind: parsing its garbled output per chain, forever. A multimodal model reads
the pixels and produces structure in one step.

Two things make that trustworthy rather than hopeful:

**A strict schema.** `tools/schema.json` is handed to the API as
`responseSchema`, so the model fills a shape rather than writing prose somebody
then parses.

**A deterministic checker the model never sees.** `tools/validate.mjs` is plain
arithmetic. A till receipt carries its own checksum: the lines have to sum to the
total, and each line's quantity times its unit price has to equal its line total.
A hallucinated number does not accidentally satisfy a sum. So every extraction
gets a confidence signal with **no labelled ground truth and no human**, which is
what makes the volume affordable.

Its limits are exact and worth stating: **it catches invented money and nothing
else.** A misread timestamp and a misread product name are unconstrained by
anything on the paper. The timestamp matters, because `observedAt` drives the
14 day eligibility window in backlog `0001` section 2.4.

## 3. Method

Every reader gets the identical prompt (`tools/prompt.txt`) and the identical
schema, at `temperature: 0`, with the photograph exactly as the phone took it
(3000x4000, roughly 3 MB, no downscaling or preprocessing).

```sh
# one ticket, five Gemini models, measured usage into usage.json
node tools/run-gemini.mjs ticket-02/receipt.jpg ticket-02

# score every reading in a ticket folder
node tools/validate.mjs ticket-02

# what that ticket cost each model
node tools/cost.mjs ticket-02
```

Claude readings are produced by hand through the Claude Code harness (Opus 5 is
the session model; Haiku 4.5 runs as a subagent) rather than through a billed API
call, because this machine holds no Anthropic credential.

**Prompt versions.** Ticket 1 was first read with a v1 prompt that had two bugs of
our own making, both found by the readings rather than by review:

- `rawText` said "the literal string printed on the receipt", and two of three
  Gemini models correctly returned the whole line including the numeric columns
  (`CARNICERIA 1 5.97 5.97`). Since `rawText` is the alias lookup key (section 5),
  that would have poisoned the alias table with prices baked into the key, so
  every purchase would mint a new alias.
- `datetime` carried no format instruction, and came back as the receipt's own
  `28/08/2026 19:36`, which does not parse.

v2 fixes both, adds the `isDepartment` flag that section 4 argues for, and adds an
explicit "if no subtotal is printed, subtotal is null" after a model computed one.
Every ticket in this folder is v2; ticket 1 was re-read under it.

## 4. What the receipts themselves turned out to be like

This is the part that changes the design, and none of it is about model quality.

**Counter departments are not products.** A butcher or deli counter weighs
something and the till prints `CARNICERIA` and a price. There is no product name,
no quantity and no unit. On ticket 1 that is two lines of five, and 6.88 EUR of
11.48 EUR: **60% of the basket by value is unmatchable to any catalog product by
any technique**, because the information is not on the paper. No better model, no
better prompt and no alias table changes that.

So the line schema carries `isDepartment`, decided at extraction time, and:

- **Catalog prices:** department lines are skipped. There is nothing to attach a
  price to.
- **Basket reconcile:** they become opaque lines, a description and a price with
  no `itemId`, added but never used to correct a quantity.

Receipt coverage of the catalog will therefore be much patchier than a line count
suggests, and that should be measured per chain before anyone promises otherwise.

**One photo can hold two documents.** A receipt paid by card is usually printed
attached to the card slip, which repeats the total (`Venta 16,20`) and carries its
own date, time and amount. Nothing may read the slip's amount as another line.

**The two documents can disagree.** On ticket 2 the receipt says `TARJETA VISA`
and the slip below it says `Debit Mastercard`. Neither is a misreading.

**Thermal printers mangle accents.** `JUDÍAS` prints as `JUD=AS`. The alias key
must normalize aggressively (strip accents, punctuation and non-alphanumerics)
rather than trust the raw string, and one model silently "corrected" it to
`JUD-AS`, which is exactly the drift normalization has to absorb.

**Spanish receipts are tax inclusive.** `IVA Incluido` means the lines already
carry the tax, so lines sum to the total and the `DESGLOSE I.V.A.` block is
informational. There is usually no subtotal line at all, and asking for one
invites a model to compute it.

## 5. Matching a line to a catalog product

The receipt string is not the storefront string. Mercadona's site says
`Leche semidesnatada Hacendado 1 L brik`; the till prints `LECHE SEMI HACENDADO`.
So the receipt text needs its own home, and `ItemSourceRef` (backlog `0001`
section 6.1) has no field for it.

A child table rather than a column, because one product prints under several
strings over time (the chain re-abbreviates, a weighed line differs from a unit
line, a promo line carries a suffix), and a column forces you to overwrite and
lose the earlier string:

```
ItemReceiptAlias
  itemId, supermarketId        -- chain scoped, matching section 6.1's rule
  receiptTextRaw               -- exactly as printed
  receiptTextNormalized        -- the lookup key
  timesSeen, lastSeenAt
  status  CANDIDATE | ACTIVE
  confidence
```

**It is self-improving and converges fast.** First ticket: fuzzy match, the user
confirms, an alias is written. Every later ticket from that chain hits
`receiptTextNormalized` on an exact index lookup, which is O(1), deterministic and
far more reliable than fuzzy matching. A household buys the same 60 or so products
repeatedly, so after a handful of tickets most lines resolve with no fuzzy step and
no model call at all.

One rule carried over from backlog `0001` section 6.2, because it already bit the
harvester design: **a freshly fuzzy-matched alias must not write a price.** It
lands `CANDIDATE`, a person confirms it, then it goes `ACTIVE`. A bad match writing
a wrong price onto a real product is worse than having no price.

## 6. Forged and edited tickets

The threat is not a blurry photo, it is a receipt somebody generated or edited to
move a price. The existing model already absorbs most of it: `USER_RECEIPT` sits
at priority 50 in `PricePolicy`, below `ADMIN` (10) and the official sources
(20/30), so a forgery structurally cannot outrank a real price, and the community
`ItemPrice` is derived from accepted submissions rather than written directly.

Two additions this evaluation suggests:

- **`USER_RECEIPT` has no `minSubmissions`**, where `USER_REPORTED` requires 3.
  Today one ticket can move a community price on its own. Given that generating a
  plausible receipt image is now trivial, it wants either a `minSubmissions` of its
  own or a cap on how far one person's receipts can move one price.
- **The arithmetic checker is a cheap forgery filter.** A hand-edited total usually
  stops summing. It is not a strong one (a careful forger keeps the sums), but it is
  free, and it runs anyway.

## 7. Cost

`tools/cost.mjs` prints per-ticket and per-thousand cost from measured usage.
Rates in USD per million tokens, from the vendors' own pricing pages
(<https://ai.google.dev/gemini-api/docs/pricing>, <https://claude.com/pricing>),
fetched 2026-09-02:

| Model                 | Input | Output |
| --------------------- | ----- | ------ |
| Claude Opus 5         | $5.00 | $25.00 |
| Claude Haiku 4.5      | $1.00 | $5.00  |
| Gemini 3.7 Flash      | $0.75 | $3.75  |
| Gemini 3.6 Flash      | $0.75 | $3.75  |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50  |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50  |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40  |

Gemini 3.7 and 3.6 Flash are on promotional pricing through 31 December 2026 and
double on 1 January 2027. Anything built on them should be costed at $1.50/$7.50.

**Gemini figures are measured** from the `usageMetadata` each response carried.
**Claude figures are computed**, because there is no Anthropic credential on this
machine: a visual token is a 28x28 patch, so an image costs
`ceil(w/28) * ceil(h/28)` after downscaling to the model's tier ceiling. Opus 5 is
high-resolution tier (2576 px long edge, 4784 visual tokens); Haiku 4.5 is standard
tier (1568 px, 1568 visual tokens). A 3000x4000 photo is 12 megapixels, so **both
land on their token ceiling** and the photo's exact dimensions stop mattering.
Treat them as the right order of magnitude, not as an invoice.

## 8. Which models can actually be used

Listed by `GET /v1beta/models` is not the same as reachable. Of the five Gemini
models originally chosen, **two cannot be used at all** on this key:

| Model                 | Status                                           |
| --------------------- | ------------------------------------------------ |
| Gemini 3.1 Flash-Lite | works, and is the fastest thing here (3.0-3.4 s) |
| Gemini 3.5 Flash-Lite | works, slow (32-36 s)                            |
| Gemini 3.6 Flash      | works, slow (11-36 s), and bills heavy thinking  |
| Gemini 3.7 Flash      | **unreachable.** Hangs and never answers         |
| Gemini 2.5 Flash-Lite | **HTTP 404**, "no longer available to new users" |

`gemini-2.5-flash-lite` is still listed by the models endpoint but returns 404
with a message redirecting to `gemini-3.5-flash-lite`. It is retired for keys
created after some cutoff.

`gemini-3.7-flash` is the more interesting failure: it is listed, it accepts the
request, and then it never responds. Three attempts, two with a 12 megapixel image
(240 s deadline, both hit it) and **one with a two-word text prompt and no image at
all**, which also timed out at 45 s. So it is not an image or payload problem; the
model is simply not answering on this key. Anything depending on it needs a
deadline and a fallback, which is why `run-gemini.mjs` grew one after the first run
hung for nine minutes with no output.

Free-tier queueing is visible throughout and makes latency an unreliable signal
here: `gemini-3.6-flash` took 25.9 s to answer `OK` to a text-only prompt, and
11 s to read a whole receipt. Do not read these latencies as model speed; read them
as "this tier is not for interactive use".

## 9. Where it stands after two tickets

**Accuracy is not the differentiator. Every reader got every number right on both
tickets.** Ten readings, ten `BALANCED`. `isDepartment` was unanimous. The alias
key came back verbatim from all five, mangled characters included.

That means model choice is decided by cost, latency and the unconstrained fields:

| Model                 | Per 1000 tickets | Reproducible quirk                                |
| --------------------- | ---------------- | ------------------------------------------------- |
| Gemini 3.1 Flash-Lite | $0.87 - $1.18    | none seen; sometimes leaves `unit` null           |
| Gemini 3.5 Flash-Lite | $1.27 - $1.80    | drops `taxTotal` on both tickets                  |
| Claude Haiku 4.5      | $3.04 - $3.85    | misreads the minute (19:30 for 19:36), twice      |
| Gemini 3.6 Flash      | $5.22 - $9.20    | normalizes verbatim fields (`EFECTIVO` to `cash`) |
| Claude Opus 5         | $31.10 - $35.15  | none seen                                         |

**Opus 5 costs about 30x Gemini 3.1 Flash-Lite and returned nothing the cheap model
did not.** On this evidence it is not the production reader; it is the thing to
escalate to when the checker says the arithmetic did not close.

**Cross-model agreement catches what arithmetic cannot.** Haiku's 19:30 is invisible
to `validate.mjs` (a timestamp has no checksum) but obvious against four readers
saying 19:36. Two cheap models disagreeing on an unconstrained field is a cheaper
and better signal than one expensive model asserting it alone: two Flash-Lite reads
cost about $2 per thousand together, still a fifteenth of one Opus read.

**The shape this suggests**, to be confirmed over the remaining eight tickets:

1. Read with Gemini 3.1 Flash-Lite.
2. Run `validate.mjs`. If it balances and nothing else is odd, accept.
3. If it does not balance, read again with a second model and compare.
4. If they still disagree, that receipt goes to the user to confirm.

**Caveat, and it is a real one: two tickets is not evidence of accuracy.** Both are
from the same chain, on the same day, and neither has a weighed item, a
multibuy discount, a loyalty deduction, a returned item or a faded print. Those are
where extraction actually gets hard, and nothing here has tested them yet. What
these two tickets do establish is that the easy case is comfortably solved by the
cheapest tier, and that the interesting problems are in the receipts rather than in
the models.

## 10. Layout

```
receipt-ocr/
  README.md              this report
  tools/
    prompt.txt           the prompt every reader gets (v2)
    schema.json          the response schema every reader gets (v2)
    run-gemini.mjs       runs one image across several Gemini models
    validate.mjs         the arithmetic checker
    cost.mjs             measured and computed cost per model
  ticket-NN/
    receipt.jpg          the photograph as taken
    <model-id>.json      that model's reading
    usage.json           measured tokens and latency per Gemini model
    report.md            what that ticket showed
```

The photographs are committed at full size (roughly 3 MB each) so a reading can
always be checked against exactly what the model saw.
