import { Component } from '@angular/core';

// Renders only through the shell — hitting this remote's own port (4204) directly
// must show ~nothing; the shell supplies the outlet, locale, and theme context.
@Component({
  selector: 'app-landing-v2-entry',
  template: ``,
})
export class RemoteEntry {}
