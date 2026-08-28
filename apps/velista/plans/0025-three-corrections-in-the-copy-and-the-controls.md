# 0025: three corrections in the copy and the controls

> Three unrelated fixes, gathered because each is a few lines and none earns a plan of
> its own. They share only that all three are places where the interface said something
> other than what it meant.

## 1. Get shopping list stops apologising on every visit

`BottomActionBar` shipped its primary action `[disabled]="true"` with a permanent
**Coming soon** caption beneath it, and a paragraph in the class comment arguing that
this was the right exception to `LineComposer`'s rule about disabled controls.

The argument was about the wrong axis. The question is not whether a disabled control is
ever justified, it is **who pays and how often**. That caption sat under the primary
action of the primary screen, on every visit, for everybody, forever, to answer a
question almost nobody is asking on any given morning. And the disabled button could not
even acknowledge the tap from the one person who was.

So: the button is live, the caption is gone, and tapping it says **Coming soon**.
Whoever wonders finds out; the visits that were not wondering are not charged for it.

Three details are deliberate.

- The answer is a live region (`role="status"`, `aria-live="polite"`). A tap that
  changes nothing above the fold is indistinguishable from a tap that did not register,
  and this one changes a line at the bottom of the screen.
- `aria-describedby` is bound only while the answer exists, so the button never points
  at an element that is not in the document.
- It does not time out. A message that vanishes is one a slow reader loses to their own
  eyes, and this one costs a line of muted text under a button that is already there.

The state lives in the component rather than being raised as an output. Nothing outside
has anything to do about it: no navigation, no request, no state that outlives the bar.
Rule D1 keeps a presentational component from injecting; it does not require one to be
stateless.

## 2. The comment composer is one control, not two

`CommentComposer` put a `min-height: var(--app-touch-target)` button next to a two row
textarea on a row aligned `flex-end`. So the Send button was visibly shorter than the
box it belonged to and sat against its bottom edge, which reads as two controls that
happen to be adjacent.

`align-items: stretch` makes the pair one block, and stretch keeps them matched if the
textarea's rows ever change, which a hard coded height would not.

A button that tall wants a glyph and not a word: **Send** across the middle of a sixty
pixel square is a label looking for its control. So `SendIcon` is drawn (a paper plane,
in the icon library's existing style) and the word becomes the `aria-label`, which is
what an icon button owes a screen reader anyway. The button keeps
`min-block-size: var(--app-touch-target)` as a floor, so it stays tappable if the
composer is ever rendered somewhere with a shorter box.

## 3. The guest account says what it means

The account screen told a guest:

> Until it is secured, deleting is the only other way this account ends

which is true and answers a question nobody asked. What somebody on that screen is
actually looking for is the sign out control that is not there, and why. So it now says:

> In order to log out you need to delete your account because it is not secured to an
> email

Spanish follows, rewritten rather than translated word for word, because the English
sentence changed what it was about and a literal translation of the old one would have
answered the old question in a new language.

## 4. Acceptance

1. The dashboard draws no **Coming soon** until the primary action is tapped, and the
   button is not disabled.
2. Tapping it reveals the message in a live region the button describes itself with.
3. The comment composer's send button is the height of its textarea, carries no text,
   and is named **Send** to assistive technology.
4. The guest account note reads as above in both locales, under the key it always had.
