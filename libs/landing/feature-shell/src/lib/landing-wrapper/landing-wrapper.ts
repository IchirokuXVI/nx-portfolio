import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Landing } from '@portfolio/landing/ui';

@Component({
  selector: 'lib-landing-wrapper',
  imports: [CommonModule, Landing],
  templateUrl: './landing-wrapper.html',
  styleUrl: './landing-wrapper.scss',
})
export class LandingWrapper {}
