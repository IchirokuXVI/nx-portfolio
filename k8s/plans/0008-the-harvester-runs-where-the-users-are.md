# 0008 The harvester runs where the users are

`harvester.enabled` is false in `values.yaml`, in `values.staging.yaml` and in
`values.production.yaml`, and all three say why at length. The chart describes the service fully
anyway, so nothing has drifted and turning it on is a flag rather than a rewrite.

This plan turns it on, for **store discovery only**, because
`apps/luna-shopper-backend/plans/0062` puts a discovery run in the path of an ordinary user adding
a postal code, and a service that does not exist in a cluster cannot run there.

It gates the user visible half of the whole postal code set. Nothing in `0059` through `0063` is
observable outside a dev slot until this ships.

## 1. One of the two reasons is gone; the other is not

Production's file gives capacity as the reason, and is precise about it:

> A catalog discovery run is 4,383 HTTP requests over eighteen minutes at the default rate, and
> running it costs a third Postgres with its own 2Gi volume plus a sixth Node process on a VPS
> whose Postgres instances are capped at 256Mi each.

Two costs are bundled there and they come apart under this plan.

**The fetching cost evaporates for this workload.** `HarvestRunMode`'s own doc puts
`STORE_DISCOVERY` at **two requests**: one geocode, one Overpass query. Against 4,383 it does not
register, and with `0062`'s thirty day cooldown a postal code costs two requests a month no matter
how many users share it.

**The resident cost is unchanged.** A fourth Postgres with its own 2Gi volume and another Node
process at roughly 230 MB are the same whether the service fetches twice a month or four thousand
times a day. That is the cost this plan actually has to justify, and section 5 is the justification.

So this is not "the objection was wrong". It is "the objection had two halves, one no longer
applies, and the other is worth paying now that a user facing feature depends on it".

## 2. Staging first, because the file already said so

> If the harvester is ever turned on in a cluster, staging is where it goes first and
> MERCADONA_ENABLED stays false there: the run machinery can be exercised against a stub without
> touching the chain.

Follow it exactly. Staging gets the flag first and runs for long enough to see real store discovery
traffic from real profile edits. Production follows.

**`MERCADONA_ENABLED` stays false in both clusters, permanently, under this plan.** Store discovery
reads OpenStreetMap and never touches a storefront, so "the service exists and discovers shops"
and "the service scrapes a supermarket's prices" stay separate decisions, which is what
`0038` section 8.1 separated the two switches to achieve. `HARVEST_ENABLED` becomes true; the third
switch does not.

## 3. The double fetch rule, and how this plan stays inside it

Staging's file adds a second objection that production's does not:

> Section 8.1: staging and production must never hit the same third party twice for the same data.

While both clusters are on, both will query Overpass for postal codes their own users added. That
is real and should be written down rather than argued away. Three things bound it:

- The cooldown in `0062` is thirty days, so a shared postal code is two requests per cluster per
  month.
- Staging holds few real profiles, so the overlap is small in practice and shrinks as production
  grows.
- The prohibition was written about walking Mercadona's whole assortment twice, which is four
  thousand requests for one copy of an answer. Two requests a month for a postal code somebody
  actually lives in is a different order of thing, and OSM's licence and posture differ from a
  storefront's in exactly the way `osm-places` documents.

If that stops being comfortable, the fix is a shared cache rather than turning a cluster off, and
it is not needed at this volume.

## 4. What flipping the flag renders

Everything the chart already describes and currently skips: the Deployment (`replicas: 1`,
`strategy: Recreate`, because a run must not have a second copy of itself), the Service, the
PodDisruptionBudget, the migration Job, the StatefulSet with its 2Gi PVC, and the backup CronJob at
`7 3 * * *`.

Plus **the two Secret keys `provision-release.sh` already knows how to write**, per production's
own note. Run `provision-release.sh --check --env <env>` before deploying either cluster: it
renders the chart and asserts every `secretKeyRef` it references exists, which is precisely the
failure mode a newly enabled service introduces.

## 5. What the fourth database actually holds under store discovery

Worth sizing, because the 2Gi volume was sized for a workload this plan is not enabling.

Store discovery writes `DiscoveredPlace` rows, roughly 75 per postal code from `0038`'s
measurement, plus `HarvestRun` rows and `0062`'s queue table. A few hundred postal codes is tens of
thousands of small rows. The volume that made the harvester expensive is
`SourceCatalogEntry` from catalog discovery, which stays switched off.

The 2Gi claim stays as it is regardless. A PVC does not shrink, sizing it down now would have to be
undone the first time catalog discovery is wanted, and 2Gi of local-path on a VPS is not the
constraint. The 256Mi Postgres limit is the one to watch, and it is comfortable for this row count.

## 6. The backup is not optional, for a reason worth stating

The harvester's database looks regenerable: run discovery again and the places come back. **The
places do come back. The decisions do not.** `DiscoveredPlaceStatus` records which places an admin
imported and which they rejected, and a re run explicitly does not resurrect a rejected place,
because "status is the owner's, and a run does not get to overwrite a decision". Losing that table
means every rejection an admin ever made silently reappears as new work.

So the CronJob the chart already declares stays on in production, and the restore drill in
`0005` covers this database like the other three.

## 7. A stale line to correct while in there

Production's comment calls it "a third Postgres". It is the **fourth**: `values.yaml` lists auth,
core and catalog before it, and the harvester's entry carries `optional: harvester`. Fix it in the
same change. It is the kind of off by one that was true when it was written and quietly stops
being a reliable description of the cluster.

## 8. Turning it back off leaves the volume behind

A StatefulSet's `volumeClaimTemplates` PVCs are not deleted when the StatefulSet is, so flipping
`harvester.enabled` back to false removes the workload and leaves a 2Gi claim on the node. That is
correct behaviour and it is not obvious, so it belongs in the rollback note rather than being
rediscovered by somebody wondering where their disk went. Deleting the claim is deliberate and
manual, and it destroys the import decisions in section 6.

## 9. Exit criteria

- `provision-release.sh --check --env staging` passes with the harvester enabled, before any
  deploy.
- Staging renders and starts all seven services, with the harvester's migration Job completing and
  its StatefulSet ready.
- `HARVEST_ENABLED=true`, `MERCADONA_ENABLED=false` in both clusters, asserted by reading the
  rendered manifest rather than the values file.
- A postal code added on staging produces a `STORE_DISCOVERY` run with trigger `SYSTEM` and
  `DiscoveredPlace` rows, and creates no catalog location.
- No Mercadona request leaves either cluster, checked in the harvester's logs over the soak.
- The nightly backup of `luna-shopper-backend-harvester-db` runs in production and restores in a
  drill.
- Production follows staging only after a soak long enough to see real traffic, not on the same
  day.
- The "third Postgres" line reads "fourth".
