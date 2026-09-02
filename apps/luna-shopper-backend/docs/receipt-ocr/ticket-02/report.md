# Ticket 2 — El Jamón, Córdoba, 28/08/2026, 16.20 €

Two lines, paid by card, photographed together with the card slip below it.
Invoice `40002036639`, one number below ticket 1's `40002036640`, same store, same
till, same minute: **the two tickets are one shopping trip split across two
payments**, which is itself worth knowing (see "What it means" below).

## What the receipt says

|                   |                   |
| ----------------- | ----------------- |
| MEZCLA CAPICUA    | 1 × 14.25 = 14.25 |
| COLETERO          | 1 × 1.95 = 1.95   |
| **TOTAL FACTURA** | **16.20**         |

`DESGLOSE I.V.A.` reads BASE 12.95 IVA 10.0% 1.30, and BASE 1.61 IVA 21.0% 0.34.
Both bases reconcile exactly to their lines (12.95 + 1.30 = 14.25; 1.61 + 0.34 =
1.95), and the 21% rate confirms `COLETERO` is a non-food item, a hair tie.

## Results

Every reader got both lines, both unit prices and the total exactly right, and
every reading balances:

```
BALANCED  claude-haiku-4-5.json        2 lines (0 dept, 0) sum 16.2 total 16.2
BALANCED  claude-opus-5.json           2 lines (0 dept, 0) sum 16.2 total 16.2
BALANCED  gemini-3.1-flash-lite.json   2 lines (0 dept, 0) sum 16.2 total 16.2
BALANCED  gemini-3.5-flash-lite.json   2 lines (0 dept, 0) sum 16.2 total 16.2
BALANCED  gemini-3.6-flash.json        2 lines (0 dept, 0) sum 16.2 total 16.2
```

`gemini-3.7-flash` is absent because it never answered: 240 s deadline, aborted.
It failed the same way on a text-only prompt with no image, so it is unreachable
rather than slow (README section 8). `gemini-2.5-flash-lite` is absent because it
returns 404, retired for new keys.

The only differences are in fields the arithmetic does not constrain:

| Model                 | `taxTotal` | `unit`   | `paymentMethod` | Latency |
| --------------------- | ---------- | -------- | --------------- | ------- |
| Claude Opus 5         | 1.64       | UNIT     | TARJETA VISA    | —       |
| Claude Haiku 4.5      | 1.64       | UNIT     | TARJETA VISA    | —       |
| Gemini 3.6 Flash      | 1.64       | UNIT     | **CARD**        | 10.8 s  |
| Gemini 3.5 Flash-Lite | **null**   | UNIT     | VISA            | 35.7 s  |
| Gemini 3.1 Flash-Lite | 1.64       | **null** | TARJETA VISA    | 3.4 s   |

Nobody scored perfectly on the unconstrained fields, and nobody scored badly.
3.5 Flash-Lite missed the `DESGLOSE I.V.A.` block; 3.1 Flash-Lite declined to set
a unit; 3.6 Flash normalized `TARJETA VISA` to `CARD` rather than copying it.

## Cost

Measured for Gemini (from `usageMetadata`), computed for Claude. See the README
section 7 for why Claude is computed and how.

| Model                 | in   | out  | Per ticket | Per 1000 tickets |
| --------------------- | ---- | ---- | ---------- | ---------------- |
| Gemini 3.1 Flash-Lite | 1593 | 313  | $0.00087   | **$0.87**        |
| Gemini 3.5 Flash-Lite | 1593 | 315  | $0.00127   | $1.27            |
| Claude Haiku 4.5      | 1994 | 210  | $0.00304   | $3.04            |
| Gemini 3.6 Flash      | 1593 | 1074 | $0.00522   | $5.22            |
| Claude Opus 5         | 5170 | 210  | $0.03110   | **$31.10**       |

**Opus 5 costs 36x what Gemini 3.1 Flash-Lite costs for a byte-identical answer.**
Most of that is the image: Opus 5 is high-resolution tier and spends 4784 visual
tokens where Haiku 4.5's standard tier spends 1568, and Gemini spends about 1150.

3.6 Flash's output number is inflated by 863 thinking tokens against 211 of actual
answer. Thinking is billed, and on a task this mechanical it bought nothing.

## Two traps this ticket set, and nobody fell into either

**The photo holds two documents.** Below the receipt sits the card slip, which
repeats `Venta 16,20 Ç`, plus `REDSYS`, an AID, a masked PAN and an auth code.
Reading `16,20` off the slip as a third line item would have broken the total.
Every reader ignored the slip completely.

**The two documents disagree.** The receipt says `TARJETA VISA`; the slip says
`Debit Mastercard ***6286`. Neither is a misreading, and any code that treats
`paymentMethod` as a fact about the card rather than as a string the till printed
will eventually be wrong. It does not matter for prices or baskets, which is the
argument for not trying to resolve it.

## What it means

**Consecutive invoice numbers, same minute, two payments.** One trip produced two
tickets, one paid cash (ticket 1) and one paid card. A basket reconcile that
assumes one receipt equals one shop will under-count this trip by whichever ticket
the user did not scan, and a user scanning both should not get two separate
reconciliations. Worth handling: group scans by (store, date, close timestamps)
and offer them as one reconcile.

**Two-line receipts are the easy case, and the models are already past it.** With
five readers agreeing exactly on every number, model choice on tickets like this
one is decided entirely by cost and latency, not accuracy. That is the argument for
running the cheapest tier by default and escalating only when the checker says the
arithmetic did not close.

**`MEZCLA CAPICUA` at 14.25 € is a real catalog matching problem**, though not a
model one. It is a loose-weight pick-and-mix of sweets sold by the bag. It has a
product name, so it will get an alias, but the price is per bag and not comparable
with anything, so it is a poor catalog price even though it is a perfectly good
basket line. That distinction (matchable, but not worth a price) is a third state
beyond `isDepartment`.
