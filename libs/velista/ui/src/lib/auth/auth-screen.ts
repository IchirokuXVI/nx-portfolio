import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ChevronLeftIcon } from '../icons/icons';

/**
 * The frame four of the five credential screens sit in: a back row, a title, a lede,
 * the form, and an alternative path pinned to the bottom.
 *
 * ## Why these are pages and not sheets
 *
 * Plan 0008's rule E1 made the entry actions sheets because each completes one field
 * in place over a page that keeps its context. None of these does: each has two
 * fields, its own alternative path at the bottom, and in two cases a Google button. So
 * each is a destination, and this is the shell a destination gets (plan 0009,
 * section 4.1).
 *
 * ## What it owns
 *
 * Layout and the back control, and nothing else. The body and the footer are both
 * projected, so the four screens share every millimetre of their frame and none of
 * their copy. The title is rendered here rather than projected because it is the one
 * element the frame has to place precisely and the one a screen reader reaches first.
 *
 * Rule D1: this injects nothing. `back` is an output, because where back goes is a
 * fact about routing and this library may not know one.
 */
@Component({
  selector: 'lib-auth-screen',
  imports: [ChevronLeftIcon],
  templateUrl: './auth-screen.html',
  styleUrl: './auth-screen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthScreen {
  /** The page title. Rendered as the `h1`, so there is exactly one per screen. */
  readonly title = input.required<string>();

  /** The sentence under it, saying what the screen is for rather than repeating it. */
  readonly lede = input.required<string>();

  /** The back button's accessible name, which the caller translates. */
  readonly backLabel = input.required<string>();

  readonly back = output<void>();
}
