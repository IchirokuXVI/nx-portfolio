import { Component } from '@angular/core';
import { DamoclesSwordUiModule } from '@portfolio/damoclesSword/ui';

@Component({
  selector: 'lib-damocles-sword-feature-home',
  imports: [DamoclesSwordUiModule],
  templateUrl: './feature-home.html',
  styleUrl: './feature-home.scss',
})
export class DamoclesSwordFeatureHome {}
