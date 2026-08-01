import { Component } from '@angular/core';
import { LogoBrand } from '../logo-brand/logo-brand';

@Component({
  selector: 'lib-damocles-sword-footer-logo',
  imports: [LogoBrand],
  templateUrl: './footer-logo.html',
  styleUrl: './footer-logo.scss',
})
export class FooterLogo {}
