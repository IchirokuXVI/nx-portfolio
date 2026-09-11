# 0001 The leaflet a command reads

One command turns a leaflet PDF into a `HarvestDocument`:

```sh
npx nx run luna-shopper/leaflet-cli:read -- --pdf tmp/dia_leaflet.pdf --chain dia
```

Today that is a person pasting a prompt out of `AGENT-PROMPT.md` into a Claude
Code session and watching an agent do six steps by hand. The steps are already
written down and four of them are already scripts. This plan makes the whole
thing one process, and lets a model on the operator's own machine do the
reading.

Built after `luna-shopper/tools` plan 0001 (the folder this lives in) and
`shared/model-engines` plan 0004 (which teaches `ask` to take a picture).

## 1. Most of this already exists, and none of it is rewritten

`apps/luna-shopper-backend/harvester/tools/leaflet/` holds 2,933 lines that
work. Procedure (a) of its `README.md` has nine steps, and steps 5, 6 and 7 are
already `build-document.mjs`, `drift-check.mjs` and `validate.mjs`. Steps 8 and 9
are an upload and a baseline, and both stay a person's job (section 10).

So this plan writes an orchestrator, not a reader. What it adds is steps 1 and 3:
render the PDF to page images, and ask a model for each page. Steps 2 and 4 it
automates, and steps 5 to 7 it calls, unchanged, as they stand.

**The three price rules do not move and are not duplicated.**
`to-harvest-document.mjs` owns them and keeps owning them. A CLI that decided a
till price would be a second authority on the one question the whole harvester
exists to answer.

## 2. Two projects, and what separates them

| Project                       | Directory                                | What it holds                                                                    |
| ----------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `luna-shopper/leaflet-cli`    | `libs/luna-shopper/tools/leaflet/cli`    | The orchestrator, and the four shared scripts that exist today                   |
| `luna-shopper/leaflet-chains` | `libs/luna-shopper/tools/leaflet/chains` | One folder per chain: `layout.md`, `prompt.txt`, `headings.mjs`, `baseline.json` |

The line between them is **what is the same for every chain** against **what one
chain prints**. It is the line the existing folder already draws, and moving it
into two Nx projects buys one thing that matters: an edit to `dia/prompt.txt`
marks `leaflet-cli` affected through the project graph, so a prompt change runs
the tests rather than slipping past `nx affected`.

The move out of the harvester app is part of this plan, because until
`leaflet-cli` exists there is nowhere for the files to go. `FILE_IMPORT` still
consumes the document, and the harvester still owns the import. What moves is
the **producer**, which no deployed process ever loads, and the harvester keeps
no reference to it.

## 3. What the command does

```
--pdf <path>            the leaflet. A PDF, or an image, or a directory of page images.
--chain <slug>          which chain's prompt and layout to use. Required.
--engine <name>         ollama (default), claude, api, manual. Section 6 is manual.
--model <name>          overrides the engine's default model.
--pages 1-12,31         read only these. Default: every page.
--out <dir>             where the working material goes. Default: tmp/leaflet/<slug>-<date>.
--resume                keep page readings that already exist in --out.
--dry-run               census and layout check only. Read no page.
```

Eight steps, in order, and each one can refuse:

1. **Census.** Page count, page size, and which pages carry a text layer. Printed
   before anything is asked of a model, because the two chains read so far were
   not the same kind of document: El Jamon is 40 pages with text on 28 of them,
   Deza is 62 pages of flat images.
2. **Render.** Every page to a PNG under `<out>/pages/`, two digit numbers from
   `01`. Section 4 is how.
3. **Layout check.** Print `chains/<slug>/layout.md`, ask the model to read the
   first three pages, and compare what it reports against the description. A
   mismatch **stops the run** and names what differs. This is the one step the
   manual procedure asks a person to do and the easiest to skip.
4. **Read.** One call per page, in order, writing `<out>/import/page_NN.json` as
   it goes. A page that answers nothing parseable is retried once and then
   recorded as an empty array with a named warning, never as a crash: forty
   pages must not be lost to page thirty seven.
5. **Sanity pass.** Check the readings against what the printed page can support,
   and name every row that fails. Section 8 is the list of checks. This runs for
   every engine, because every model has a systematic defect and only the defect
   differs.
