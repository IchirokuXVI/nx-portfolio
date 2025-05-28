import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LandingComponent } from '../landing/landing.component';

@Component({
  imports: [CommonModule, LandingComponent],
  selector: 'app-landing-entry',
  template: `<app-landing></app-landing>`,
})
export class RemoteEntryComponent {}
