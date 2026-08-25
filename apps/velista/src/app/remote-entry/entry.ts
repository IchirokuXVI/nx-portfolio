import { Component } from '@angular/core';

// Renders only through the shell — hitting this remote's own port (4205) directly
// must show ~nothing; the shell supplies the outlet, locale, and theme context.
//
// The app draws its own chrome (header, navigation, footer) inside AppLayout in
// libs/velista/ui, never relying on anything the shell draws (plan 0001, the
// extraction contract, item 1). This host element stays empty on purpose.
@Component({
  selector: 'app-velista-entry',
  template: ``,
})
export class RemoteEntry {}
