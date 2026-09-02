# Ticket 5 — Super Cash (Deza Calidad, S.A.), Córdoba, 21/08/2026, 154.67 €

**64 lines, a different supermarket, and a completely different receipt format.**
This is the ticket the evaluation existed to reach: everything before it was one
chain and at most eight lines.

## What makes it a different problem

Nothing about this receipt looks like El Jamón's:

|                   | El Jamón (tickets 1-4)           | Super Cash (this one)                            |
| ----------------- | -------------------------------- | ------------------------------------------------ |
| Decimal separator | `.` (`1.29`)                     | **`'`** (`1'29`)                                 |
| Columns           | unlabelled                       | headed `Descripcion / Cantidad / Pvo / Importe`  |
| Descriptions      | short, abbreviated               | long, **truncated by the till at ~35 chars**     |
| Line order        | order of scanning                | **alphabetical**                                 |
| Quantities        | integers                         | integers **and fractional kg** (`0'1`, `0'2`)    |
| Tax block         | `DESGLOSE I.V.A.`, BASE/IVA rows | `Tipo / Base / Iva` table                        |
| Department lines  | `CARNICERIA`, with a price       | `Fruteria CASH2`, **no quantity, no unit price** |

**Not one line of the prompt or schema was changed for it**, and both models read
it. That is the generality result, and it is the answer to the question this whole
evaluation was set up to ask: a schema-constrained vision model transfers to an
unseen chain with no per-chain work, where a per-format parser would have needed a
new parser.

## Results

|                  | Gemini 3.1 Flash-Lite | Gemini 3.5 Flash-Lite |
| ---------------- | --------------------- | --------------------- |
| Lines found      | 64                    | 64                    |
| Department lines | 3 (5.92 €)            | 3 (5.92 €)            |
| Line total sum   | 160.73                | **154.67**            |
| `validate.mjs`   | MISMATCH              | **BALANCED**          |
| `vat-check.mjs`  | passes                | passes                |

**Line totals agree on 63 of 64 lines (98%).** The single disagreement is the whole
error:

```
  9  A: "Cabeza de jabalí SUPREMA PICKEN con" 0.51 x 13.9 = 6.96
     B: "Cabeza de jabalí SUPREMA PICKEN con" 0.1  x 13.9 = 0.90
```

`160.73 - 154.67 = 6.06`, and `6.96 - 0.90 = 6.06`. One misread `importe` on a
64-line receipt, and the checksum caught it. Cropping that row out of the original
at full resolution confirms the printed figure is `0'90`, so **3.5 Flash-Lite is
right and 3.1 Flash-Lite is wrong** — a reversal of the ranking from tickets 1 to 4.

The tax block reconciles exactly: `80.29 + 45.35 + 29.03 = 154.67`, all three
groups internally consistent. This chain's block is trustworthy where El Jamón's
creased ones were not.

## The finding: a weighed line does not multiply out, by design

Six lines on this receipt are priced by weight, and **not one of them satisfies
`quantity × unitPrice == lineTotal`**:

| Printed                                 | `q × up` | Printed total | True weight |
| --------------------------------------- | -------- | ------------- | ----------- |
| Budín de cerdo PROLONGO, `0'1 × 7'90`   | 0.79     | **1'11**      | 0.1405 kg   |
| Cabeza de jabalí, `0'1 × 13'90`         | 1.39     | **0'90**      | 0.0647 kg   |
| Chorizo extra Pamplona, `0'1 × 9'90`    | 0.99     | **0'84**      | 0.0848 kg   |
| Mortadela siciliana, `0'2 × 5'90`       | 1.18     | **1'09**      | 0.1847 kg   |
| Pechuga de pavo, `0'2 × 13'90`          | 2.78     | **3'48**      | 0.2504 kg   |
| Salchichón a la pimienta, `0'2 × 12'90` | 2.58     | **1'94**      | 0.1504 kg   |

**The till prints the weight rounded to one decimal.** `0'1` covers anything from
0.05 kg to 0.15 kg, which is a threefold range, so the quantity column on a weighed
line is decoration. The line total is the only authoritative number.

Three consequences, all of which needed fixing:

**1. `validate.mjs` was producing false positives.** It flagged two correctly-read
lines on the balanced reading. The per-line check now treats a non-integer quantity
as an interval (`0.1` printed to one decimal means [0.05, 0.15)) and passes the
line if the printed total falls in the range that interval allows. Integers keep
zero slack, so a genuine transposition is still caught — and it is: the fix does not
rescue 3.1 Flash-Lite's line 9, which is still flagged with the note
`(rounding allows +/-0.07)`. Tickets 1 to 4 re-validate unchanged.

