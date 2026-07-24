import { AsyncPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

export interface ProjectAddon {
  kind: 'video' | 'image';
  position: 'right' | 'top-right';
  src: Promise<string>;
  alt?: string;
}

export interface ProjectData {
  kind: 'client-project' | 'game';
  label: string;
  description: string;
  addons?: ProjectAddon[];
}

@Component({
  selector: 'lib-damocles-sword-project-card',
  imports: [RokuTranslatorPipe, AsyncPipe],
  templateUrl: './project-card.html',
  styleUrl: './project-card.scss',
})
export class ProjectCard {
  project = input.required<ProjectData>();

  readonly rightAddon = computed(() =>
    this.project().addons?.find((addon) => addon.position === 'right')
  );
  readonly topRightAddon = computed(() =>
    this.project().addons?.find((addon) => addon.position === 'top-right')
  );
}
