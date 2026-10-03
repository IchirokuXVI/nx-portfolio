# Mocks for the back office

One folder per design. A folder holds a Design canvas as files: `project/canvas.json` is the
index (format `v: 3`, one entry per board with its frame), and each `project/*.dc.html` is one
board, a self contained page with its own styles. There is no build step.

| Folder | Plans | Published at |
| --- | --- | --- |
| `remodel/` | `0041` to `0044` | <https://claude.ai/artifact/KJTKDyRWfdJTL9PCUPwjQv> |

The published page is private to its owner until it is shared from the page.

Every name, count and price on a board is sample data. A value written `[REAL DATA]` is one
the mock did not invent. Icons on a board are drawn in place, and the app takes its icons
from `libs/shared/ui`.

## `remodel/` boards

| Board | Shows | Plan |
| --- | --- | --- |
| `Tokens` | Colors, type, the scope mark, the parts | `0041` |
| `Main` | A chain, its shops, one shop and its section order | `0042` |
| `Phone-Chain`, `Phone-Shop` | The same on a phone | `0042` |
| `Products` | The product list with the category tree and the price at one scope | `0043` |
| `Product`, `Phone-Product` | A product's prices by chain and scope | `0043` |
| `Phone-Info` | Price rules with the info sheet open | `0041`, `0043` |
| `Review`, `Phone-Review` | The four queues on one page | `0044` |
| `Runs`, `Phone-Runs` | Presets, file import, the run in progress, earlier runs | `0044` |
| `Setup` | Chain sources | `0044` |
