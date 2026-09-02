# Ticket 4 — El Jamón, Córdoba, 25/07/2026, 11.74 €

Eight lines, three VAT groups, one department line, paid by card. Readers from
here on are Opus 5, Gemini 3.1 Flash-Lite and Gemini 3.5 Flash-Lite; 3.6 Flash and
Haiku 4.5 were dropped after ticket 3.

**This is the first ticket with an extraction error that `validate.mjs` cannot
see**, and every reader made it.

## What the receipt says

|                   |          |           |
| ----------------- | -------- | --------- |
| ESPETEC ELIGES    | 1 × 2.10 | 2.10      |
| PAT· 125G         | 1 × 1.32 | 1.32      |
| BOCADIT.CODAN     | 1 × 1.19 | 1.19      |
| BOLSA EL JAMON    | 1 × 0.15 | 0.15      |
| BOCAT"N 180G      | 2 × 0.55 | 1.10      |
| PEPITO NATA       | 1 × 1.95 | 1.95      |
| PEPITO CREMA      | 1 × 1.95 | 1.95      |
| PANADERIA         | 6 × 0.33 | 1.98      |
| **TOTAL FACTURA** |          | **11.74** |

## Results

All three readers got all eight lines, both quantities, every unit price and the
total exactly right. The lines sum to 11.74 to the cent, and every reading passes
the arithmetic checker.

That is the problem.

## The undetected error, and the check that finds it

`DESGLOSE I.V.A.` reads BASE 7.74 IVA 10.0% 0.77, BASE 0.12 IVA 21.0% 0.03, and
BASE 3.65 IVA 4.0% 0.15. All three readers read those figures the same way, and
`validate.mjs` says `BALANCED` because it only ever compares lines against the
total and never looks at the tax block at all.

The new `tools/vat-check.mjs` does look, and it is decisive:

```
  10%  base 7.74  tax 0.77  gross 8.51   consistent   lines reach it
  21%  base 0.12  tax 0.03  gross 0.15   consistent   lines reach it
   4%  base 3.65  tax 0.15  gross 3.80   consistent   NO SUBSET OF LINES REACHES IT

  groups gross to 12.46 but total is 11.74   OFF BY 0.72

  the 4% group is the only one its lines cannot reach, so its true gross is
  11.74 - 8.51 - 0.15 = 3.08   (base 2.96, tax 0.12), which the lines do reach
```

**A Spanish receipt is tax inclusive, so every line belongs to exactly one VAT
group and each group's gross is the sum of its own lines.** That makes the tax
block a _partition_ of the lines, not just a second total, and a partition is a far
stronger constraint than a sum:

- The 10% group grosses to 8.51, which is exactly `2.10 + 1.32 + 1.19 + 1.95 + 1.95`
  (the five non-bread, non-bag items).
- The 21% group grosses to 0.15, which is exactly `BOLSA EL JAMON`, the carrier bag.
- The 4% group should therefore be `BOCAT"N 1.10 + PANADERIA 1.98 = 3.08`. It was
  read as 3.80, and **no subset of the lines can sum to 3.80**, which is what proves
  the figure wrong rather than merely suspicious.

So the checker does not just detect the error, it localizes it to one group and
derives what the figure had to be. `0.15` for `0.12` is an obvious 5-for-2 misread;
`3.65` for `2.96` is the crease running through that block.

**Ticket 3's open question is now answered too.** Its tax block was off by 0.38 in
the same direction and in the same 4% group, which was recorded there as "a misread
digit or an inconsistent receipt". Running the same check against ticket 1 shows a
block that reconciles perfectly, so the semantics are confirmed and the receipts are
fine: it is the reading of the 4% base that fails, twice, on the two creased photos.

**This is the strongest argument yet for the v3 `taxBreakdown` change.** It is not
a nice-to-have second opinion; it is the only thing in the pipeline that caught a
real error on this ticket, and `schema.json` currently throws the data away.

## Departments can have a quantity

`PANADERIA 6 × 0.33 = 1.98` — six bread rolls from the bakery counter. Ticket 1's
report says department lines have "no product, no quantity and no unit", and that
was an over-generalization from two counter lines that happened to be weighed
goods. **A counted department line carries a real quantity and a real unit price.**

It does not change what to do with them (skip for catalog, notify the user that a
companion ticket exists), but it does change what can be shown in the notice: "6
items from the bakery, 1.98 EUR" is a much better prompt to go find the other
ticket than "1.98 EUR of bakery". Both readers flagged `isDepartment` correctly, so
the classification is unaffected.

## `rawText`: 7 of 8 keys agree, and the one that does not is mine

Normalized (uppercase, decompose accents, strip non-alphanumerics), across all three
readers:

```
 1 ESPETECELIGES
 2 PATR125G  |  PAT125G      <-- diverges
 3 BOCADITCODAN
 4 BOLSAELJAMON
 5 BOCATN180G
 6 PEPITONATA
 7 PEPITOCREMA
 8 PANADERIA
```

The till prints `PATÉ` and `BOCATÍN` with mangled accented characters. On line 5
the two Gemini models differed in raw text (`BOCAT"N 180G` versus `BOCAT N 180G`)
and **normalized to the same key anyway**, because a `"` and a space both strip to
nothing.

Line 2 diverges because **I guessed a letter.** I read the mangled `É` as an `r`
and produced `PATR125G`; both Gemini models simply omitted the glyph and produced
`PAT125G`. That is the same class of error 3.5 Flash-Lite made on ticket 3
(`JAMÓN` read as `JAMUN`), and this time it was mine.

It sharpens the ticket 3 conclusion into something actionable:

> **Omission normalizes correctly. Substitution does not.** A dropped glyph and a
> punctuation placeholder both vanish under normalization and land on the same key.
> A guessed letter survives normalization and creates a permanent second key.

That is a v3 prompt rule, and a cheap one: _if a character is illegible, leave it
out; never substitute a letter you are not reading._ It would have prevented both
observed key splits in the whole corpus so far.

## Other drift

**3.5 Flash-Lite derived `subtotal` from the tax bases again** (11.51), for the
third ticket running, and the checker flagged it again. It is a reliable behavior
rather than a slip, and it has now twice been the thing that surfaced the tax block.
That is an argument for capturing the field, not for suppressing the model.

**3.1 Flash-Lite returned `taxTotal: null`** here, having returned 0.68 on ticket 3.
3.5 Flash-Lite did the reverse. Neither model's tax-block behavior is stable, which
is a third reason the scalar `taxTotal` is the wrong shape for this data.

**No card slip contamination this time.** Both models took `datetime` and
`paymentMethod` from the receipt, though 3.1 Flash-Lite shortened `TARJETA VISA` to
`VISA`.

## Cost

| Model                 | in   | out | Per ticket | Per 1000 tickets |
| --------------------- | ---- | --- | ---------- | ---------------- |
| Gemini 3.1 Flash-Lite | 1593 | 737 | $0.00150   | **$1.50**        |
| Gemini 3.5 Flash-Lite | 1593 | 766 | $0.00239   | $2.39            |
| Claude Opus 5         | 5170 | 532 | $0.03915   | **$39.15**       |

Opus 5 remains about 26x the cheapest reader, and on this ticket it was the only
reader to get a normalized key wrong.
