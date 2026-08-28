# 0034: a new list is shared with its group

> Prerequisite reading: `0007` section 1 (lists, and `list_access` as the access table)
> and section 2 (who may set access).
>
> Companion plan: `velista/plans/0024`, which asks the question this plan answers.

## 1. What creating a list did

`ListService.create` wrote the list and exactly one `list_access` row, for its creator,
as WRITER. Nobody else in the zone got anything.

That is a defensible default for a document and the wrong one for this product. A zone
is the household or the flatmates who share a shop; a list created inside one that
nobody else can see does not announce itself as private, it simply never appears on
anybody else's dashboard. The failure is silent on both sides: the creator believes
they made a shared list, and the group never learns there was one to miss.

The share sheet (`setAccess`, plan `0007` section 2) has always existed to fix this
afterwards, and afterwards is the problem. Sharing is remembered by the person who
already knows about the list.

## 2. The change

`CreateListRequest` gains `shareWithZone?: boolean`. When it is not `false`, creating a
list also writes a `list_access` row for **every other approved membership in the zone**,
as WRITER, in the same transaction as the list.

### 2.1 Absent means shared, and that is not laziness

The field is optional and `undefined` is treated as `true`. Two independent reasons
point the same way, which is why it is not a coin toss:

- The shared list is what somebody almost always means. A private one is the deliberate
  exception, and an exception is what should cost the tap.
- The field was added after clients existed that cannot send it. An older build must
  keep getting the behaviour it has always had; making absence mean private would have
  it silently start creating lists its user cannot share, with no code change and no
  error anywhere.

### 2.2 WRITER, not READER

This is the decision in the plan worth arguing about, and the argument is what a list
here is **for**. A list in this app is shopped from: the thing a member does with one is
tick a line off in an aisle, and a reader cannot. A group of readers watching one person
shop is not a household shopping list, it is a document with an audience.

READER remains available, one tap away, on the share sheet that already has all three
states per member. Nothing this method writes is a decision the creator cannot undo, and
the reverse — a group who cannot use the list until somebody notices and promotes them —
is the failure that has no visible symptom.

### 2.3 One transaction

The grants are written inside `dataSource.transaction`, with the list. Not for
throughput but because the two orders it rules out are both bad: a list committed before
its grants is one the group cannot see for the length of the gap, and grants committed
against a list that then rolls back are rows pointing at nothing.

### 2.4 Approved memberships only

Access follows the membership row, so a pending request is granted nothing: they are not
in the group yet. Somebody approved **later** has no row either, which is the same gap
`setAccess` has always had and is the share sheet's job. Making approval retroactively
grant access to every existing list is a larger change than this one and is not smuggled
in here.

The membership read runs on the transaction's own manager, so it sees the same snapshot
as the insert beside it. A member approved between the read and the write is a race the
share sheet settles, and is not worth a lock in the create path.

## 3. Cost

One extra query per list creation, selecting membership ids for one zone against
`ix_memberships_zone_status`, and one multi row insert. A zone's membership is small by
construction, and creating a list is a rare, user initiated write. This is not a path
worth optimising ahead of evidence.

## 4. What is deliberately not built

- **A zone level default.** "This group shares everything by default" is a setting, a
  migration, and a second place for the answer to live. The checkbox already carries the
  default and remembers nothing, which is the version that cannot get out of step.
- **Retroactive grants on approval.** Section 2.4.
- **Any change to `setAccess`.** It already does the general case correctly.

## 5. Acceptance

1. A member of a three person group creates a list with the box ticked. The other two
   see it on their dashboards, and can add a line to it.
2. The same, with the box unticked: the other two see nothing, and the creator can
   still share it from the share sheet afterwards.
3. A request that omits `shareWithZone` entirely shares, and a spec asserts it.
4. A pending member is granted nothing in either case.
5. The access rows and the list are written in one transaction, asserted through the
   manager the transaction hands out.
6. `openapi.json` carries `shareWithZone` on `CreateListDto`, regenerated rather than
   edited.
