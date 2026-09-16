# What to tell a model agent that writes a new chain's folder

One prompt to paste into a Claude Code session. The agent reads the page
images itself with its Read tool, so no API key is involved. Replace every
`<...>` before pasting. The agent must never commit the page images, the
readings or the document: they are working material under `tmp/leaflet`.

**There used to be a second prompt here, for reading a leaflet of a chain that
already has a folder, and the command replaced it.** It was a hand maintained
copy of a procedure, and `--engine manual` now generates the same thing from
the chain's own files, for this leaflet, with real paths in it:

```sh
npx nx run luna-shopper/leaflet-cli:read -- --pdf <path> --chain <slug> --engine manual
```

That writes `<out>/PROMPT.md`, which is what you paste. It carries the chain's
own `prompt.txt` byte for byte rather than a copy of it, so it cannot drift.
See the README's procedure (a).

The procedure the prompt below follows is `README.md` procedure (b). Keep the
two in step: a change to the procedure is a change here.

## The prompt: a chain with no folder under `chains/` yet

Nothing is written for the chain yet, so the agent writes the chain folder
first and reads the leaflet second. The first reading has no baseline to be
checked against, which is why step 6 asks you to spot check three pages.

```text
A new supermarket chain, <CHAIN NAME> (slug <slug>), has its first leaflet PDF
at <PATH TO PDF>. Prepare the chain under
libs/luna-shopper/tools/leaflet/chains/src/<slug>/ and then
read the leaflet into a HarvestDocument.

Read libs/luna-shopper/tools/leaflet/cli/src/README.md in full
first, then follow its procedure (b) exactly.

1. Census and render the PDF by hand: page count, text layer per page, every
   page to a PNG at 160 dpi under tmp/leaflet/<slug>-pages/. The read command
   cannot help here. It resolves the chain folder first, and there is not one.

2. Look at three pages with the Read tool: the cover, one grocery page and
   one non food page. Write chains/<slug>/layout.md in the style of
   chains/deza/layout.md: the tile layout, the price badge and its footer,
   the decimal separator, loyalty badges or none, the heading banner, typical
   products per page, and anything printed on the tiles that is not a
   promotion of this leaflet.

3. Write chains/<slug>/prompt.txt by copying the closest existing chain's
   prompt and adapting only the rules that differ for this chain: the decimal
   separator, the price badge, whether a loyalty mechanic exists, the
   promotion wording, and the heading banner vocabulary. Keep every other
   rule as it is.

4. Write chains/<slug>/headings.mjs in the shape of chains/deza/headings.mjs:
   every department heading this leaflet prints, folded onto the schema's own
   slugs, the default fixed pages, the tool name a reading uses, and DPI. DPI
   is the dpi this chain's pages are rendered at. Use 160 unless the pages are
   wider than they are tall, which is 128.

5. The chain now has a folder, so read the leaflet with the command:

   npx nx run luna-shopper/leaflet-cli:read -- \
     --pdf <PATH TO PDF> --chain <slug> --engine manual

   It writes <out>/PROMPT.md. Follow that file, read every page image with
   the Read tool, write one JSON array per page where it says, then pick the
   run back up:

   npx nx run luna-shopper/leaflet-cli:read -- \
     --out <out> --resume --engine manual

   There is no baseline yet, so the run skips the drift check and says so. Do
   not run --update-baseline.

6. Report what the run reported, and name the three pages you consider hardest
   (promotions, per kilogram prices, loyalty) so a person can spot check them
   against the built document before the baseline is created.
```

When the spot check passes, create the baseline yourself:

```sh
node libs/luna-shopper/tools/leaflet/cli/src/build-document.mjs \
  --readings tmp/leaflet/<slug>-import \
  --leaflet tmp/leaflet/<slug>-import/leaflet.json \
  --chain <slug> \
  --out tmp/leaflet/<slug>.harvest-document.json \
  --update-baseline
```

Commit the four files under `chains/<slug>/` (`layout.md`, `prompt.txt`,
`headings.mjs`, `baseline.json`) in a pull request against `dev`. From the
second leaflet on, use the command:

```sh
npx nx run luna-shopper/leaflet-cli:read -- --pdf <path> --chain <slug>
```
