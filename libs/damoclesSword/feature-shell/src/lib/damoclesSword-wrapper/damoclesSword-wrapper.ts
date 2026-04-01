import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { MainHeader } from '@portfolio/damoclesSword/ui';

@Component({
  selector: 'lib-damoclesSword-wrapper',
  imports: [CommonModule, MainHeader],
  templateUrl: './damoclesSword-wrapper.html',
  styleUrl: './damoclesSword-wrapper.scss',
})
export class DamoclesSwordWrapper implements OnInit {
  ngOnInit() {}
}