6. **Leaflet metadata.** Write `<out>/import/leaflet.json`: the PDF path, the
   page count, the fixed section pages, the printed validity window, the engine
   and model that read it, and the date. The validity window is asked of the
   model once, against the cover, and **every field it fills is printed for the
   operator to confirm**, because a wrong date silently mis-scopes every price.
7. **Build, drift check, validate.** The three existing scripts, in that order,
   as child processes. A drift refusal stops the run and prints every statistic
   that left its band. `--update-baseline` is never passed automatically.
8. **Report.** Pages read, offers found, how many have a price, how many have a
   unit price only, how many have neither, every sanity failure, every warning,
   the drift result and the output path.

**The command never uploads.** Step 8 prints the document's path and the
`harvest/imports/upload` call to make with it. A leaflet reading is accepted by a
person looking at it, and a tool that posted its own output would remove the only
review the pipeline has.

## 4. Rendering a PDF is the one thing Node cannot do

These libraries have zero npm dependencies by rule, and there is no way to
rasterize a PDF in plain Node. Three options, and the plan takes the third:

- **`pdfjs-dist` plus a canvas binding.** Breaks the zero dependency rule, adds a
  native build to a workspace install, and pulls a renderer into a library that
  otherwise runs anywhere Node runs.
- **Bundle a renderer.** Not a real option for a PDF.
- **Shell out, and say so.** The tool looks for `pdftoppm` (Poppler), then
  `magick` (ImageMagick), then a Python with PyMuPDF, in that order, and uses the
  first it finds. When it finds none it **stops at step 2** and prints the one
  line that installs each. This is what the manual procedure already does, with
  `tmp/.venv-ocr` and PyMuPDF.

Two details the renderer must get right, and both come from a real leaflet:

- **The dpi is a chain property, not a constant.** Deza is rendered at 128 dpi
  because its pages are 2.2:1 flat images, and El Jamon at 160. It belongs in
  `chains/<slug>/headings.mjs` beside the other per chain defaults, with a
  `--dpi` override for a leaflet that differs.
- **Never split a tall page.** Aspect ratio costs nothing, and a cut through a
  tile loses the tile. Section 7 measures what happens when you do it anyway.

**A leaflet that arrives as images skips this entirely.** `--pdf <directory>`
reads `page_NN.png` from it, and LIDL's flyer endpoint already serves every page
as a 2400 pixel image, so that chain never renders a PDF at all.

## 5. Choosing the chain

`--chain <slug>` is **required, and never guessed**. The tool lists the slugs it
has when the flag is missing or unknown, and a slug with no folder is refused
with the sentence that a new chain is written by hand first.

Writing a new chain's folder stays a person's job with a model's help, which is
procedure (b) of the README and prompt B of `AGENT-PROMPT.md`. Four files decide
how every future leaflet of that chain is read, and three of them are prose a
person has to agree with. A `--new-chain` flag that generated them would produce
a plausible `prompt.txt` nobody checked, and the first sign of trouble would be a
baseline built from a wrong reading.

`AGENT-PROMPT.md` stays, and shrinks. Prompt A is deleted outright: it is a hand
maintained copy of a procedure, and `--engine manual` now generates the same
thing from the chain's own files, for this leaflet, with real paths in it
(section 6). What replaces it is the command. Prompt B stays as it is, because
writing a new chain's folder is still the job it describes.

## 6. `--engine manual`, which hands the reading to any model at all

```sh
# 1. Render, and write the prompt to paste.
npx nx run luna-shopper/leaflet-cli:read -- --pdf tmp/dia_leaflet.pdf --chain dia --engine manual

# 2. Paste <out>/PROMPT.md into Claude Code, or any model you like. It writes
#    <out>/import/page_NN.json.

# 3. Pick the run back up.
npx nx run luna-shopper/leaflet-cli:read -- --out <out> --resume --engine manual
```

The model this repo measured as most accurate is Sonnet 5, and the awkward way to
reach it is `--engine claude`, which has to put the Read tool back into a call
that was cut to 2,546 tokens on purpose (`shared/model-engines` plan 0004,
section 4). Manual mode reaches it by not being clever: a Claude Code session
already reads a PNG with its Read tool, and it already has the tokens paid for.

So manual mode is not a lesser fallback. It is how a person gets the best reading
available without the CLI holding a credential, and it is the mode to use when a
run matters.

