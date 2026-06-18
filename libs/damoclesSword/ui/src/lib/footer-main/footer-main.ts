import { AsyncPipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

interface FooterLink {
  key: string;
  label: string;
  url: string;
  icon?: Promise<string>;
}

enum Section {
  INFO = 'info',
  SOCIAL = 'social',
  LEGAL = 'legal',
  BOTTOM_ICONS = 'bottom-icons',
}

type SectionsLinks = {
  [key in Section]: string[];
};

@Component({
  selector: 'lib-damoclesSword-footer-main',
  imports: [RouterLink, AsyncPipe],
  templateUrl: './footer-main.html',
  styleUrl: './footer-main.scss',
})
export class FooterMain {
  footerLinks = input<FooterLink[]>([
    {
      key: 'home',
      label: 'Home',
      url: './home',
    },
    {
      key: 'about',
      label: 'About us',
      url: './about',
    },
    {
      key: 'contact',
      label: 'Contact',
      url: './contact',
    },
    {
      key: 'patreon',
      label: 'Patreon',
      url: 'https://www.patreon.com/profile/creators?u=162538734',
      // @ts-ignore
      icon: import('../../../assets/patreon-icon.svg').then((m) => m.default),
    },
    {
      key: 'steam',
      label: 'Steam',
      url: 'https://www.patreon.com/profile/creators?u=162538734',
    },
    {
      key: 'meta',
      label: 'Meta',
      url: 'https://www.patreon.com/profile/creators?u=162538734',
    },
    {
      key: 'policy',
      label: 'Private Policy',
      url: 'https://www.patreon.com/profile/creators?u=162538734',
    },
    {
      key: 'terms',
      label: 'Terms of Use',
      url: 'https://www.patreon.com/profile/creators?u=162538734',
    },
    {
      key: 'services',
      label: 'Our Services',
      url: './services',
    },
    {
      key: 'discord',
      label: 'Discord',
      url: 'https://discord.com/invite/tCfcs8ByCk',
      // @ts-ignore
      icon: import('../../../assets/discord-icon.svg').then((m) => m.default),
    },
    {
      key: 'youtube',
      label: 'Youtube',
      url: 'https://www.youtube.com/@DamocleSwordTeam',
      // @ts-ignore
      icon: import('../../../assets/youtube-icon.svg').then((m) => m.default),
    },
    {
      key: 'instagram',
      label: 'Instagram',
      url: 'https://www.instagram.com/damocle.sword',
      // @ts-ignore
      icon: import('../../../assets/instagram-icon.svg').then((m) => m.default),
    },
    {
      key: 'linkedin',
      label: 'LinkedIn',
      url: 'https://www.linkedin.com/company/damocles-sword',
      // @ts-ignore
      icon: import('../../../assets/linkedin-icon.svg').then((m) => m.default),
    },
  ]);

  sectionLinksKey = input<SectionsLinks>({
    [Section.INFO]: ['home', 'services', 'about', 'contact'],
    [Section.SOCIAL]: ['patreon', 'steam', 'meta'],
    [Section.LEGAL]: ['policy', 'terms'],
    [Section.BOTTOM_ICONS]: [
      'discord',
      'youtube',
      'instagram',
      'linkedin',
      'patreon',
    ],
  });

  gridSections = signal([Section.INFO, Section.SOCIAL, Section.LEGAL]);

  sectionLinks = computed(() => {
    const sectionsLinksKey = this.sectionLinksKey();
    const links = this.footerLinks();

    const mappedSectionLinks: { [key in Section]?: FooterLink[] } = {};

    for (const sectionKey in sectionsLinksKey) {
      const typedSectionKey = sectionKey as Section;

      mappedSectionLinks[typedSectionKey] = sectionsLinksKey[typedSectionKey]
        .map((urlKey: string) => links.find((url) => url.key === urlKey))
        .filter((link) => link !== undefined);
    }

    return mappedSectionLinks;
  });

  isExternal(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  get Section() {
    return Section;
  }
}
