> **PR:** [#270](https://github.com/IchirokuXVI/nx-portfolio/pull/270)

# 0019 A large file previews in pages

The import screen reads a document in the browser and draws every product in it before the operator
decides anything. That is the right thing to draw and the wrong amount of it. A leaflet is forty
rows. A chain export is four thousand, and `0086` made the export a first class producer of these
files, so four thousand is the ordinary case rather than the extreme one.

```text
<ul class="products">
  @for (product of document.products; track product.id) {
```

Every row is a list item with two flex containers and up to seven spans inside it, so a four thousand
row file builds something like fifty thousand elements before the operator has picked a chain. The
page stalls on the one screen where the whole point is to look at the file before committing to it.

This plan caps what is drawn and gives the operator a way to reach anything the cap hides. It changes
nothing about what is read, what is sent, or what the backend does with it.

Depends on `0010` for the upload screen and on `0014` for the document schema and the rename.

## 1. The document stays whole and the DOM does not

**Two hundred and fifty rows are drawn, and a "show more" adds two hundred and fifty more.** The
parsed document is untouched: `read()` holds every product, `submit()` sends the original bytes, and
the digest is still the file's. What the cap governs is the `@for`, and nothing else.

The number is a compromise with one job on each side. Below it a leaflet, a hand typed price list and
a small section export are drawn whole and nobody sees a control at all. Above it the browser is
doing work an operator has not asked for yet.

No "show all". A control whose purpose is to undo the cap is the cap not existing, and an operator
who wants a particular row has section 2 instead. Pressing "show more" repeatedly does reach the end
of any file, which is the honest escape hatch and is slow enough to be a choice.

**Not virtual scrolling.** A windowed list is the standard answer and it is the wrong one here. It
adds a dependency and a fixed row height to a list whose rows wrap to two lines on a phone, and it
answers "scroll to row 3,000" when the question an operator actually has is "is the Nocilla in
here". Section 2 answers that question directly, in one control, with no dependency.

## 2. The search box searches the file, not the window

**A search box above the list, filtering every product in the document.** This is the half that makes
the cap acceptable, and its behaviour has to be stated plainly, because the obvious implementation of
a search over a capped list is the wrong one: filtering the two hundred and fifty drawn rows would
mean a product on row 3,000 is unfindable until the operator has pressed "show more" eleven times.

So the order is: **filter the whole document, then apply the window to what matched.** A term that
matches four products draws four rows out of four thousand, with no "show more", whatever the window
was before.

It matches `name`, `brand`, `size` and `ean` on `HarvestProductRow`, as a case folded and accent
folded substring. Accent folding is not optional in this catalogue. An operator typing `jamon` who is
not shown `Jamón Serrano` will conclude the file does not contain it.

`harvest-document.ts` already strips accents inside `slug`, with the two named code point constants
and the reasoning for using them rather than a regular expression over characters nobody can see in
an editor. That folding is lifted out as an exported `fold(value)` and both callers use it. One copy
of the reasoning, two callers.

The window resets to two hundred and fifty whenever the term changes, because the previous window
was a position in a different list. Typing is settled for 250 ms before the filter runs, the same
delay `reference-picker.ts` uses, so a four thousand row scan happens once per word rather than once
per keystroke.

## 3. The tally says what is being hidden

One line above the list, and it is not decoration: a cap that does not say it is a cap is a file that
looks shorter than it is, on the screen whose job is to show the operator what they are about to
import.

- Nothing typed, nothing hidden: `4,232 products`.
- Nothing typed, capped: `showing 250 of 4,232 products`.
- A term typed: `showing 250 of 812 products matching "jamon", out of 4,232`.
- A term that matches nothing: `no product matches "jamon"`, and no empty list under it.

The counts are the document's, not the window's, so the number beside the chain and the number beside
the list agree.

## 4. A refused import opens on the rows it refused

When the backend refuses a document it answers one message per failure, keyed on the JSON path of the
product it is about, and the screen already turns those into `blamed()` and marks the matching rows.
Under a cap that marking becomes a promise it cannot keep: the row a message names is on row 3,000
and the operator is looking at rows 1 to 250, all of them unmarked.

**So a refusal filters the preview to the blamed rows.** The list shows the refused products and
nothing else, the tally says `showing 14 refused products, out of 4,232`, and a control beside it
returns to the whole file. A refusal is the only moment when the operator is not browsing the
document but reading a specific complaint about specific rows, and the preview follows them there.

Typing a term while the refusal filter is on searches within the refused rows, because that is the
narrower and more useful reading of two filters at once, and the tally says which set is being
searched.

Choosing a new file clears everything: the window, the term, the refusal filter and the failures.

## 5. Where the code lives

The filtering and the windowing are two pure functions in
`libs/luna-shopper-admin/models/src/lib/harvest/harvest-document.ts`, beside `harvestFailures`,
`hintNotice` and `importConflict`, which are the same shape of thing for the same reason: they are
decisions about a document, they have no dependency on Angular, and a spec over them is a table of
inputs rather than a mounted component.

```text
previewMatches(products, term, only) -> the products that match
previewWindow(matched, shown)        -> PreviewWindow
```

`products` is the whole document's, `term` is what was typed, and `only` is section 4's refusal
filter, `null` when there is none. `PreviewWindow` carries the rows to
draw, the total matched, whether more remain and how many, which is what section 3's tally reads
rather than recomputing.

The component holds three signals: `term`, `shown` and `refusedOnly`. `shown` resets on a term
change and on a new file. Nothing else in `import-upload-page.ts` moves.

## 6. Testing

`harvest-document.spec.ts`, over the two functions:

- The window draws the first 250 of 4,232 and reports 3,982 more. `shown` at 500 draws 500.
- A file of 40 draws 40 and reports none remaining.
- A term matches on each of the four fields, folds case, and folds accents both ways: `jamon` finds
  `Jamón` and `Jamón` finds `jamon`.
- A term filters the whole list before the window, so a term matching only row 3,000 returns that row
  with `shown` at its default.
- The refusal set filters to those rows, and a term inside it narrows further.
- An unmatched term returns nothing, and the window over nothing reports nothing rather than failing.

`import-upload.spec.ts`, over the screen:

- A 400 row document renders 250 list items and a "show more"; pressing it renders 500.
- Typing a term renders only the matching rows and no "show more" when they fit.
- Changing the term resets the window.
- A refused import renders only the blamed rows, and the control beside the tally restores the file.
- Choosing a second file clears the term, the window and the refusal filter.
- The tally text for each of section 3's four states.

## 7. Exit criteria

- A four thousand row document opens without the page hanging, and shows 250 rows and a count.
- A product anywhere in the file is found by typing part of its name, brand, size or barcode, without
  pressing "show more" first.
- An accented product name is found by typing it without the accent.
- A refused import shows the refused rows first, with a way back to the whole file.
- The document that is sent is byte for byte the document that was dropped, unchanged by any of this.
