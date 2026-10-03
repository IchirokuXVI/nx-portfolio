# Mocks for the back office

One folder per design. A folder holds a Design canvas as files: `project/canvas.json` is the
index (format `v: 3`, one entry per board with its frame), and each `project/*.dc.html` is one
board, a self contained page with its own styles. There is no build step.

| Folder | Plans | Published at |
| --- | --- | --- |
| `remodel/` | `0041` to `0047` | <https://claude.ai/artifact/KJTKDyRWfdJTL9PCUPwjQv> |

The published page is private to its owner until it is shared from the page.

Every name, count and price on a board is sample data. A value in square brackets, such as
`[REAL DATA]` or `[NAME]`, is one the mock did not invent. Icons and charts on a board are
drawn in place. The app takes its icons from `libs/shared/ui` and its charts from the `ui`
chart components.

Every screen board shows the rail in the staging color. `Deployments` shows the three colors.

## `remodel/` boards

| Board | Shows | Plan |
| --- | --- | --- |
| `Tokens` | Colors, type, the scope mark, the parts | `0041` |
| `Deployments` | The rail and the bar for production, staging and a local stack | `0041` |
| `Main` | A chain, its shops, one shop and its section order | `0042` |
| `Phone-Chain`, `Phone-Shop` | The same on a phone | `0042` |
| `Products` | The product list with the category tree and the price at one scope | `0043` |
| `Product`, `Phone-Product` | A product's prices by chain and scope | `0043` |
| `Phone-Info` | Price rules with the info sheet open | `0041`, `0043` |
| `Review`, `Phone-Review` | The four queues on one page | `0044` |
| `Runs`, `Phone-Runs` | Presets, file import, the run in progress, earlier runs | `0044` |
| `Setup` | Chain sources | `0044` |
| `Shoppers`, `Phone-Zone` | A zone with its members, and the "More" sheet of the bar | `0045`, `0041` |
| `Overview`, `Phone-Overview` | What waits, the numbers, what changed | `0046` |
| `Admins` | The accounts, with the info panel open on a wide screen | `0046`, `0041` |
