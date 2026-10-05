> **PR:** [#628](https://github.com/IchirokuXVI/nx-portfolio/pull/628)
> Five things were left out. The first three need the gateway, which was out of scope.
> Target 1: the tile "Prices out of date" opens the product list with no filter. The "Out of
> date" filter of `0043` needs one price scope, and the tile counts every scope.
> Target 3: a list row and a price row of the feed have no link. An audit row names no zone and
> no product, so the app cannot build the address.
> Target 6: the count on the "Failed sign ins" tab is the last 24 hours and not "today". The
> document holds the failures of the last 24 hours and of the last 7 days.
> Target 2: "Failed" in the Harvest panel is over all time, and its label says so. The document
> holds the failed runs by status and not by window.
> Section 1: `harvesterDeployed()` still says that staging and production do not run the
> harvester. The plan asks only for the stale comments that name it to go.

# 0046 The overview, the admins and the way in

> Sixth of the seven remodel plans. Needs `0041` (the frame and the tokens). Its links point
> at the addresses of `0042` to `0045`, so build it after them. Prerequisite reading: `0041`,
> `0016` (the screen the app opens to), `0002` and `0003` (the way in, the session), `0008`
> (when the gateway does not answer).
>
> Mock: `plans/mocks/remodel/`, boards `Overview`, `Admins`, `Phone-Overview`, and the "More"
> sheet on `Phone-Zone`, published at <https://claude.ai/artifact/KJTKDyRWfdJTL9PCUPwjQv>.

Three small parts of the app are left after `0042` to `0045`. The Overview shows what waits,
failed sign ins and recent activity, while the numbers of each area sit on three other
dashboards that those plans remove. The Admins screen is one read only list under a paragraph
about a command line. The sign in page and the two full screen covers each carry their own
copy of the same card styles.

## Brief for the agent

### Objective

Give the Overview its final layout with the numbers of every area, turn Admins into a page
with two tabs, and move the sign in page and the two covers onto one shared card. Use the
`nx-portfolio-angular-developer` skill.

### Context

- **Overview**: `feature-dashboard/src/lib/dashboard-page.ts` and `dashboard-view.ts`. One
  read, `GET /v1/admin/dashboard`, polled every 60 seconds by `DashboardStore`.
- **Admins**: `feature-people/src/lib/admins.ts`, a read only descriptor over
  `GET /v1/admin/admins`.
- **The way in**: `feature-auth/src/lib/sign-in-page.ts`, `reauth-overlay.ts`,
  `server-down-overlay.ts`, `session-warning.ts`. `ui/src/lib/environment/environment-badge.ts`
  is drawn on the sign in page and in the old header.
- **Deployment**: `DeploymentStore`, values `production`, `staging`, `development`, or none.

### Target state

1. **Overview, top: "Waiting for you".** The tiles that exist today, in one row on a wide
   screen and two columns on a phone. A tile with a count above zero takes the waiting wash.
   A tile at zero stays and is plain, so that the row does not jump. The two per chain tiles
   (products to decide, shops to map) become one tile each, with the chains and their counts
   as the second line. Each tile links to its place: the Review queues of `0044`, Zones of
   `0045`, the product list with "Out of date" of `0043`, postal codes in Setup.
2. **Overview, left: the numbers.** One panel per area. Catalog: chains, shops, products,
   groups, priced, and the chart "Prices written each day". Shoppers: people, zones, lists,
   being shopped, and the chart of sign ups. Harvest: runs in the window, running, failed,
   and how many chains may be fetched. A number links to its list. On a phone each panel is a
   row that opens.
3. **Overview, right: "What changed".** The activity feed as a list: when, who, what. A row
   links to the thing when it can.
4. **Overview states.** "Read N minutes ago" and "Refresh" in the header. When a refresh
   fails, one line says that the numbers are older than the time shown. When a service did
   not answer, its panel says so and offers "Try again". Nothing else changes.
5. **Failed sign ins leave the Overview.** They become the second tab of Admins. The tile
   "Failed admin sign ins, last 24 hours" stays on the Overview and links to that tab.
6. **Admins** has two tabs. "Accounts": name, sign in name, state (Active or Turned off), last
   sign in, with the signed in admin marked "(you)". Rows do not open. "Failed sign ins": the
   two counts and the table (when, sign in name, from), with the count of today on the tab.
7. **The info of Admins** replaces `people.admins.note`: "This list is read only. An admin is
   added on the server, not here." "To add one, run this where the auth service runs:", then
   the command in the mono face with a "Copy" button.
8. **The way in.** One `EntryCard` component in `ui` holds the card, field, button and error
   styles that the sign in page and the two covers repeat. The sign in page shows the
   deployment color as a band 8 px high at the top of the window and the deployment name
   above the form. A deployment that is not known keeps today's warning text.
9. **The account menu.** The account button of the rail (and the "More" sheet on a phone)
   shows the operator name, the deployment name, "Read the catalog in" with its two
   languages, and "Sign out". `environment-badge` is drawn nowhere else in the frame.
10. **The session warning** stays a strip at the bottom. On a phone it sits above the bar.

### Scope

- In: `feature-dashboard`, `feature-people/src/lib/admins.ts` and a new admins page,
  `feature-auth`, `ui/src/lib/environment/**`, new `ui/src/lib/entry/**`, `en.json`, specs.
- Out: the gateway, session and reachability policy, the sign in rules.

### Constraints

- One read feeds the Overview. Do not add a request for each panel.
- The covers keep their focus trap, their `inert` page behind, and their order (server down
  above session ended).
- A chart is a `ui` chart component (plan `0015`). Do not draw bars by hand as the mock does.
- No number on the Overview is worked out in the browser from a list.
- The Overview has no window control today, and this plan adds none.

### Action boundaries

- Do not add a route that creates, changes or removes an admin.
- Do not change `session-keepalive.ts` or `reachability-policy.ts`.

### Progress evidence

- `npx nx lint` and `npx nx test` for `luna-shopper-admin/feature-dashboard`,
  `luna-shopper-admin/feature-people`, `luna-shopper-admin/feature-auth`,
  `luna-shopper-admin/ui` and `luna-shopper-admin`. `npx nx build luna-shopper-admin`.
- A browser walk at 390 px and 1360 px, once on a local stack (blue) and once with the
  deployment forced to staging and to production: the sign in page, the Overview, each tile's
  link, Admins and its info panel, the session ended cover, the server down cover. Attach the
  screenshots.

## 1. What this plan deletes

- The "Admin sign ins" section of `dashboard-page.ts`.
- `people.admins.note`, and `toAdminPage` if the new page reads the gateway directly.
- The card styles repeated in `sign-in-page.ts`, `reauth-overlay.ts` and
  `server-down-overlay.ts`.
- `environment-badge` if the account menu and the sign in page no longer need a component for
  one line of text. Keep its "not known" warning text.
- The stale comments that name `harvesterDeployed` in `dashboard-page.ts` and `block-notice.ts`.

## 2. Decisions made

The owner settled these on 2026-10-03.

- **Admins is a section of its own**, so that failed sign ins stay one press away.
- **No window control on the Overview.** The gateway sends a window and takes no parameter
  for it.
