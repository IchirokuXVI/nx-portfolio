# Ticket 3 — El Jamón, Córdoba, 17/07/2026, 9.29 €

Six lines, paid by card, photographed with the card slip attached. A different
trip from tickets 1 and 2 (July rather than August), badly creased across the tax
block, and the first ticket here with **no department lines at all**.

It is also the ticket that breaks the most useful assumption in the design so far.

## What the receipt says

|                   |          |          |
| ----------------- | -------- | -------- |
| ESPETEC ELIGES    | 1 × 2.10 | 2.10     |
| QUESO EL JAM"N    | 1 × 3.00 | 3.00     |
| IBERITOS 250G     | 1 × 2.29 | 2.29     |
| MINI BISCOTES     | 1 × 0.76 | 0.76     |
| FONTVELLA 1\|5L   | 1 × 0.38 | 0.38     |
| FONTVELLA 1\|5L   | 1 × 0.76 | 0.76     |
| **TOTAL FACTURA** |          | **9.29** |

## Results

Every reader got all six lines, every quantity, every unit price and the total
exactly right. The lines sum to 9.29 to the cent.

## The finding: `rawText` is not reproducible across models

Five readers produced **four different strings for one product and four for
another**:

| Reader                | `FONTVELLA` line  | `QUESO` line     |
| --------------------- | ----------------- | ---------------- |
| Claude Opus 5         | `FONTVELLA 1\|5L` | `QUESO EL JAM"N` |
| Claude Haiku 4.5      | `FONTVELLA 1.5L`  | `QUESO EL JAMON` |
| Gemini 3.1 Flash-Lite | `FONTVELLA 1.5L`  | `QUESO EL JAM"N` |
| Gemini 3.6 Flash      | `FONTVELLA 1+5L`  | `QUESO EL JAM"N` |
| Gemini 3.5 Flash-Lite | `FONRVELLA 1>5L`  | `QUESO EL JAMUN` |

The till prints `1'5L` with a mangled separator glyph and `JAMÓN` with a mangled
`Ó`, and each reader guessed a different plausible character. **If `rawText` were
the alias key as-is, one product would mint four aliases**, and the self-improving
lookup described in the README section 5 would never converge.

**Normalization fixes the punctuation half completely, and the letter half not at
all.** Uppercasing, decomposing accents and stripping every non-alphanumeric:

```
FONTVELLA 1|5L  ->  FONTVELLA15L      4 of 5 readers
FONTVELLA 1.5L  ->  FONTVELLA15L
FONTVELLA 1+5L  ->  FONTVELLA15L
FONRVELLA 1>5L  ->  FONRVELLA15L      survives (T read as R)

QUESO EL JAM"N  ->  QUESOELJAMN       3 of 5 readers
QUESO EL JAMON  ->  QUESOELJAMON      survives (mangling read as O)
QUESO EL JAMUN  ->  QUESOELJAMUN      survives (mangling read as U)
```

That is the sharp result: **the separator noise vanishes, but a mangled letter does
not, and `QUESO EL JAMÓN` yields three distinct normalized keys across five
readers.** Punctuation is noise that normalization deletes; a mangled character is
a hole each reader fills differently, and `"`, `O` and `U` are three different
letters after stripping is done.

Four conclusions follow, and they are the practical output of this ticket:

1. **`receiptTextNormalized` is the key, and normalization must be aggressive**:
   uppercase, decompose accents, strip every non-alphanumeric, collapse whitespace.
   Storing `receiptTextRaw` beside it is still right, but nothing may look up by it.
2. **Normalization is necessary and not sufficient.** Matching a fresh reading to an
   existing alias needs edit-distance tolerance, not just an equality test, or
   `QUESOELJAMON` and `QUESOELJAMN` are two products forever. One character of
   Levenshtein slack covers every case seen here.
3. **Pin one model for reading.** Consistency matters more than per-model accuracy
   for a key: a model that misreads the same word the same way every time still
   builds one working alias, whereas rotating models builds several broken ones.
   This is a much stronger argument than the cost table, and it points the same way.
4. **A `CANDIDATE` alias needs `timesSeen` before it goes `ACTIVE`**, which backlog
   `0001` section 6.2 already implies for fuzzy matches. A one-off `FONRVELLA15L`
   never reaches the threshold and quietly dies.

## `rawText` is not unique within a single receipt either

The two `FONTVELLA 1|5L` lines are byte-identical in description and differ only in
price: 0.38 and 0.76. Every reader read both correctly and kept them separate.

So an alias lookup returns a product, but **a line cannot be identified by its text
within one receipt**. Anything that reconciles a basket has to key on the line's
position, not its description, or it will merge two lines that the till deliberately
kept apart. (0.76 being exactly 2 × 0.38 suggests the second line is two bottles
rung up at unit price, but the till printed quantity 1 on both, so that is a guess
and the extraction correctly does not make it.)

## The tax block does not reconcile, and the schema cannot see it

