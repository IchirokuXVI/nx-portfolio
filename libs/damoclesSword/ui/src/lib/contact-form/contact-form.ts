import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ContactMessage,
  ContactMock,
  ContactServiceI,
} from '@portfolio/damoclesSword/data-access';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DoubleBorderedTitle } from '../double-bordered-title/double-bordered-title';
import { FormButton } from '../form-button/form-button';

/**
 * Shared reactive contact / publishing form. The heading and the submit button
 * are projected content slots — project `[contact-form-title]` and/or
 * `[contact-form-submit]` to override them; when omitted, a default double
 * bordered title and a default {@link ../form-button}'s `FormButton` are shown.
 *
 * The host section owns the background — this component keeps its inputs light
 * so it reads on both light and dark bands.
 */
@Component({
  selector: 'lib-damocles-sword-contact-form',
  imports: [
    ReactiveFormsModule,
    RokuTranslatorPipe,
    DoubleBorderedTitle,
    FormButton,
  ],
  templateUrl: './contact-form.html',
  styleUrl: './contact-form.scss',
})
export class ContactForm {
  private readonly _contact: ContactServiceI = inject(ContactMock);
  private readonly _fb = inject(FormBuilder);

  /** Toggles to `true` while a submission is in flight. */
  readonly sending = signal(false);
  /** Set to `true` once a submission has succeeded, revealing the confirmation. */
  readonly sent = signal(false);

  readonly form = this._fb.group({
    email: ['', [Validators.required, Validators.email]],
    name: [''],
    affair: [''],
    message: ['', [Validators.required]],
    links: [''],
  });

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.sending.set(true);
    this._contact.send(this.form.getRawValue() as ContactMessage).subscribe({
      next: () => {
        this.sending.set(false);
        this.sent.set(true);
        this.form.reset();
      },
      error: () => this.sending.set(false),
    });
  }
}
