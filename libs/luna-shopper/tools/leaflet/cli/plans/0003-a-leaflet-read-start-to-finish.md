> **PR:** [#465](https://github.com/IchirokuXVI/nx-portfolio/pull/465)

# 0003 A leaflet read from start to finish

> Found by `apps/luna-shopper-backend/plans/0150` (report finding 15, and
> `part1/leaflet/leaflet.md` and `render.sh` in the report folder). Blocked on plan `0002` in
> this folder, which fixes the builder. Build that first.
>
> In `0150`, the operator rendered the PDF in a Docker container because no renderer was
> installed. They pasted a prompt into three agents, added `--pages` back to the printed resume
> command, filled the validity in by hand where a resume did not overwrite it, and ran build,
> drift check and validate one by one. The developer asked for leaflets to be read by Sonnet or
> another strong vision model and never by gemma4, which is unstable on leaflets. Two engines
> that send images to Claude already exist and were not tried.

## Brief for the agent

### Objective

Make one command take a leaflet PDF to a checked document on a machine with only Docker: render
without a host renderer, read with a Claude engine by default, keep the page list and dates
across a resume, and check each hand written page as it lands in manual mode.

### Context

Paths are under `libs/luna-shopper/tools/leaflet/cli/src/` unless named otherwise.

- **Rendering.** `render.mjs:4-8, 77-96` tries only pdftoppm, then magick, then PyMuPDF. The
  zero npm dependencies rule is stated at `render.mjs:4-5`, `run.mjs:16` and `cli.mjs:23`.
  None of `pdfjs-dist`, `canvas`, `sharp` or `mupdf` is installed.
- **Engines.** `libs/shared/model-engines/src/registry.mjs:45-143` has `claude`, `api` and
  `ollama`, and `manual` is separate (`cli.mjs:50, 104`). The `api` engine sends images as
  base64 blocks with raw `fetch` (`messages-api.mjs:39-53`), needs `ANTHROPIC_API_KEY` typed
  at a terminal (`:73-96`), and defaults to `claude-sonnet-5` (`claude-models.mjs:13`). The
  `claude` engine writes the image files and gives `claude -p` its Read tool
  (`claude-cli.mjs:167-216`), so `claude -p` does read the pages. `0150` believed neither
  worked and used manual mode.
- **Resume.** The printed resume command drops `--pages` (`run.mjs:278`, `manual.mjs:140`),
  and so does the "run the same command again with --resume" line (`document.mjs:271`).
  `run.mjs:241` records `pages` and `dpi` in `run.json`, but `cli.mjs:276` reads only the
  flags. `run.mjs:235-248` rewrites `run.json` on every run, so a resume without `--pages`
  records every page.
- **Validity.** `run.mjs:345-346` writes null dates for a manual run, and `run.mjs:373`
  overwrites `leaflet.json` on every resume, so a hand edit is lost.
- **Directory input.** `census.mjs:160` sets `pageCount = pages.length`, so a folder holding
  pages 5 to 16 counts as 12 pages, and `run.mjs:196-201` or `parsePages` refuses pages 13 to
  16. `census.mjs:195` says "Neither PyMuPDF nor pdftotext is installed" when the input is
  images. With image input, `leaflet.json` hashes the page manifest, not the PDF
  (`run.mjs:350-359`).
- **Manual mode.** The CLI writes `PROMPT.md`. Its "three fields" section (`manual.mjs:123-132`)
  names snake_case keys, and it says `to-harvest-document` reads `single_unit_price`, which the
  builder did not forward before plan `0002`. `parseReading` is at `read-pages.mjs:83` and
  `sanityPass` in `sanity.mjs`.
- `--update-baseline` has no printed command (`document.mjs:279-280`).
- The `state.json` refusal `0150` noted came from the curation CLI, not this one.

### Target state

- `render.mjs` gains a fourth renderer, `docker`, probed with `docker version`, that runs
  `alpine` with `poppler-utils` and `pdftoppm` over a mounted folder, as `render.sh` did.
- The leaflet commands default to `--engine claude --model sonnet` when no engine is named.
  `--engine ollama` prints a warning that local vision models are unreliable on leaflets, and
  the README says so.
- A resume reads `pages`, `dpi` and the validity from `run.json` when the flags are absent,
  merges into `run.json` instead of rewriting it, and never overwrites `leaflet.json` fields a
  person filled. Every printed resume command carries `--pages` when the run was not all pages.
- `--valid-from` and `--valid-until` set the leaflet window on any engine.
- A folder of page images counts its highest page number and reads only the pages present.
  The census message names image input.
- Manual mode: `--check-page N` parses one `page_NN.json`, checks its shape against the plan
  `0002` schema, runs the sanity pass, and prints what is wrong with the line of the file.
  `--finish` takes chain, pages, dpi and dates from `run.json` and runs build, drift check and
  validate in order, stopping at the first failure.
- `PROMPT.md` names the plan `0002` fields. Every printed command can be pasted as is.
- `document.mjs` prints the exact `--update-baseline` command when the drift check suggests it.

### Scope

Work only in `libs/luna-shopper/tools/leaflet/cli/` (source, tests, README).

Do not touch: the builder rules from plan `0002`, `libs/shared/model-engines`, the harvester, or
the back office upload.

### Constraints

- No new npm dependency. The Docker renderer shells out as the other three do.
- The Docker renderer never pulls an image without saying so first in its output.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding an npm dependency, changing the engines library, or spending more
than 20 pages of model calls on a check.

### Progress evidence

- Tests: the Docker renderer's command line, a resume that keeps `pages` and dates, the printed
  resume command, image folder counting, `--check-page` on a good and a bad page, and
  `--finish` stopping at a failed drift check.
- `npx nx test` passes for the leaflet cli project.
- One real run on two pages of the `0150` El Jamón PDF (`part1/leaflet/SOURCE.md` names it) with
  the default Claude engine, from PDF to a validated document, with the printed output pasted in
  the PR.