**What it is, exactly: an engine that is a person.** It is spelled as an
`--engine` value because it answers the same question every other engine answers,
which is who reads the page. It is **not** a `shared/model-engines` registry
entry, because everything in that registry builds an object with an `ask` method
and this one has no `ask` to build. It never calls a model, it pauses, and it
holds a terminal and a person, all three of which that library's contract
forbids. The CLI branches on it before it ever asks the registry for an engine.

### The two halves

**The hand off.** The run stops after rendering and writes `<out>/PROMPT.md`. That
file is self contained and is the whole of what a person pastes:

- `chains/<slug>/prompt.txt` verbatim, since it is the chain's own contract with
  a model and nothing here may paraphrase it.
- The **absolute** path of every page image, numbered, so a tool with file access
  needs no further instruction. A chat window with no file access gets the same
  list and the person attaches the files, which is why the paths are absolute and
  listed rather than globbed.
- Where to write each answer: `<out>/import/page_NN.json`, one JSON array per
  page, an empty array for a page with no priced product.
- The census and the layout check from steps 1 and 3, so the reader is told what
  kind of document this is before reading it.
- The three fields that matter most, which the chain prompt already names:
  `loyalty`, `promotion.type` with `promotion.single_unit_price`, and `basis`.

**The pick up.** `--resume` already keeps a page reading that exists, so the
second command needs no new machinery. What it adds is refusing to build on a
reading it cannot trust:

- A `page_NN.json` that is not a JSON array is named, by page, and the run stops.
  A model that answered with prose inside a code fence is the common case, and a
  run that quietly treated it as an empty page would report a leaflet with
  missing products and no reason why.
- A page with no file at all is named, and the run stops unless `--pages` said
  that page was not wanted. Thirty nine pages out of forty is a partial reading,
  and the operator decides whether it is worth building.
- Everything that arrives goes through the same step 5 sanity pass as a model
  run. A person pasting into an unmeasured model is exactly who needs it.

### Two rules

- **Manual mode never edits a reading.** It refuses one, names the page, and
  stops. A tool that repaired a model's JSON would be deciding what the page said.
- **`PROMPT.md` is generated, never committed and never hand written.** It is the
  chain's prompt plus this run's paths. A second copy of a chain's rules that
  drifts from `chains/<slug>/prompt.txt` is the failure this whole folder is
  arranged to prevent.

## 7. What a local model actually does, measured

The comparison the workspace already had was three models on three pages of the
El Jamon leaflet, 19 offers, scored against a reading the user spot checked.
`gemma4:12b` was run on exactly the same three pages, with the same committed
`chains/el-jamon/prompt.txt` and the same scorer, on an RTX 4080 SUPER.

| Measure, 19 offers     | Sonnet 5 | Gemini 3.5 FL | Haiku 4.5 | gemma4:12b | gemma4:12b, quartered |
| ---------------------- | -------- | ------------- | --------- | ---------- | --------------------- |
| Product found          | 100%     | 100%          | 95%       | **100%**   | 100%                  |
| Price as a set         | 95%      | 89%           | 95%       | 74%        | 84%                   |
| Headline price correct | 95%      | 89%           | 89%       | **63%**    | 63%                   |
| ANTES price correct    | 100%     | 100%          | 100%      | **55%**    | 55%                   |
| Unit price correct     | 100%     | 100%          | 56%       | **31%**    | 31%                   |
| Promotion type correct | 100%     | 100%          | 89%       | 74%        | 58%                   |
| Loyalty flag correct   | 95%      | 95%           | 89%       | 74%        | 100%                  |
| Invented offers        | 0        | 0             | 0         | **0**      | 9                     |

**gemma4:12b finds the offers and misreads the numbers.** It found all 19 tiles,
invented nothing, and produced almost the same distribution of promotion
mechanics as Sonnet 5 (`price_drop` 9 against 11, `multibuy_unit_price` 2 against
2, `second_unit_discount` 2 against 2, `multibuy_total` 1 against 1, `n_for_m` 4
against 3). The hard half of the task, deciding what kind of offer a tile is, it
does. The easy half, reading a printed number, it does not: 7 of 19 headline
prices, 5 of 11 ANTES prices and 11 of 16 unit prices are wrong.

