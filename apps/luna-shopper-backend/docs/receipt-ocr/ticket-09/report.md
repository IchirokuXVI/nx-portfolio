# Ticket 9 — Super Cash, Córdoba, 14/08/2026, 111.79 €

41 lines, and the photograph is bad: the receipt was heavily curled and the top
third curves away from the camera, so the first ten lines are blurred, skewed, and
**the numeric columns sit visibly higher than the descriptions they belong to.**

This was chosen as the stress case. It is the most valuable ticket in the corpus,
and not because a model failed — because of _how_ it failed.

## Results

|                    | Opus 5 (reference) | Gemini 3.5 Flash-Lite | Gemini 3.1 Flash-Lite |
| ------------------ | ------------------ | --------------------- | --------------------- |
| Lines              | 41                 | 41                    | 41                    |
| Departments        | 2 (5.09 €)         | 2 (5.09 €)            | 2 (**4.28 €**)        |
| Line sum           | 111.79             | 111.79                | **110.37**            |
| `validate.mjs`     | BALANCED           | **BALANCED**          | MISMATCH              |
| Money vs reference | —                  | **0 of 41 wrong**     | **38 of 41 wrong**    |

The Opus 5 reading here is a genuine reference rather than an adjudication: it was
transcribed from full-resolution crops and it sums to 111.79 to the cent, unaided.
**Gemini 3.5 Flash-Lite matches it on all 41 line totals exactly**, on the worst
photograph in the corpus.

## The failure that matters: an off-by-one row shift

3.1 Flash-Lite did not misread a digit. It **associated every description with the
next line's numbers, for the entire receipt**:

```
line  2  Ambientador AIR WICK       ref 4.20   got 1.35   <- line 3's value
line  3  Bizcocho horneado CODAN    ref 1.35   got 0.60   <- line 4's value
line  4  Budín de cerdo PROLONGO    ref 0.60   got 1.19   <- line 5's value
...
line 38  Salchichas AIA Wudy        ref 2.96   got 0.99   <- line 39's value
```

The shift runs from line 2 to line 40 without a break. It drops line 2's `4.20`
off the front and duplicates line 41's `2.78` at the back, so:

```
111.79 - 4.20 + 2.78 = 110.37
```

which is exactly the sum the checker reported. **38 of 41 lines carry the wrong
price, and every single one of them is individually plausible** — a real product
from this receipt paired with a real amount from this receipt. Nothing about any
one line looks wrong. Spot-checking a sample would not find it. A second opinion
from a human glancing at the output would not find it.

`validate.mjs` found it immediately, from a 1.42 € gap.

**This is the strongest argument the corpus contains for the checksum.** Without
it, this reading would have been accepted and would have written 38 wrong prices
into catalog and 38 wrong lines into somebody's basket, silently.

### Why the checksum still works when the lines do not

Both models read `total: 111.79` correctly even while one of them had every line
shifted. The total sits in the flat, well-lit lower third of the photograph; the
lines that failed are in the curled top. **The checksum works precisely because its
two sides fail independently**: the total is legible when the lines are not, and a
systematic corruption of the lines cannot corrupt the total to match.

That independence is worth protecting. It is also why "the model said it balances"
would be worthless and "the arithmetic balances" is not.

### The physical cause

The full-resolution crop of the curled section shows it plainly: as the paper
curves, the right-hand numeric columns are displaced upward relative to the
description column, by roughly half a row and growing toward the top edge. A reader
has to associate across that offset. 3.1 Flash-Lite locked onto the wrong offset and
held it consistently, which is why the error is systematic rather than scattered.

## What this does and does not say about model choice

3.5 Flash-Lite has now been the better reader on both large tickets (5 and 9) while
being the worse one on the small clear tickets (its `FONRVELLA` and `JAMUN` letter
errors, and its habit of deriving `subtotal`). 3.1 Flash-Lite has now produced the
only two money errors in the corpus, both on large receipts.

That is a consistent enough pattern to act on: **small-ticket accuracy did not
predict large-ticket accuracy, and it inverted.** If one model has to be pinned,
the evidence now points at 3.5 Flash-Lite, whose failures are in product text
(recoverable, and the alias table only needs stability) rather than in money
(silent, and catastrophic).

Description accuracy remains the weak half for both: against the reference, 3.1
Flash-Lite differs on 9 normalized keys of 41 and 3.5 Flash-Lite on 11, almost all
in the curled top rows and the mangled accented characters (`CAMPOFRÍO`,
`GARCÍA`, `TULIPÁN`, `SUSARÓN`).

## A fix to `vat-check.mjs`

The tax block reconciles to 111.80 against a printed total of 111.79. That one cent
is real and harmless: each group's tax is rounded independently, so three groups can
drift a cent or two from the total with nothing wrong. The check now allows one cent
per group and says so. Ticket 4's genuine 0.72 € error still fails, as it must.

## Cost

| Model                 | in   | out  | Per ticket | Per 1000 tickets |
| --------------------- | ---- | ---- | ---------- | ---------------- |
| Gemini 3.1 Flash-Lite | 1593 | 3088 | $0.00503   | **$5.03**        |
| Gemini 3.5 Flash-Lite | 1593 | 3434 | $0.00906   | $9.06            |
| Claude Opus 5         | 5170 | 2031 | $0.07662   | **$76.63**       |

Opus 5 is now 15x the cost of the reader that matched it line for line.

## The verdict on the hard case

A badly photographed 41 line receipt is **survivable, but only because the
extraction is checked.** One of the two models read it perfectly; the other
corrupted 93% of it in a way no human reviewer would catch by eye, and the
difference between those two outcomes was detected for free, in milliseconds, by
summing a column.

The practical consequence for the product: a receipt that fails the checksum should
be re-read with the other model before anything is written, and if the two still
disagree the user should be asked to retake the photo — flat, not curled. That is a
better prompt than asking them to correct 38 lines.
