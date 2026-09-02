# Ticket 1 — El Jamón, Córdoba, 28/08/2026, 11.48 €

Five lines, paid cash. Invoice `40002036640`, one above ticket 2's `40002036639`,
same store, same till, same minute: the two are one trip split across two
payments.

This is the ticket that produced the finding which changes the design, and it is
not about model quality at all.

## What the receipt says

|                   |          |           |
| ----------------- | -------- | --------- |
| CARNICERIA        | 1 × 5.97 | 5.97      |
| JUD=AS FINDUS     | 1 × 1.99 | 1.99      |
| GARBANZA FRASC    | 2 × 1.15 | 2.30      |
| AQUADEUS 50CL     | 1 × 0.31 | 0.31      |
| CHARCUTERIA       | 1 × 0.91 | 0.91      |
| **TOTAL FACTURA** |          | **11.48** |

`DESGLOSE I.V.A.`: BASE 8.63 IVA 10.0% 0.86, BASE 1.91 IVA 4.0% 0.08. Tax
inclusive, so the lines sum to the total and there is no subtotal line.

## Results

Every reader got all five lines, every quantity, every unit price and the total
exactly right, and all five balance:

```
BALANCED  claude-haiku-4-5.json        5 lines (2 dept, 6.88) sum 11.48 total 11.48
BALANCED  claude-opus-5.json           5 lines (2 dept, 6.88) sum 11.48 total 11.48
BALANCED  gemini-3.1-flash-lite.json   5 lines (2 dept, 6.88) sum 11.48 total 11.48
BALANCED  gemini-3.5-flash-lite.json   5 lines (2 dept, 6.88) sum 11.48 total 11.48
BALANCED  gemini-3.6-flash.json        5 lines (2 dept, 6.88) sum 11.48 total 11.48
```

**All five independently flagged the same two department lines**, worth the same
6.88 EUR. `isDepartment` needs no examples beyond the list in the prompt and gets
unanimous agreement, so it is safe to rely on.

All five also returned `JUD=AS FINDUS` verbatim, mangled `=` and all, which is the
alias key behaving correctly.

The disagreements are all in fields the arithmetic does not constrain:

| Model                 | `datetime` | `taxTotal` | `paymentMethod` | Latency |
| --------------------- | ---------- | ---------- | --------------- | ------- |
| Claude Opus 5         | 19:36      | 0.94       | EFECTIVO        | —       |
| Claude Haiku 4.5      | **19:30**  | 0.94       | EFECTIVO        | —       |
| Gemini 3.6 Flash      | 19:36      | 0.94       | **cash**        | 36.1 s  |
| Gemini 3.5 Flash-Lite | 19:36      | **null**   | EFECTIVO        | 32.5 s  |
| Gemini 3.1 Flash-Lite | 19:36      | 0.94       | EFECTIVO        | 3.0 s   |

## Three reproducible per-model quirks

Each of these showed up on both tickets or across two independent runs, so none is
a one-off slip.

**Haiku 4.5 misreads the minute: 19:30 for 19:36.** It did this on the v1 prompt
and again on a clean v2 re-read, and the other four readers all say 19:36. This is
the error class the arithmetic checker structurally cannot catch, and it lands on
the one field that matters beyond display: `observedAt` drives the 14 day
eligibility window in `PricePolicy` (backlog `0001` section 2.4).

**Gemini 3.5 Flash-Lite drops `taxTotal`.** Null on this ticket and null on ticket
2, where every other reader found the `DESGLOSE I.V.A.` block both times.

**Gemini 3.6 Flash normalizes verbatim fields.** `EFECTIVO` became `cash` here and
`TARJETA VISA` became `CARD` on ticket 2. Harmless for `paymentMethod`, alarming as
a tendency: the same instinct applied to `rawText` would silently expand receipt
abbreviations and break the alias key. It did not do that, but it is the model to
watch for it.

## Cost

| Model                 | in   | out  | Per ticket | Per 1000 tickets |
| --------------------- | ---- | ---- | ---------- | ---------------- |
| Gemini 3.1 Flash-Lite | 1593 | 520  | $0.00118   | **$1.18**        |
| Gemini 3.5 Flash-Lite | 1593 | 530  | $0.00180   | $1.80            |
| Claude Haiku 4.5      | 1994 | 372  | $0.00385   | $3.85            |
| Gemini 3.6 Flash      | 1593 | 2136 | $0.00920   | $9.20            |
| Claude Opus 5         | 5170 | 372  | $0.03515   | **$35.15**       |

Opus 5 costs 30x Gemini 3.1 Flash-Lite for an answer that differs in nothing.
3.6 Flash spent 1805 thinking tokens against 331 of answer, which is what makes it
the second most expensive option here despite a mid-tier rate.

## The finding that changes the design

**`CARNICERIA` and `CHARCUTERIA` are departments, not products.** The butcher and
deli counters weigh something and the till prints only the counter name and a
price. There is no product, no quantity and no unit.

That is two of five lines, and **6.88 EUR of 11.48 EUR, 60% of this basket by
value, that this ticket cannot match to any catalog product.** No better model and
no better prompt changes it: the information is not on this piece of paper.

**It is on another piece of paper.** The counter prints its own ticket for what it
weighed, with the product, the weight and the price per kilo, and the shopper
carries both. So a department line is a **pointer to a companion ticket**, not a
dead end, and the corpus contains some of those companion tickets.

Consequences:

- **Catalog prices:** skipped on this ticket. The companion ticket is where the
  price for that meat actually comes from, and it is scanned separately.
- **Basket reconcile:** ignore the line for now and **notify the user**. "This
  receipt has a 5.97 EUR butcher line; scan that counter's ticket to add what it
  was" is useful. A silent opaque line that can never be corrected is not, because
  "5.97 EUR of meat" has no quantity to reconcile against.

The practical consequence is that **one basket is fed by several tickets**, which
the consecutive invoice numbers on tickets 1 and 2 already suggested from a
different direction. Coverage then depends on whether the shopper kept the counter
tickets, which is a property of the chain and of the shopper, and should be
measured per chain before anyone promises a number.

## Prompt bugs this ticket exposed

Both were mine, both were found by the readings rather than by review, and both are
fixed in v2 (README section 3):

- `rawText` said "the literal string printed on the receipt", so two of three
  Gemini models returned the whole line with its numeric columns
  (`CARNICERIA              1   5.97   5.97`, padding included). Since `rawText` is
  the alias lookup key, that would mint a fresh alias on every purchase.
- `datetime` had no format instruction and came back as `28/08/2026 19:36`, which
  does not parse. Under v2 every reader returns ISO.

A third rule was added after Haiku invented `subtotal: 10.54` (exactly
`total - taxTotal`) on a receipt that prints no subtotal. `validate.mjs` caught it
with no ground truth, which is the checker doing precisely the job it exists for.
Under v2 no reader invents a subtotal.