`DESGLOSE I.V.A.` reads BASE 5.37 IVA 10.0% 0.54, and BASE 3.62 IVA 4.0% 0.14.
Each group is internally consistent (5.37 × 10% = 0.54; 3.62 × 4% = 0.14), but
together they gross up to **9.67, which is 0.38 more than the 9.29 total**.

Four readers independently agree on `taxTotal` 0.68, and 3.5 Flash-Lite
independently read the bases as summing to 8.99, so the reading is corroborated
rather than a one-off slip. The photograph is heavily creased straight through that
block, so a misread digit is the likeliest explanation; a genuinely inconsistent
receipt is the other.

**The important part is that the checker could not tell us which.** `validate.mjs`
tests lines against the total and never sees the tax bases, because `schema.json`
does not capture them. A receipt's tax breakdown is a **second, independent
checksum** over the same money, and capturing it as a `taxBreakdown` array of
`{ rate, base, tax }` would let the checker cross-examine a region it is currently
blind to. That is a v3 change, deliberately not made mid-corpus so tickets stay
comparable.

It surfaced at all only because 3.5 Flash-Lite broke rule 3 and derived
`subtotal: 8.99` from the bases, which the checker then flagged:

```
MISMATCH  gemini-3.5-flash-lite.json   6 lines (0 dept, 0) sum 9.29 total 9.29
    - lines net to 9.29, subtotal says 8.99
```

A rule violation that exposes a real inconsistency is a good argument for capturing
the field properly rather than for forbidding it harder.

**Resolved by ticket 4.** `tools/vat-check.mjs`, written for that ticket, runs the
check this section wished for. Against ticket 1 the tax block reconciles exactly,
which confirms the semantics (base plus tax equals the group's gross, and the groups
gross to the total). Against tickets 3 and 4 it fails in the same place both times,
the 4% group, on the two most creased photographs. So the receipts are fine and the
reading of that one figure is not: here the 4% group's true gross is
`9.29 - 5.91 = 3.38` (base 3.25, tax 0.13), read as 3.62 and 0.14.

## The card slip contaminated two fields

Ticket 2 established that the photo holds two documents that disagree. Here that
stopped being a curiosity and started producing wrong answers:

| Reader                | `datetime`   | `paymentMethod`      | Source        |
| --------------------- | ------------ | -------------------- | ------------- |
| Claude Opus 5         | 20:52:00     | TARJETA VISA         | receipt       |
| Gemini 3.1 Flash-Lite | 20:52:00     | TARJETA VISA         | receipt       |
| Gemini 3.5 Flash-Lite | 20:52:00     | TARJETA VISA         | receipt       |
| Gemini 3.6 Flash      | **20:52:44** | TARJETA VISA         | mixed         |
| Claude Haiku 4.5      | **20:52:44** | **Debit Mastercard** | **card slip** |

The receipt prints `20:52` and `TARJETA VISA`; the slip prints `20:52:44` and
`Debit Mastercard`. Haiku read the whole of its answer off the slip, and 3.6 Flash
read half of it.

Neither is a misreading in the OCR sense, and that is what makes it dangerous: the
arithmetic checker cannot see it, and the values are individually plausible. **The
prompt has to say which document is authoritative**, which v2 never does — it says
"a supermarket till receipt" and leaves a reader looking at two of them to choose.
That is a v3 fix and it is cheap: name the receipt as the source of every field and
say the card slip is to be ignored entirely.

It also lands on the field that matters. `datetime` becomes `observedAt`, which
drives the 14 day eligibility window in `PricePolicy` (backlog `0001` section 2.4),
and Haiku has now been the outlier on `datetime` on two of the three tickets.

**3.5 Flash-Lite reported `taxTotal`; 3.6 Flash did not.** The exact reverse of
tickets 1 and 2, where 3.5 Flash-Lite was the one dropping it. Neither model's
tax-block behavior is stable.

## Cost

| Model                 | in   | out  | Per ticket | Per 1000 tickets |
| --------------------- | ---- | ---- | ---------- | ---------------- |
| Gemini 3.1 Flash-Lite | 1593 | 613  | $0.00132   | **$1.32**        |
| Gemini 3.5 Flash-Lite | 1593 | 634  | $0.00206   | $2.06            |
| Claude Haiku 4.5      | 1994 | 430  | $0.00414   | $4.14            |
| Gemini 3.6 Flash      | 1593 | 2640 | $0.01109   | $11.09           |
| Claude Opus 5         | 5170 | 430  | $0.03660   | **$36.60**       |

3.6 Flash spent 2015 thinking tokens against 625 of answer and used them to take a
timestamp off the wrong document.

**Latency was not stable between models or runs.** 3.1 Flash-Lite took 11.0 s here
against 3.0 s on ticket 1, and 3.5 Flash-Lite took 3.5 s here against 32.5 s on
ticket 1 — the two swapped places. On a free tier these numbers measure the queue,
not the model, and nothing should be chosen on them.
