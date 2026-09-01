# Velista design mocks

One folder per page plan. Each holds the artboards for that plan, the notes that belong
on top of them, and the page built from both.

| Folder | Plan | Published |
| --- | --- | --- |
| `home/` | `0003` home page, `0007` landing and home split | https://claude.ai/code/artifact/71175929-0234-4c6e-a277-e26db88e05d5 |
| `entry/` | `0008` creating a group and joining with a code | https://claude.ai/code/artifact/eb800fe2-6786-4528-9f43-2d638f6e5acb |
| `auth/` | `0009` signing in, registering, and the guest upgrade | https://claude.ai/code/artifact/5bc9cb60-284c-4f4a-9fc9-63e6ace1109a |
| `list/` | `0012` the list page: its lines, and editing them | https://claude.ai/code/artifact/59311ab0-2a5f-4169-a115-af8f56f939be |
| `account/` | `0015` the account page: your name, your email, and the two ways out | https://claude.ai/code/artifact/724e98ef-0b68-4d62-a19a-3ea29275af36 |
| `assistant/` | `0032` the chat panel where search was, and backend `0039` behind it | https://claude.ai/code/artifact/0fedd982-86de-47c5-99e1-2458dd04cf2f |
| `install/` | `0033` installing the app: the page, the account row, and the invite | https://claude.ai/code/artifact/21a89b1f-e8b5-4800-b392-9c4b4670a70c |
| `line/` | `0043` the line is a quantity: the reel, the indicators, and the histories | https://claude.ai/code/artifact/58c83512-3899-4200-bb2b-464c805084fd |
| `basket/` | `0044` the shared basket: joining, settling, and the people you send it to | https://claude.ai/code/artifact/bdc42e90-243f-4cdd-aaf4-54ca73d12ef6 |
| `shopping-lists/` | `0045` your shopping list: the card, the sheet, and the history | https://claude.ai/code/artifact/4e6d5569-dd04-4a77-a46a-8aff2e051cd9 |
| `profiles/` | `0046` shopping profiles: where you shop, per profile | https://claude.ai/code/artifact/8c20e218-365e-45ad-a401-e96b4ed1252d |
| `brand/` | The mark itself. Source of truth for both, see below | |

## How a folder is put together

| File | What it is |
| --- | --- |
| `*.dc.html` | One artboard. Plain, self contained HTML with inline styles and no build step |
| `canvas.json` | The page title and lede, where each artboard sits, and the sticky notes |
| `index.html` | **Generated.** Every artboard inlined and every note placed, in one file |

Build it after any change to the other two:

```sh
node apps/velista/plans/mocks/build-index.mjs entry
```

Then publish `index.html` to that folder's existing artifact URL.

## Why index.html is generated, and why that matters

The published page and the committed artboards used to be two things kept in step by
hand, and they drifted. The old `index.html` pulled each artboard into an
`<iframe src="./File.dc.html">`, which works from disk and cannot work once published,
and it carried none of the sticky notes, so the published canvas had commentary the
repository did not.

Now there is one file. `index.html` is what a browser opens from disk **and** what gets
published, byte for byte, so the two cannot disagree. It carries no doctype or `<head>`
on purpose: the publisher supplies that skeleton, and a browser supplies it too.

The consequence to remember: **`index.html` is output.** Never hand edit it. Change an
artboard or `canvas.json` and run the script.

## Conventions every artboard follows

- Phone frames are **390 by 844**, and there are deliberately no desktop artboards.
- The UI says **group** and **grupo**. The code says **zone**. See rule N2 in `../0001`.
- Colour values are literal, because an artboard has no build step. They follow the
  tokens in `../0002-design-system-and-theming.md`, so **if a token changes there,
  change it here too** or the mock stops describing the system.
- The wordmark is Marcellus with `letter-spacing: 0.05em`. The hero headline uses the
  same face and does **not** take that tracking.
- A `<helmet>` block holds whatever the artboard needs in a document head. The build
  scopes its CSS to that artboard, so the Day theme's link colour cannot repaint the
  Night ones.
- Only draw a Day artboard when the page introduces a colour role that `0003` has not
  already proven on Day. `0003` has one because the bright Night ramps fail as text on
  white; `0008` and `0009` reuse those roles and stay Night only.

## The mark

`brand/velista-app-icon.svg` and `brand/velista-mark.svg` are the source of truth. The
artboards inline copies, so a redraw has to be applied in both places. For anything
that must stay exact, prefer the committed SVG over an exported image.

## Static images for the plan docs

Markdown cannot render an artboard, so when a plan needs to show a screen rather than
link to it, screenshot the published page or the local `index.html` into `exports/`
inside the folder, named after the artboard, and reference it normally.

Exports are snapshots: nothing keeps them in step, so re-export when a design changes.
They also do not embed Google Fonts, so text renders in the fallback stack rather than
in Marcellus. That is why the fallback leads with Georgia, which has similar
proportions.
