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

**Counter departments are not products, on that ticket.** A butcher or deli
counter weighs something and the till prints `CARNICERIA` and a price, with no
product name. On ticket 1 that is two lines of five, and 6.88 EUR of 11.48 EUR,
60% of the basket by value.

They are not always quantity-less: ticket 4's `PANADERIA 6 × 0.33 = 1.98` is six
bread rolls counted at the bakery counter, with a real quantity and a real unit
price. Only the product name is missing, which is enough to block a catalog match
and not enough to block a useful notice.

**But the detail is not lost, it is on a second ticket.** The counter prints its
own ticket for what it weighed, and the shopper carries both. So a department line
is not permanently opaque; it is a pointer to a companion ticket that has the
product, the weight and the price per kilo. Several of the photographs in this
corpus are those companion tickets, which is also why the corpus has more tickets
than shopping trips.

That changes the shape of the feature rather than the schema. `isDepartment` still
gets decided at extraction time, and:

- **Catalog prices:** department lines are skipped. There is nothing on this ticket
  to attach a price to. The companion ticket, scanned separately, is where the
  price actually comes from.
- **Basket reconcile:** ignore them for now and **tell the user**. A department line
  means "there is another ticket for this", so the useful behavior is a notice
  ("this receipt has a 5.97 EUR butcher line; scan that counter's ticket to add what
  it was"), not a silent opaque line and not a guess.

This is the argument for **scanning several tickets into one basket** as the normal
case rather than the exception, which the consecutive invoice numbers on tickets 1
and 2 already pointed at from a different direction.

Receipt coverage of the catalog is therefore better than a single ticket suggests
and worse than a line count suggests, and it depends on whether the shopper kept
the counter tickets. It should be measured per chain before anyone promises a
number.

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

## 9. Where it stands after four tickets

**The line total is solved. The rest is not, and the checker's silence is not
evidence.** Eighteen readings; every reader got every line, quantity, unit price
and total right on all four tickets, and `isDepartment` was unanimous throughout.

Ticket 4 is the one that matters, because **every reader made the same error there
and `validate.mjs` reported `BALANCED` anyway.** The tax block was misread, and the
line-versus-total sum cannot see the tax block. A clean run of the checker means
"the lines add up", not "the reading is right", and the difference had not shown up
before ticket 4 because nothing was testing the rest.

Everything still open is in the fields arithmetic cannot see:

| Model                 | Per 1000 tickets | Reproducible quirk                                               | Status  |
| --------------------- | ---------------- | ---------------------------------------------------------------- | ------- |
| Gemini 3.1 Flash-Lite | $0.87 - $1.50    | none; sometimes leaves `unit` null, shortens `paymentMethod`     | kept    |
| Gemini 3.5 Flash-Lite | $1.27 - $2.39    | letter-level misreads (`FONRVELLA`, `JAMUN`); derives `subtotal` | kept    |
| Claude Opus 5         | $31.10 - $39.15  | guessed a letter for an illegible glyph (ticket 4)               | kept    |
| Claude Haiku 4.5      | $3.04 - $4.14    | reads the card slip instead of the receipt; wrong minute twice   | dropped |
| Gemini 3.6 Flash      | $5.22 - $11.09   | normalizes verbatim fields; heavy thinking spend                 | dropped |

Haiku 4.5 and 3.6 Flash were dropped after ticket 3, so their ranges cover tickets
1 to 3 only.

**Opus 5 costs about 26x Gemini 3.1 Flash-Lite and has returned nothing the cheap
model did not.** On ticket 4 it was the only reader to produce a wrong normalized
key. It is not the production reader; it is what to escalate to when a check fails.

**Gemini 3.1 Flash-Lite is the pick.** Cheapest, no quirk seen in four tickets, and
the only reader that has never taken a value off the card slip.

**Cross-model agreement catches what arithmetic cannot.** Haiku's `19:30` and its
`Debit Mastercard` are both invisible to `validate.mjs` and both obvious against
four readers disagreeing. Two cheap reads cost about $2 per thousand together,
still a fifteenth of one Opus read, which makes disagreement the cheapest
confidence signal available for the unconstrained fields.

**Pin one model, and pin it for consistency rather than accuracy.** Ticket 3 showed
five readers producing four spellings of one product and three distinct normalized
keys for another. A model that misreads a word the same way every time still builds
one working alias; rotating models builds several broken ones.

**The shape this suggests**, to be confirmed over the remaining seven tickets:

1. Read with Gemini 3.1 Flash-Lite, always the same model.
2. Run `validate.mjs`. If it balances and nothing else is odd, accept.
3. If it does not balance, read again with a second model and compare.
4. If they still disagree, that receipt goes to the user to confirm.

### Three v3 changes the corpus now argues for

None is made yet, deliberately, so the corpus stays comparable across tickets.

- **Capture the tax breakdown**, as `taxBreakdown: [{ rate, base, tax }]`. This is
  no longer a nice-to-have. A Spanish receipt is tax inclusive, so every line
  belongs to exactly one VAT group and each group's gross is the sum of its own
  lines: the block **partitions the lines**, which is a far stronger constraint than
  a second total. `tools/vat-check.mjs` shows what that buys. On ticket 4 it proved
  the 4% figures wrong (no subset of lines can reach 3.80), localized the error to
  that one group, and derived what it had to be (gross 3.08, base 2.96, tax 0.12).
  It is the only thing in the pipeline that caught a real error on that ticket, and
  `schema.json` currently throws the data away.
- **Never substitute an illegible character.** Ticket 4 made the rule precise:
  omission normalizes correctly, substitution does not. `BOCAT"N` and `BOCAT N`
  both normalize to `BOCATN180G`, but a guessed letter survives normalization and
  mints a permanent second key. Both key splits in the corpus so far came from a
  reader guessing (3.5 Flash-Lite's `JAMUN` on ticket 3, and Opus 5's `PATR` on
  ticket 4). The prompt should say: if a character is illegible, leave it out.
- **Name the authoritative document.** The prompt says "a supermarket till receipt"
  and never says what to do when the photo holds the receipt _and_ its card slip.
  On ticket 3 two readers took `datetime` from the slip and one took
  `paymentMethod` too. "Read only the receipt; ignore the card payment slip
  entirely" is a one-line fix for a class of error the checker cannot see.

**Caveat, still real: four tickets is not evidence of accuracy.** All four are the
same chain, and none has a weighed item, a multibuy discount, a loyalty deduction
or a returned item. Ticket 5 is the first from a different supermarket and the
first large one; ticket 9 is large and badly photographed. Those are the tests that
will actually decide this.

## 10. Layout

```
receipt-ocr/
  README.md              this report
  tools/
    prompt.txt           the prompt every reader gets (v2)
    schema.json          the response schema every reader gets (v2)
    run-gemini.mjs       runs one image across several Gemini models
    validate.mjs         the arithmetic checker (lines against the total)
    vat-check.mjs        the second checksum (the tax block against the lines)
    cost.mjs             measured and computed cost per model
  ticket-NN/
    receipt.jpg          the photograph as taken
    <model-id>.json      that model's reading
    usage.json           measured tokens and latency per Gemini model
    report.md            what that ticket showed
```

The photographs are committed at full size (roughly 3 MB each) so a reading can
always be checked against exactly what the model saw.
