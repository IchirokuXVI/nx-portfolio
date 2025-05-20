import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NxWelcomeComponent } from './nx-welcome.component';

@Component({
  imports: [CommonModule, NxWelcomeComponent],
  selector: 'ng-odtg-odontogram-entry',
  template: `<ng-odtg-nx-welcome></ng-odtg-nx-welcome>`,
})
export class RemoteEntryComponent {}