**2. Both models invented numbers to make the arithmetic work.** On the Chorizo
line, 3.1 Flash-Lite returned `quantity: 0.085` and 3.5 Flash-Lite returned
`unitPrice: 8.48`. Neither figure is printed anywhere on the receipt. Both are
back-solved from the line total, and both break rule 3 ("never infer, never compute
a missing number from the others"). The schema's shape invites it: presenting
`quantity`, `unitPrice` and `lineTotal` as peers implies they should be consistent.
**v3 should say explicitly: copy the printed quantity even when it does not multiply
out; a weighed quantity is a rounded display value.**

**3. A weighed line cannot be reconciled by quantity.** For basket reconcile you get
the money and the product, not the weight. "You bought 0.1 kg of turkey" is wrong by
up to 50%, so a weighed line should reconcile on price and be shown as a price.

## Product identity is the weak half

Normalized keys agree on **54 of 64 lines (84%)**, against 98% for the money. Every
divergence is in the description, and several are wrong in _both_ readings:

| Printed (full-res crop)               | 3.1 Flash-Lite                   | 3.5 Flash-Lite                |
| ------------------------------------- | -------------------------------- | ----------------------------- |
| `3 rotuladores pizarra BISMARK 4 fns` | `rotuladores...` (drops the `3`) | correct                       |
| `Bizcocho horneado CODAN Rubia 4 ud`  | `COBRAN RUBIN`                   | `CHOOK Rubin`                 |
| `Bombón LA MENORQUINA turrón 3x100 g` | `LA MERENGUINA`                  | `LA MENDOCINA turrón SKTOd v` |
| `Búlgaros al cacao ALTEZA 5 ud 175 g` | correct                          | `Bolgorus`                    |
| `Mascarilla capilar ELVIVE Hidra Hia` | correct                          | `ELUIVE`                      |
| `Quita pelos mascotas NOBLEZA colad`  | correct                          | `mascotast`                   |

`Bizcocho horneado CODAN` and `Bombón LA MENORQUINA` are misread by both, so
cross-model agreement would not have caught them. The small blurry text at the top
of a curled receipt is genuinely hard, and this is where the ceiling sits.

**It matters less than it looks, and the reason is worth stating precisely.** An
alias key does not have to be _correct_, only _stable_: if the pinned model reads
`LA MENDOCINA` every time, the alias resolves every time. What breaks the design is
the same model reading the same product differently across visits.

There is direct evidence for stability, though only a little. `ESPETEC ELIGES`
appears on tickets 3 and 4 — different days, different photographs — and **both
models read it identically both times.** 3.5 Flash-Lite's wrong `FONRVELLA` on
ticket 3 was wrong _consistently_, which still yields a working key.

**This remains the largest untested risk in the design**, and one ticket cannot
close it. The test that would is the same product photographed on several different
receipts across the corpus, which is worth assembling once all ten are read.

`3 rotuladores` is a specific hazard worth noting: a description that _begins with a
numeral_ invites a reader to take it as the quantity column, which is what 3.1
Flash-Lite did.

## Departments again, and a third shape

`Fruteria CASH2` appears three times, each with **no quantity and no unit price at
all**, just an amount: 1.34, 0.93, 3.65. Both models flagged all three as
`isDepartment` and left the numeric fields null, which is exactly right.

That is a third department shape after ticket 1's (price only, weighed) and ticket
4's (`PANADERIA 6 × 0.33`, counted). Three separate greengrocer amounts on one
receipt also means three companion tickets, which strengthens the "one basket is
fed by several tickets" conclusion rather than complicating it.

## Cost

| Model                 | in   | out  | Per ticket | Per 1000 tickets |
| --------------------- | ---- | ---- | ---------- | ---------------- |
| Gemini 3.1 Flash-Lite | 1593 | 4676 | $0.00741   | **$7.41**        |
| Gemini 3.5 Flash-Lite | 1593 | 5223 | $0.01354   | $13.54           |

**Cost scales with basket size, not image size.** Input is 1593 tokens on every
ticket regardless of length; output went from ~600 tokens on an 8-line receipt to
~5000 here. A weekly shop therefore costs about five times a corner-shop trip, and
is still under a cent and a half.

At these prices, reading every receipt twice with both models costs $21 per
thousand, and is what would have caught nothing here that the checksum did not — the
checksum found the error on its own, for free. Second-model reads are worth spending
on the fields arithmetic cannot see, not on the money.

## A methodological caveat about Opus 5

**There is no `claude-opus-5.json` for this ticket, on purpose.** The harness
downscales images to 1500x2000 before I see them, while Gemini receives the full
3000x4000 file. On an eight-line receipt that costs nothing; on a 64-line receipt in
6pt type it is decisive, and I proved it on myself: reading the downscaled image I
had line 6 as `1 × 0'78 = 0'78`, and the full-resolution crop shows
`4 × 0'78 = 3'12`. Both models had it right.

Producing a reading by cropping the image into strips and adjudicating between the
two models would not be an independent third opinion, and filing it as one would
corrupt the corpus. So it is left out, and the earlier tickets' Opus 5 readings
should be read with the same handicap in mind — including the guessed `PATR` on
ticket 4.