**One failure is systematic and total, and it is the dangerous one.** On **9 of
9** plain price drop tiles, gemma4 filled `promotion.required_quantity` and
`promotion.single_unit_price` with numbers the page does not print, usually the
headline price repeated. Sonnet 5 did it on **0 of 11**. Rule 7 of the prompt
already forbids inventing a value. It matters more than the other errors because
`to-harvest-document.mjs` reads `promotion.single_unit_price` to decide what one
unit costs a shopper, so a field invented here becomes a price in the catalog.

This is the same shape of defect the leaflet notes already record for Gemini,
which halves a second unit tile's total. **Expect one systematic, model specific
invention from every model, and find it by scoring before trusting a run.**

### Three Ollama settings that are not optional

| Setting       | Default   | What the default costs                                                 |
| ------------- | --------- | ---------------------------------------------------------------------- |
| `think`       | **on**    | 31.8 s against 6.3 s for the same page and the same two offers         |
| `num_predict` | unlimited | one page ran **18 minutes** at 96% GPU before it was killed by hand    |
| `temperature` | 0.8       | the same page answers differently twice, so no baseline means anything |

The runaway is the one to fear. Ollama shifts the context window instead of
stopping, so a model that falls into a repetition loop generates until something
else ends it, the request never returns, and nothing in the envelope says
anything is wrong. With a cap that same page answered in 21.6 seconds. These
three belong in the Ollama adapter, and `shared/model-engines` plan 0004 puts
them there.

### Quartering the page does not work

An image costs about 256 tokens whatever its size, so a 1654 by 2339 page is
squeezed into one tile and the small print is destroyed. The obvious fix is to
cut the page into four overlapping crops and read each one. It was tried, and the
last column of the table is the result: **the digits did not improve at all**
(headline 63%, ANTES 55%, unit 31%, identical), promotion type fell from 74% to
58% because a crop cuts a promotion banner off the tile it belongs to, and 9
duplicate rows survived a merge that folded the overlap on price and name.

So the model is not resolution limited on this leaflet. It is less accurate at
reading a printed number, and **the CLI reads one whole page per call**. The 84% price set score is the only thing quartering improved, and it
costs four calls, a merge nobody can fully trust, and the promotion types.

### Speed and price

17.1 seconds per page on the whole page path, so a 40 page leaflet is about 11
minutes and costs nothing. Quartering is 28.3 seconds per page. For scale, the
same 12 image pages cost $0.05 on Gemini 3.5 Flash-Lite and $0.28 on Sonnet 5.

## 8. The sanity pass, which names the rows to look at

A warning that says a reading may be wrong is worth much less than one that says
**which rows**. Step 5 checks every reading against what a printed page can
support, whatever produced it, and names each row that fails. It never edits a
row and it never drops one.

The checks are arithmetic and structural, so they hold for any chain and any
model:

| Check                                                                               | Why                                                                     |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A `price_drop` carries no `required_quantity` and no `single_unit_price`            | The page prints neither. gemma4 filled both on **9 of 9**               |
| On a `second_unit_discount`, `price` equals `total_price` minus `single_unit_price` | Catches every Gemini error the earlier comparison found                 |
| `was_price` is greater than `price`                                                 | An ANTES price below the new price is a swap or a misread digit         |
| A row has a `price`, or a `unit_price`, or a reason for neither                     | A row with no number is a tile the model saw and could not read         |
| `unit_price_per` is present whenever `unit_price` is                                | A unit price with no basis cannot be compared, which is its whole point |
| No two rows on one page share a name and a price                                    | The duplicate a merge or a re-read leaves behind                        |

**A failure is a warning and not a refusal.** A leaflet is allowed to print
something strange, and the pages are the authority, not this table. What the run
owes the operator is the page number, the product and the rule that broke, so the
check is a list of places to look rather than a verdict. The drift check in step
7 is the one that refuses.

## 9. The default is ollama, and the run says what that costs

`--engine ollama` stays the default, because a leaflet reading is cheap to redo,
the drift check and the baseline already exist to catch a bad one, and a free
first pass over a 40 page leaflet is worth having.

**It is not good enough to accept unseen, and the tool has to say so rather than
imply it by exiting zero.** A local engine prints its measured accuracy
**before** the run as well as after, because the warning is worth nothing to
somebody who has already waited eleven minutes and started reading the output:

```
Engine: ollama gemma4:12b. This model was measured on the El Jamon leaflet and
it makes several errors per page. It found every tile and invented nothing, and
it got 63% of headline prices, 55% of ANTES prices and 31% of unit prices right,
against 95%, 100% and 100% for Sonnet 5. On every price drop tile it invented a
single unit price the page does not print.

Check this reading against the pages before you upload it. For a reading you do
not intend to check, use --engine manual (section 6) and paste the prompt into a
stronger model.
```

The same sentence, shortened to its first line, ends the run and is written into
`leaflet.json` beside the engine name, so the warning survives into the document
and a person reading the file next week sees what read it.

Three things follow from the same measurement:

- **Manual mode is the accurate path, not `--engine claude`.** Section 6.
- **The sanity pass is what makes the default usable.** Section 8 catches the one
  defect this model has 9 times out of 9, by name and page.
- **The drift check is the gate, not the operator's patience.** It already
  refuses a reading whose statistics left the chain's band, and a local model's
  wrong digits move exactly those statistics. Running it is step 7 and it is not
  optional.

## 10. What this plan does not do

- **No upload.** Section 3 says why.
- **No `--update-baseline`.** A baseline is accepted by a person, by hand, after
  looking at the document.
- **No new chain folder.** Section 5 says why.
- **No leaflet finding.** `tools/leaflets/find-leaflets.mjs` already finds and
  downloads what each chain publishes. It stays where it is and is not called
  from here: one tool that reads a file it was handed composes with it better
  than one tool that does both.
- **No OCR and no text layer path.** Both were measured and both are far worse
  than the weakest model in the table.
- **Manual mode pastes nothing back on stdin.** The reader writes
  `page_NN.json` and the run is picked up with `--resume`. A prompt that asked an
  operator to paste 40 JSON answers into a terminal, one at a time, is a worse
  tool than the `AGENT-PROMPT.md` it replaces.
- **The sanity pass never repairs a row.** Section 8.

## 11. What is tested

`node --test`, no network, no model, as the curation libraries do.

- Argument parsing, the refusals, and the chain listing on an unknown slug.
- The renderer picks `pdftoppm`, then `magick`, then Python, and prints the
  install line when there is none. The probe is injected, so no test needs any of
  them installed.
- The page loop, against a fake engine: order, the single retry, an unparseable
  answer becoming an empty array and a warning, and `--resume` skipping a page
  whose file exists.
- **Each sanity check, against a reading built to break exactly that one.** The
  price drop case uses a real gemma4 row, so the check is proved against the
  defect it was written for rather than against an invented one.
- **Manual mode**: `PROMPT.md` carries `chains/<slug>/prompt.txt` byte for byte
  and one absolute path per rendered page. No model is called, and the run stops
  after writing it. On the pick up, a `page_NN.json` holding prose is named by
  page and stops the run, a missing page is named unless `--pages` excluded it,
  and a valid set proceeds into the same sanity pass.
- The three child processes are called with the arguments the README documents,
  and a drift refusal stops the run before `validate.mjs`.
- `leaflet.json` is built from the model's answer plus the census, and a null
  validity bound survives into the file as null. It carries the engine warning
  when the engine had one.
- The local engine notice is printed **before and after** the run for `ollama`,
  and not at all for `claude` or `manual`.

Beyond the suites, one end to end rehearsal against the committed El Jamon
baseline, whose expected result is section 7's table. A change that moves those
numbers is either a better prompt or a broken tool, and the scorer says which.

## 12. Order of work

1. Move `apps/luna-shopper-backend/harvester/tools/leaflet/` into the two
   projects. No logic changes, tests unchanged.
2. The census, the renderer and its probe.
3. The page loop over `engine.ask` with images.
4. The sanity pass, which is worth having before anything trusts a reading.
5. `leaflet.json`, then the three child processes and the report.
6. **Manual mode.** It is late because it is the cheapest step by far: the
   rendering, the resume and the sanity pass are all already built by here, and
   what is left is writing one file and refusing a bad one.
7. The layout check, which is last because it is the only step that needs the
   model and the chain description to agree.
8. Delete `AGENT-PROMPT.md` prompt A, which manual mode now generates, and update
   the README's procedure (a).
