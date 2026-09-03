# 0006 The harvester screens

The harvester is the part of the back office an operator will actually open most often, and it is
the part that fits `0004`'s generic machinery least. A run is not a resource with a form; it is a
process you start, watch, and abort. An import queue is not a list you edit; it is a decision you
make repeatedly.

So this plan is mostly bespoke screens over routes that already exist, and it says so up front
rather than pretending five descriptors will cover it.

Depends on `0004` for the chrome, the list primitives and the data layer, and on
`apps/luna-shopper-backend/plans/0073` for the guard swap on the existing `admin/harvest/*` routes.

## 1. What is already routed

Every route these screens need exists today under `/v1/admin/harvest/*`. Nothing new is needed from
the backend beyond `0073`'s guard change.

| Screen            | Routes                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs              | `POST runs`, `GET runs`, `GET runs/:id`, `POST runs/:id/abort`                                                                                    |
| Catalog entries   | `GET .../entries`, `GET .../entries/groups`, `POST .../entries/:id/import`, `POST .../entries/:id/reject`                                         |
| Item source refs  | `GET item-refs`, `GET item-refs/unresolved`, `PUT item-refs`, `POST item-refs/:id/confirm`, `POST item-refs/:id/reject`, `POST .../:entryId/item` |
| Discovered places | `GET places`, `POST places/:id/confirm`, `POST places/:id/reject`                                                                                 |
| Sources           | `GET sources`, `GET sources/:supermarketId`, `PUT sources/:supermarketId`, `PUT sources/:supermarketId/enabled`                                   |

Note that the harvester gates **every** subject it exposes, reads included, unlike catalog. So every
screen here requires an admin token and there is no partially public view of any of it.

## 2. Runs are polled, not pushed

Progress comes from polling `GET runs/:id`, not from a socket. This is backlog `0001` section 6.6's
own phasing ("phase one is polling ... every couple of seconds"), and the realtime `admin:harvest`
room it describes stays deferred.

That keeps the admin app free of realtime entirely, which `0001` section 4 relies on: no socket
client, no `LUNA_REALTIME_URL`, no second origin in CORS.

Polling requirements that matter:

- Poll only while a run screen is open **and the tab is visible**. The same
  `document.visibilityState` gate `0003` uses for the keepalive, for the same reason.
- Stop polling as soon as the run reaches a terminal state.
- A run is long. Eighteen minutes and 4,383 requests is the documented shape of a full catalog
  discovery, so the screen is built for something watched intermittently: it must be correct on
  arrival, not only correct if you watched it from the start.

## 3. The three switches, which are three decisions

There are three separate controls over whether harvesting happens, and conflating them in the UI
would misrepresent what they mean.

| Switch                                 | Decides                                        | Where it lives                  |
| -------------------------------------- | ---------------------------------------------- | ------------------------------- |
| `lunaShopperBackend.harvester.enabled` | whether the service exists in a cluster at all | Helm. Not in this app.          |
| `HARVEST_ENABLED`                      | whether a pod that exists may start any run    | Service config. Read only here. |
| `MERCADONA_ENABLED`                    | whether that one storefront may be fetched     | Service config. Read only here. |

All three default to false. The app **shows** all three and **changes** none of them: they are
deployment configuration, not application state, and a back office button that edits a cluster's
config map is a different and much larger feature.

What the app does change is `PUT sources/:supermarketId/enabled`, which is per chain and is
application state.

The screen must make the distinction legible, because "why did my run do nothing" is otherwise
unanswerable from the UI. When a run cannot start, the reason is displayed: the service is off, the
storefront is off, or the chain is disabled.

## 4. The harvester does not run in a cluster

`harvester.enabled` is false in both `values.production.yaml` and `values.staging.yaml`,
deliberately, and nothing renders in either cluster: no Deployment, Service, PDB, migration Job,
StatefulSet, PVC or backup CronJob. Runs happen on the development machine against the compose
stack.

So these screens are, for now, **screens an operator uses locally**. They still ship in the
production image, and they must degrade honestly there: when the harvester is absent, the screens
say the service is not deployed in this environment, rather than showing an empty list that implies
there have been no runs.

This is worth stating because it is the kind of thing that reads as a bug in production forever
otherwise.

## 5. The queues

Three screens are decision queues rather than editors, and they share a shape: a list of items each
needing confirm, reject, or a correction, worked through in sequence.

- **Discovered places.** Locations found in OpenStreetMap, offered rather than silently created. A
  place matching neither the provider ref nor "same brand within 50 metres" is offered as new, so
  the screen shows why each one is being asked about, and near duplicates need to be visible side
  by side or the operator cannot make the call.
- **Source catalog entries.** Products found at a storefront, imported or rejected. `GET
entries/groups` exists to group them, and the screen uses it: importing 4,000 products one at a
  time is not a workflow.
- **Item source refs.** The mapping from our item to the source's product. `GET item-refs/unresolved`
  is the queue; `PUT item-refs` and `POST entries/:entryId/item` are the corrections. A ref whose
  source has gone `GONE` needs to be recognisable, since that is a different problem from one that
  was never resolved.

Queue screens are built for repetition: the next item comes up without navigating back to a list,
and the primary action is reachable without aiming, on a phone as well as a desktop.

## 6. Starting a run is attributed to the harvester

An operator who starts a run causes thousands of catalog writes, and the audit trail attributes
those to the **service**, not to them
(`apps/luna-shopper-backend/plans/0075`, section 3). The screen should not imply otherwise: it
reports that a run was started, not that the operator changed 4,000 prices.

## 7. Tests

- Polling starts on a running run, stops on a terminal one, and pauses on a hidden tab.
- A run screen opened mid-run renders correct state without having observed the start.
- The three switches render their real values and are not editable.
- With the harvester absent, every screen says so rather than rendering empty.
- Each queue's confirm and reject call the right route and advance to the next item.

## 8. Exit criteria

- A run can be started, watched to completion and aborted, from a phone.
- Each of the three queues can be worked through end to end.
- Per chain source configuration can be read and its enabled flag toggled.
- No socket connection is opened by this app.

## 9. Out of scope

- Editing deployment configuration of any kind.
- The realtime `admin:harvest` room.
- Scheduling runs, which backlog `0001` describes and nothing implements.
