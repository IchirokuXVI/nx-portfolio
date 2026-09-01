# 0052: a line says who is out buying it

> `RealtimeEvent.LineClaimChanged` exists. It is declared at `realtime.events.ts:209`, it
> carries a doc comment specifying exactly what it may and may not say, and it is listed in
> `DOMAIN_EVENT_SUBJECTS`, so the JetStream stream is already configured to capture it.
>
> **Nothing publishes it, and it has no payload schema.** Plan `0051` section 5.3 specified it;
> the implementation landed without it. Velista `0043` then built the entire receiving half
> against the declaration: a field on the view model, `setClaim` on the store, a case in the
> event mapper, a row treatment and its styles. All of it is correct and all of it is
> permanently dead.
>
> This plan writes the payload, publishes the event, and answers the question the original
> specification did not: **what does a client that was not connected when it fired see?**

## 1. What the event is for

The third indicator. Plan `0047` section 5 lists three things a zone line can say about itself,
derives two of them from the line's own quantity and settlements, and hands the third to
`0051`: somebody is out buying this right now. Without it, two people in one household put the
same milk in two trolleys, which is the entire reason the feature exists.

It is the **one** zone event a generated list emits. Plan `0050` section 8 stated that generated
lists never emit zone events, and this is the declared exception rather than a contradiction to
be discovered later.

## 2. The payload, and the ceiling on it

The doc comment on the enum member is the specification and it is unusually strict, so it is
restated here as the contract rather than paraphrased: the payload says **that** a line is in an
active basket and **whose**, and nothing else. Not what else is in the basket. Not where they
are shopping. Not what it costs.

So the schema carries the zone and list the line belongs to (the room's own addressing), the
line id, whether it is claimed, and who by. It does **not** carry the generated list id.

That omission is the load bearing one. A zone member holding a generated list id could ask for
it, be refused, and still have learned that the id exists and belongs to the person named. More
practically, an id in a payload is an invitation for a future client to fetch it, and the
refusal would then be the only thing standing between a zone member and somebody else's basket.
The event names a person, not a basket.

**Who "whose" is.** The basket's **owner**, not the participant who happens to be holding the
line. A basket shared with three guests is still one person's trip from the household's point of
view, and naming a guest to a zone member would disclose a participant of a basket to somebody
who is not part of it. "Ana is buying this" is true when Ana's guest is the one in the shop.

## 3. When it fires

Four transitions, and the fourth is the one that is easy to forget.

1. **A run generates a basket.** Every origin line the run took becomes claimed, in one event
   per zone room rather than one per line. A generation is a burst by nature and a per line fan
   out of a hundred events into a household room is a self inflicted problem.
2. **A basket leaves `ACTIVE`.** Completed, abandoned or deleted, every line it still holds
   becomes unclaimed.
3. **A line leaves a basket**, by being settled to zero or removed from the basket, becomes
   unclaimed.
4. **A line is claimed by a second basket while already claimed by a first.** Plan `0050`
   section 3's overlap rule means a line already carried by an `ACTIVE` basket is normally
   skipped by a later run, so this is not the common path, but "claimed" is not a boolean the
   moment two baskets can hold one line. The event carries who, so the last writer naming a
   different person is a change, not a no op.

## 4. The part `0051` did not answer: arriving late

An event tells a connected client what changed. It tells a client that connects afterwards
nothing at all, and a shopping trip lasts an hour while a phone sleeps in a pocket.

As specified, the indicator would be correct only for a client that happened to be watching the
list at the moment the basket was generated, and blank for everybody else, including the same
client after a reconnect. That is worse than absent, because it is intermittently right.

**The claim is therefore state on the line, not only an event.** `LineView` gains the same two
facts the event carries: whether it is claimed and by whom. The event becomes what it should
have been from the start, a notification that a readable fact has changed, rather than the only
way to learn it. This is the same shape as every other indicator on that view: `boughtCount` and
`lastSettlementOutcome` are read and also announced.

The claim is **derived, not stored on the line**. It is a join against the `ACTIVE` generated
lines carrying that origin, resolved when the line is read. A stored flag would need to be
correct across basket deletion, account deletion, abandonment and the overlap rule in section
3.4, and every one of those is a way to leave a line claimed by a basket that no longer exists.

### 4.1 The stale claim, and why derivation is not optional

A basket that is neither completed nor abandoned holds its lines forever. Somebody generates a
basket on Tuesday, does not shop, and the household sees "Ana is buying this" for a month.

Derivation makes this a question about the basket rather than a repair job on the line, which is
where it belongs. A basket has a status and a `generatedAt`, so the read that resolves the claim
can decline to count one that is `ACTIVE` and old. **An `ACTIVE` basket older than the retention
window does not claim its lines**, and the window is the same one plan `0050` section 7 already
defines for retention rather than a second number that can disagree with it.

## 5. Contracts, events, migrations

- A payload schema for `LineClaimChanged` in `libs/luna-shopper/contracts`, matching section 2.
  The enum member and its `DOMAIN_EVENT_SUBJECTS` entry already exist and are unchanged.
- Two fields on `LineView`, per section 4, with contract schemas.
- **No migration.** Section 4 makes the claim a derived read, so there is no column and nothing
  to backfill. This is the main practical argument for deriving it.
- The publisher lives with the generation, settlement and status transitions in core, beside the
  `generatedList.*` events they already emit, so a transition cannot emit one and forget the
  other.
- The OpenAPI document is regenerated and committed. `openapi-document.spec.ts` fails otherwise,
  and it is generated output that is never hand edited.

## 6. Open decisions

- Whether a line claimed by a basket whose owner has since left the zone should still report the
  owner's name. Leaning no, and leaning the "access at request time" rule everything else here
  uses: it reports claimed, without a name.
- Whether the burst in section 3.1 should be one event per zone or one per list. Leaning per
  zone, since the room is per zone and a per list split buys nothing but more events.
- Whether an owner should see their **own** claim on a zone line, or whether it is only useful
  about other people. Leaning yes, show it, because two devices are one person often enough.

## 7. Exit criteria

- Generating a basket marks its origin lines claimed in every affected zone room, in one event
  per zone rather than one per line.
- Completing, abandoning or deleting a basket unclaims every line it held.
- Settling a line to zero or removing it from a basket unclaims it.
- A client that was not connected reads the claim from `LineView` and shows the same indicator
  as one that was.
- The payload names a person and never a generated list id.
- A basket shared with guests reports its **owner**, never a participant.
- An `ACTIVE` basket older than the retention window claims nothing.
- Velista `0043`'s existing claim path draws the indicator with no change to the frontend beyond
  reading the new `LineView` fields.
- The OpenAPI document reflects the payload and the two view fields.
