import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Landing } from '@portfolio/landing/ui';
import { ProjectMemory } from '@portfolio/landing/data-access';
import { Project } from '@portfolio/landing/models';

@Component({
  selector: 'lib-landing-wrapper',
  imports: [CommonModule, Landing],
  templateUrl: './landing-wrapper.html',
  styleUrl: './landing-wrapper.scss',
})
export class LandingWrapper implements OnInit {
  _projectServ = inject(ProjectMemory);
  projects: Project[] = [];

  ngOnInit() {
    this._projectServ.getList().subscribe((projects) => {
      this.projects = projects;
    });
  }
}
