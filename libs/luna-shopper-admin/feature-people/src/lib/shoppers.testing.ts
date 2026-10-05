import { provideLocationMocks } from '@angular/common/testing';
import { Component, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  ServerReachability,
  SessionStorage,
  SessionStore,
  type DirectoryServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { oldShopperAddresses } from './old-addresses';
import { SHOPPER_RESOURCES, shoppersRoutes } from './shoppers-routes';
import { USERS } from './users';

/**
 * The Shoppers section, mounted for a spec the way the app mounts it (admin
 * plan 0045).
 *
 * Everything runs against the in-memory gateway, which is the default behind
 * `RESOURCE_GATEWAYS`, so there is no backend and no `HttpClient` here. The
 * section is the one `sections.ts` declares, less its icon and its counter: a
 * spec that mounted the screens at other addresses would prove nothing about
 * the links between them, and those links are most of this plan.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class ShoppersTestHost {}

/** The section as the app declares it. */
export const SHOPPERS_TEST_SECTION: AdminSection = {
  key: 'shoppers',
  label: 'shell.sections.shoppers',
  segment: 'shoppers',
  landing: USERS.segment,
  held: SHOPPER_RESOURCES,
  heldTabs: true,
  screens: [...shoppersRoutes(), ...oldShopperAddresses()],
};

/** A directory that records what it was asked to do and does nothing else. */
export function recordingDirectory() {
  const calls: string[] = [];
  const directory: DirectoryServiceI = {
    deleteUser: async (id) => void calls.push(`deleteUser:${id}`),
    resendVerification: async (id) => void calls.push(`resend:${id}`),
    setUserRoles: async (id, roles) =>
      void calls.push(`roles:${id}:${roles.join(',')}`),
    deleteZone: async (id) => void calls.push(`deleteZone:${id}`),
    regenerateJoinCode: async (id) => {
      calls.push(`joinCode:${id}`);
      return 'NEWC0DE1';
    },
    transferOwnership: async (zone, membership) =>
      void calls.push(`transfer:${zone}:${membership}`),
    kickMember: async (zone, membership) =>
      void calls.push(`kick:${zone}:${membership}`),
    banMember: async (zone, membership) =>
      void calls.push(`ban:${zone}:${membership}`),
    setZoneDeletionMark: async (zone, marked) =>
      void calls.push(`mark:${zone}:${marked}`),
    approveMember: async (zone, membership) =>
      void calls.push(`approve:${zone}:${membership}`),
    rejectMember: async (zone, membership) =>
      void calls.push(`reject:${zone}:${membership}`),
    setLineApproval: async (list, line, status) =>
      void calls.push(`line:${list}:${line}:${status}`),
  };

  return { calls, directory };
}

/** Mount the section and go to an address inside it. */
export async function bootShoppers(
  url: string,
  providers: readonly Provider[] = [],
  /** Sections beside this one, for a spec about a link that leaves it. */
  others: readonly AdminSection[] = []
): Promise<ComponentFixture<ShoppersTestHost>> {
  // The split view puts the page back at its top when a row opens over the
  // list, and jsdom has no page to scroll: it logs an error on every call.
  window.scrollTo = () => undefined;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ShoppersTestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([SHOPPERS_TEST_SECTION, ...others])),
      provideLocationMocks(),
      provideSections(SHOPPERS_TEST_SECTION, ...others),
      SessionStorage,
      SessionStore,
      DeploymentStore,
      ...providers,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShoppersTestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);

  return fixture;
}

/**
 * Lets a read settle, then redraws.
 *
 * A macrotask and not a handful of `Promise.resolve()`s, because a read goes
 * through several awaits and counting them would make a spec depend on how
 * many. `whenStable` is not an option in a zoneless spec: it hangs.
 */
export async function settle(
  fixture: ComponentFixture<unknown>
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

/** Where the router is, as the address bar would show it. */
export function currentUrl(): string {
  return TestBed.inject(Router).url;
}

export const textOf = (fixture: ComponentFixture<unknown>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

/** The first element matching a selector, or `null`. */
export function find<T extends HTMLElement = HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string
): T | null {
  return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
}

/** Every element matching a selector. */
export function findAll<T extends HTMLElement = HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string
): T[] {
  return [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<T>(selector),
  ];
}

/** The button or link whose text is exactly this. */
export function controlSaying(
  fixture: ComponentFixture<unknown>,
  label: string
): HTMLElement | undefined {
  return findAll(fixture, 'button, a').find(
    (control) => control.textContent?.trim() === label
  );
}
