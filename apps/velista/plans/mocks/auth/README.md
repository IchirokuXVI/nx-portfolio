# Velista credential flow mock sources

The design for `../../0009-credential-flows.md`: the two front door buttons `0008` left
recorded, plus the guest banner's action and what a confirmation link opens.

Published: https://claude.ai/code/artifact/5bc9cb60-284c-4f4a-9fc9-63e6ace1109a, the same
artifact as https://claude.ai/artifact/CLPwYdPNXmALuLm9X3G593. It holds plan `0148` too.

How these folders work, how to rebuild `index.html`, and the conventions every artboard
follows are in **`../README.md`**. Read that first.

| File | Artboard |
| --- | --- |
| `SignIn.dc.html` | Arrived, filled with the keyboard up, and rejected |
| `Register.dc.html` | The two field form, and the dashboard it lands on |
| `Upgrade.dc.html` | Securing a guest account, and the dashboard afterwards |
| `VerifyEmail.dc.html` | A confirmation link that worked, and one that did not |
| `ResendStates.dc.html` | The resend sentence in all three of its states |
| `SignInForgot.dc.html` | Plan `0148`: the sign in page with the forgot password entry |
| `ForgotPassword.dc.html` | Plan `0148`: asking for a link, what we say after, and the wait |
| `ResetMode.dc.html` | Plan `0148`: the reset link, design C, which the owner picked on 2026-10-14 |
| `OtherAccount.dc.html` | Plan `0148`: the confirm before a reset when an account or a guest is signed in on this phone, a message with one button |
| `RecoveryLinkSheet.dc.html` | Plan `0148`: a sign in link that meets another account, or a guest, asked about in a sheet over home |
| `LinkDead.dc.html` | Plan `0148`: a used or expired link |

The sign in link of plan `0148` has no screen of its own: by the owner's pick it spends the
link as the page loads and lands on home, with only the spinner of `VerifyEmail` while it
runs. When another account is on the phone it lands on home with the sheet instead.

Four things this design decided that are easy to undo by accident:

- **A guest is never shown Register.** `register()` makes a new user and would strand
  every group they own; `upgrade()` converts the same user in place. Rule C2, and the
  email shaped twin of rule D3 from `0004`.
- **Registering signs you straight in.** Verification is optional in the backend and
  login never checks it, so there is no "check your email to continue" wall to design.
- **One rejection message, under both fields.** `login()` deliberately returns the same
  error for an unknown email and a wrong password, so the screen must never say the email
  is unknown.
- **Resending is one sentence, not a button**, and the countdown shows the wait the
  server returned rather than a hardcoded 60: the throttle bucket is 3 per 10 minutes,
  so the fourth ask waits much longer than a minute.

Google is drawn on the sign in screen and **cannot be wired yet**: the callback returns
JSON instead of redirecting back with the tokens in a URL fragment, and it never passes
`linkUserId`, so a guest who used it would lose their groups. Both are backend work.

These are full routes rather than sheets, which is the line `0008` drew: a sheet
completes one field in place, and each of these is a destination with its own
alternatives underneath.
