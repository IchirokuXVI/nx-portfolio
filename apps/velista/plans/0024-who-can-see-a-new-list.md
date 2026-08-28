# 0024: who can see a new list

> Prerequisite reading: `0008` rule E1 (a single decision is a sheet, not a screen) and
> `0019` section 4 (where New list lives and why).
>
> Companion plan: `luna-shopper-backend/plans/0034`, which grants the access. The
> checkbox is inert without it.

## 1. The question the sheet did not ask

`CreateListSheet` had one field, and a list created through it was visible to its
creator and nobody else. The person naming it had no way to know that, and no reason to
suspect it: they had just made a list inside a group, in an app whose whole premise is
sharing a shop with the people in that group.

So the sheet asks, and answers before it is asked.

## 2. A checkbox, ticked

**Everyone in the group can see it**, checked, with a line underneath saying what
unticking costs.

A checkbox and not two segments, because these are not two equal choices. There is a
default that almost everybody wants and a deliberate exception, and the shape should say
so; a segmented control presents them as a decision to be made, and this sheet's job is
to not become a decision.

It stays one sheet and one screen, which is rule E1 holding rather than bending: the
person who came to name a list types a name and presses **Create list**, and the second
field costs them nothing because it arrives already answered. The person who wants a
private list unticks a box.

The reverse default was never a candidate. A list created private and shared later is a
list the rest of the group cannot see until somebody notices, and nothing on any screen
would ever say so.

## 3. The hint is not decoration

The sentence under the label says what a member can do with the list, not just that they
can see it, because backend `0034` grants WRITER and the label's word is **see**. A
checkbox whose label undersells what it grants is worse than one with no hint at all, so
the hint carries the rest of it and `aria-describedby` points at it from the control.

That is also the honest place to mention the escape hatch: the list can be narrowed
afterwards. Somebody hesitating over the box should know the decision is cheap.

## 4. Shape

- `shareWithZone` is a signal on the sheet, defaulting true, read at submit.
- It is **always sent**, including when true. The server defaults an absent field to
  sharing, but this client states the answer it collected: what went over the wire
  should be what the person ticked, not what a default happened to agree with.
- `ListServiceI.createList`, `ListApi`, `ListMemory` and `ListStore.createList` take it
  as a third argument. No overload, no options object: there is one caller and one
  question.

## 5. Testing

The assertions are about **what `createList` was called with**, not about the checkbox
being on screen. A box wired to nothing renders identically to one wired correctly, so a
rendering assertion would pass against a build where the choice went nowhere. The fake
list store records `shareWithZone` alongside the name for exactly this reason.

## 6. Acceptance

1. Opening the sheet shows the choice already ticked.
2. Naming a list and pressing Create, touching nothing else, sends `shareWithZone: true`.
3. Unticking and creating sends `false`.
4. An empty name is still refused, whatever the checkbox says.
5. The hint is reachable from the control through `aria-describedby`.
