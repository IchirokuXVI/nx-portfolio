import { AsyncPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';

export interface ProjectAddon {
  kind: 'video' | 'image';
  position: 'right' | 'top-right';
  src: Promise<string>;
  alt?: string;
}

export interface ProjectData {
  kind: 'client-project' | 'game';
  label: string;
  /** Already-translated copy for the active locale (rendered as-is). */
  description: string;
  addons?: ProjectAddon[];
}

@Component({
  selector: 'lib-damocles-sword-project-card',
  imports: [AsyncPipe],
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
