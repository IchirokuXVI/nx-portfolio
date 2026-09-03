# 0001 (backlog) The admin door is not on the street

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.
>
> This is the first backlog plan in `k8s/plans/`, so the directory is created by it.

`admin.velista.app` is reachable from the whole internet, by decision. This plan describes putting
a second wall in front of it, and is parked because that decision was made deliberately rather than
by omission.

## 1. What is being defended

The back office reaches every price, every product, every user account and every zone in the
system, and after `apps/luna-shopper-backend/plans/0074` it can delete accounts. Its entire defence
is one username and password on a login form that anybody can load.

That form is well built: `0071` throttles it, locks the account out after repeated failures,
records every attempt, hashes with argon2, and hands out a fifteen minute token with no refresh
token behind it. This plan does not fix a weakness in it. It removes the need to rely on it alone.

The specific value is that a single operator account is a far better brute force and credential
stuffing target than a user base, because the attacker knows there are very few valid usernames.
An edge restriction takes the login form off the public internet entirely, so an attacker has to
get past something before they can even begin.

## 2. Two ways to do it

Both operate on the `HTTPRoute` for the admin host, in the chart, and neither touches the app.

**An IP allowlist.** Cheapest, and adequate for a single operator with a small number of known
networks. Its cost is exactly its mechanism: locking yourself out from an unexpected network is a
real and annoying failure, and mobile networks reassign addresses. For a tool that is meant to be
usable on a phone, this is a genuine tension rather than a theoretical one.

**A client certificate.** Travels with the device rather than the network, which fits the mobile
requirement properly. Costs a certificate to issue, install on each device, and renew, and the
install step on a phone is fiddly.

The mobile requirement in `apps/luna-shopper-admin/plans/0001` is what decides between them, and it
points at the certificate. The allowlist is the one to reach for if the phone requirement ever
softens.

## 3. Why it is parked, honestly

The back office does not exist yet. Restricting access to a thing before it has been used once
optimises against a threat while the shape of ordinary use is still unknown, and the most likely
outcome is a restriction that makes the tool annoying enough to work around.

It is also cheap to add later. Nothing in the app, the API or the chart's app entry changes; this
is a filter on one route. Deferring it costs nothing but the exposure window, and the exposure
window is guarded by section 1's list.

The trigger to pick it up: the failed login records from `0071` section 7 showing attempts from
anyone but the operator. Those rows are being written from the day that plan ships, which is what
makes this decision reviewable later with evidence rather than by feel.

## 4. What it would not solve

- It is not a substitute for the login. Both walls stand or neither is worth building.
- It does not protect the API. `api.velista.app` stays public because velista needs it, and every
  admin route on it is guarded by `AdminJwtGuard` regardless of which host the caller came from.
  An edge restriction on the admin app's own host does not gate the routes it calls.

That second point is the one that would be easiest to get wrong: restricting the front end host and
assuming the admin API is thereby protected. It is not, and it must not be designed as though it
were.
