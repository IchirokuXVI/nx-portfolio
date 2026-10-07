import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  InjectionToken,
  input,
  output,
  signal,
  viewChild,
  type Signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { InfoContent } from '@portfolio/luna-shopper-admin/models';
import { ChevronLeftIcon, MoreIcon } from '@portfolio/shared/ui';
import { InfoButton } from '../info/info-button';
import { Viewport } from '../viewport';
import { PAGE_FRAME_TABS, PageTabs, type PageTab } from './page-tabs';
import { PopoverSheet } from './popover-sheet';

/** What the More menu moves the focus between. */
const MENU_ITEMS = 'button:not(:disabled), a[href]';

/**
 * Whether a header drawn here is the page's own, or sits under one (admin plan
 * 0042).
 *
 * A page has one `h1`. On a wide screen a shop is open beside its chain's shop
 * list and under the chain's header, so the chain's name is the `h1` and the
 * shop's is an `h2`. On a phone the shop is the whole page and its name is the
 * `h1`. The pane that holds the page knows which, and says so here.
 *
 * Absent means 1, which is every page that is not inside another.
 */
export const PAGE_HEADING_LEVEL = new InjectionToken<Signal<1 | 2>>(
  'PAGE_HEADING_LEVEL'
);

/**
 * The one header every page has (admin plan 0041, section 3).
 *
 * 52 px high on a wide screen and 48 px on a phone: an optional way back, the
 * title, an optional second line, state chips, the info button and at most two
 * actions. It replaced two rows of links that reserved about 180 px before the
 * first row of data.
 *
 * It does not stick. On a phone the only fixed thing is the bar at the bottom,
 * and on a wide screen nothing is fixed at all.
 *
 * ## What a page hands it
 *
 * ```html
 * <lib-page-header
 *   (back)="leave()"
 *   [backLabel]="backLabel()"
 *   [heading]="name()"
 *   [info]="descriptor.info ?? null"
 *   [subtitle]="'Owner marta, 4 members'"
 * >
 *   <span pageChip class="chip">Fetched by the harvester</span>
 *   <button pageAction type="button">Edit chain</button>
 *   <button pageMoreAction type="button">Delete</button>
 * </lib-page-header>
 * ```
 *
 * - `pageChip`: the state of the thing the page is about.
 * - `pageAction`: the first action, always in the row.
 * - `pageMoreAction`: the second and later actions. In the row on a wide screen,
 *   and inside a "More actions" menu on a phone, where two buttons beside a
 *   title leave no room for the title.
 * - `pageMoreDanger`: the actions that destroy. They come after the others,
 *   and in a menu they are under a line and in red.
 *
 * ## The More menu
 *
 * `overflow="menu"` puts every `pageMoreAction` and `pageMoreDanger` in the
 * menu at every width (admin plan 0053, section 2.4). The record page uses
 * it, so that its header keeps to "Edit" and one button. The menu is a panel
 * under the button on a wide screen and a sheet from the bottom on a phone.
 * Arrow Down and Arrow Up move and wrap, Escape closes and gives the focus
 * back to the button, and a press outside closes. The header gives each
 * button in the menu the role `menuitem`, so a page cannot forget it.
 *
 * It sits at the top of the page and reaches the edges of the main column by
 * itself, so put it first in the template and outside any element that has
 * padding or a width of its own.
 *
 * ## The tabs under it
 *
 * Until each section has a page of its own (admin plans 0042 to 0044), the
 * frame's tabs are drawn here, under every header, from {@link PAGE_FRAME_TABS}.
 *
 * A page with tabs of its own hands them to `[tabs]`, with `[tabsLabel]` as
 * their name for a screen reader. They take the place of the frame's tabs and
 * sit flush under the header, with no gap of the page's own between the two. A
 * sibling `lib-page-tabs` under `[frameTabs]="false"` still works, and sits
 * as far below the header as the page spaces its children.
 *
 * ## On a phone
 *
 * The row never wraps, so the header stays 48 px. The title keeps the room:
 * it shrinks last, and a chip shrinks first, to an ellipsis.
 */
@Component({
  selector: 'lib-page-header',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    RokuTranslatorPipe,
    InfoButton,
    PageTabs,
    PopoverSheet,
    ChevronLeftIcon,
    MoreIcon,
  ],
  template: `
    <header [class.compact]="compact()" class="page-head">
      @if (backLabel(); as label) {
        @if (backLink(); as link) {
          <a [attr.aria-label]="label" [routerLink]="link" class="page-back">
            <lib-chevron-left-icon />
          </a>
        } @else {
          <button
            (click)="back.emit()"
            [attr.aria-label]="label"
            [disabled]="backDisabled()"
            class="page-back"
            type="button"
          >
            <lib-chevron-left-icon />
          </button>
        }
      }

      <div [class.pending]="loading()" class="page-titles">
        <!-- While the name is on its way a grey bar stands in for it. The
             words are still in the heading, so a screen reader hears what
             is loading and not a silence. -->
        @if (level() === 2) {
          <h2 class="page-title">{{ heading() }}</h2>
        } @else {
          <h1 class="page-title">{{ heading() }}</h1>
        }
        @if (subtitle(); as text) {
          <p class="page-subtitle">{{ text }}</p>
        }
      </div>

      <div class="page-chips"><ng-content select="[pageChip]" /></div>

      <span class="page-grow"></span>

      @if (info(); as content) {
        <lib-info-button [info]="content" />
      }

      <div class="page-actions"><ng-content select="[pageAction]" /></div>

      <div class="page-overflow">
        <!-- Drawn in one place and put in the row, the panel or the sheet. A
             component has one slot of each name, and a second one in another
             branch would take the content away from the first. -->
        <ng-template #more>
          <ng-content select="[pageMoreAction]" />
          <div class="page-more-danger">
            <ng-content select="[pageMoreDanger]" />
          </div>
        </ng-template>

        @if (compact() || menu()) {
          <button
            (click)="toggleMore()"
            [attr.aria-expanded]="moreOpen()"
            [attr.aria-haspopup]="menu() ? 'menu' : null"
            [attr.aria-label]="moreLabel() ?? ('page.moreActions' | rokuT)"
            #moreToggle
            class="page-overflow-toggle"
            type="button"
          >
            <lib-more-icon />
          </button>
        }

        @if (menu() && compact() && moreOpen()) {
          <lib-popover-sheet
            (closed)="closeMore(true)"
            [heading]="moreLabel() ?? ('page.moreActions' | rokuT)"
            [sheet]="true"
          >
            <div class="page-more-items as-menu as-sheet" role="menu">
              <ng-container [ngTemplateOutlet]="more" />
            </div>
          </lib-popover-sheet>
        } @else {
          <div
            [attr.aria-label]="menu() ? moreLabel() : null"
            [attr.role]="menu() ? 'menu' : null"
            [class.as-menu]="menu()"
            [class.open]="moreOpen()"
            [class.page-menu]="compact() || menu()"
            class="page-more-items page-overflow-actions"
          >
            <ng-container [ngTemplateOutlet]="more" />
          </div>
        }
      </div>
    </header>

    @if (shownTabs().length > 0) {
      <lib-page-tabs
        [label]="tabs() === null ? ('shell.screens' | rokuT) : tabsLabel()"
        [tabs]="shownTabs()"
      />
    }
  `,
  host: {
    '(document:click)': 'pressed($event)',
    '(document:keydown.escape)': 'closeMore(true)',
    // The keys of the More menu are heard on the header and not on its list:
    // the sheet takes the focus when it opens, and the sheet is above the
    // list.
    '(keydown)': 'onMenuKeydown($event)',
  },
  styles: `
    /* It reaches the edges of the main column whatever the page lays its own
       content out as: a page that lines its children up at the start would
       otherwise shrink the header to its title. */
    :host {
      display: block;
      align-self: stretch;
      inline-size: 100%;
      margin-block-start: calc(-1 * var(--admin-page-block));
    }

    .page-head {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      min-block-size: 3.25rem;
      margin-inline: calc(-1 * var(--admin-page-inline));
      padding-inline: var(--admin-page-inline);
      border-block-end: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    .page-head.compact {
      gap: var(--admin-space-1);
      min-block-size: 3rem;
      padding-inline-end: var(--admin-space-2);
    }

    .page-titles {
      display: flex;
      gap: var(--admin-space-3);
      align-items: baseline;
      min-inline-size: 0;
    }

    /* On a phone the title takes what the row has left and gives way last: it
       never goes under 5.5rem, which is a short name in full and a long one to
       its first word. */
    .compact .page-titles {
      flex: 1 1 0;
      flex-direction: column;
      gap: 0;
      align-items: stretch;
      min-inline-size: 5.5rem;
    }

    .page-title {
      overflow: hidden;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .compact .page-title {
      font-size: 1.0625rem;
      letter-spacing: 0;
    }

    /* The bar is the heading itself with its ink taken away, so the words
       stay where a screen reader finds them. */
    .pending .page-title {
      inline-size: 11rem;
      max-inline-size: 100%;
      block-size: 0.875rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      text-overflow: clip;
      color: transparent;
      user-select: none;
    }

    /* A header under another one is the title of a pane and not of the page,
       so it is a step smaller than the header above it. */
    h2.page-title {
      font-size: 1.0625rem;
      letter-spacing: 0;
    }

    .page-subtitle {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--admin-ink-muted);
    }

    .compact .page-subtitle {
      font-size: 0.75rem;
      line-height: 1.2;
    }

    .page-chips,
    .page-actions,
    .page-overflow-actions {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
    }

    /* A chip never wraps, on any screen: a second line would make the header
       taller on some pages and not on others. The chip belongs to the page and
       not to this component, so the rule has to reach through to it. */
    :host ::ng-deep [pageChip] {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* On a phone the chips give way before the title does. */
    .compact .page-chips {
      flex: 0 1 auto;
      min-inline-size: 0;
      max-inline-size: 40%;
      overflow: hidden;
    }

    .compact .page-grow {
      display: none;
    }

    .compact .page-actions,
    .compact .page-overflow,
    .compact lib-info-button {
      flex: none;
    }

    /* The wrapper of the actions that destroy is always there, so it is the
       wrapper's own content that counts. */
    .page-chips:empty,
    .page-actions:empty,
    .page-overflow:not(
      :has(.page-more-items > :not(.page-more-danger), .page-more-danger > *)
    ) {
      display: none;
    }

    /* In the row the actions that destroy are buttons like the others. */
    .page-more-danger {
      display: contents;
    }

    .page-grow {
      flex: 1;
    }

    .page-back,
    .page-overflow-toggle {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      inline-size: var(--admin-control);
      min-block-size: var(--admin-control);
      margin-inline-start: calc(-1 * var(--admin-space-2));
      padding: 0.5rem;
      border: none;
      border-radius: var(--admin-radius-control);
      background: none;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .page-overflow-toggle {
      margin-inline-start: 0;
    }

    /* An icon takes the size of the box it is put in, and a button has no size
       to give: without this the drawing falls back to the 150 px an image with
       no dimensions is given, and the header grows to hold it. */
    .page-back > *,
    .page-overflow-toggle > * {
      inline-size: 1.25rem;
      block-size: 1.25rem;
    }

    .compact .page-back,
    .page-overflow-toggle {
      padding: 0.75rem;
    }

    .page-back:focus-visible,
    .page-overflow-toggle:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }

    .page-overflow {
      position: relative;
      display: flex;
    }

    /* On a phone the second and later actions are a menu under the toggle. They
       stay in the document while it is closed, so that the page's own bindings
       on them keep working, and are taken out of the tab order by not being
       displayed. */
    .page-overflow-actions.page-menu {
      position: absolute;
      z-index: 20;
      inset-block-start: 100%;
      inset-inline-end: var(--admin-space-1);
      display: none;
      flex-direction: column;
      align-items: stretch;
      min-inline-size: 12rem;
      padding: var(--admin-space-2);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      box-shadow: 0 0.5rem 1.5rem rgb(20 33 29 / 16%);
    }

    .page-overflow-actions.page-menu.open {
      display: flex;
    }

    /* The More menu (admin plan 0053, section 2.4): 264 px under the button,
       one entry for each row, and the actions that destroy under a line. */
    .page-overflow-actions.as-menu {
      gap: 0;
      inline-size: 16.5rem;
      padding: 0.375rem;
      border-color: var(--admin-border-strong);
      border-radius: 0.5rem;
    }

    .as-menu.as-sheet {
      display: flex;
      flex-direction: column;
      padding: var(--admin-space-2);
    }

    .as-menu .page-more-danger {
      display: flex;
      flex-direction: column;
    }

    /* The line parts them from the entries above, so it needs one above. */
    .as-menu > * ~ .page-more-danger:not(:empty) {
      margin-block-start: 0.375rem;
      padding-block-start: 0.375rem;
      border-block-start: 1px solid var(--admin-border);
    }

    /* The entries belong to the page and not to this component, so the rules
       have to reach through to them. */
    :host ::ng-deep .as-menu button,
    :host ::ng-deep .as-menu a {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      inline-size: 100%;
      min-block-size: 2.25rem;
      padding: 0 0.625rem;
      border: none;
      border-radius: var(--admin-radius-control);
      background: none;
      font-weight: 400;
      text-align: start;
      text-decoration: none;
      color: var(--admin-ink);
      cursor: pointer;
    }

    :host ::ng-deep .as-menu.as-sheet button,
    :host ::ng-deep .as-menu.as-sheet a {
      min-block-size: 3rem;
    }

    :host ::ng-deep .as-menu button:hover,
    :host ::ng-deep .as-menu a:hover,
    :host ::ng-deep .as-menu button:focus-visible,
    :host ::ng-deep .as-menu a:focus-visible {
      background: var(--admin-neutral-wash);
    }

    :host ::ng-deep .as-menu button:focus-visible,
    :host ::ng-deep .as-menu a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }

    :host ::ng-deep .as-menu button:disabled {
      color: var(--admin-ink-muted);
      cursor: default;
    }

    :host ::ng-deep .as-menu .page-more-danger button,
    :host ::ng-deep .as-menu .page-more-danger a {
      color: var(--admin-danger);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeader {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _viewport = inject(Viewport);
  private readonly _frameTabs = inject(PAGE_FRAME_TABS, { optional: true });
  private readonly _level = inject(PAGE_HEADING_LEVEL, { optional: true });

  /** 1 for the page's own header, 2 for one that sits under it. */
  readonly level = computed<1 | 2>(() => this._level?.() ?? 1);
  private readonly _moreToggle =
    viewChild<ElementRef<HTMLButtonElement>>('moreToggle');

  /** The title, already translated. */
  readonly heading = input.required<string>();
  /**
   * Whether the title is still on its way (admin plan 0053, section 4). A
   * grey bar is drawn in its place, and {@link heading} is what a screen
   * reader hears: "Loading the brand".
   */
  readonly loading = input(false);
  /**
   * A second line, already translated: what the row is called on a form, or
   * who owns a zone. Beside the title on a wide screen, under it on a phone.
   */
  readonly subtitle = input<string | null>(null);
  /**
   * What the way back is called, already translated. No way back is drawn
   * without it.
   */
  readonly backLabel = input<string | null>(null);
  /**
   * Where the way back goes, as router commands or a URL.
   *
   * Without it the control is a button and {@link back} says it was pressed,
   * for a page that works out where to go when asked.
   */
  readonly backLink = input<string | readonly unknown[] | null>(null);
  /**
   * Whether the way back is off for now: a form that is being saved, where
   * leaving would walk away from a write in flight. Only the button form has a
   * disabled state, so a page that sets this gives no {@link backLink}.
   */
  readonly backDisabled = input(false);
  /** What the info button says. No button is drawn without it. */
  readonly info = input<InfoContent | null>(null);
  /**
   * Whether the frame's tabs are drawn under the header.
   *
   * On by default. A page with tabs of its own turns it off and draws
   * `lib-page-tabs` itself.
   */
  readonly frameTabs = input(true);
  /**
   * The page's own tabs, drawn flush under the header.
   *
   * Given, they take the place of the frame's tabs, whatever {@link frameTabs}
   * says. `null`, which is the default, leaves the frame's tabs in place.
   */
  readonly tabs = input<readonly PageTab[] | null>(null);
  /** What the page's own tabs are, already translated, for a screen reader. */
  readonly tabsLabel = input('');

  /**
   * Where the second and later actions are.
   *
   * `'row'` is the row on a wide screen and a menu on a phone. `'menu'` puts
   * every `pageMoreAction` in the More menu at every width.
   */
  readonly overflow = input<'row' | 'menu'>('row');
  /**
   * The accessible name of the button of the menu, already translated: "More
   * actions for Hacendado". `null` says "More actions".
   */
  readonly moreLabel = input<string | null>(null);

  /** The way back was pressed, and no {@link backLink} was given. */
  readonly back = output<void>();

  readonly compact = this._viewport.compact;

  readonly moreOpen = signal(false);

  /** Whether every later action is in the More menu, at every width. */
  readonly menu = computed(() => this.overflow() === 'menu');

  constructor() {
    // An open menu says what its entries are, and the keyboard starts on the
    // first one. After the render, because the render is what puts the
    // entries in the panel or the sheet.
    afterRenderEffect(() => {
      if (!this.menu() || !this.moreOpen()) {
        return;
      }
      const items = this._menuItems();
      for (const item of items) {
        item.setAttribute('role', 'menuitem');
      }
      items[0]?.focus();
    });
  }

  /** The tabs under the header: the page's own, or else the frame's. */
  readonly shownTabs = computed<readonly PageTab[]>(
    () => this.tabs() ?? (this.frameTabs() ? (this._frameTabs?.() ?? []) : [])
  );

  toggleMore(): void {
    this.moreOpen.update((open) => !open);
  }

  /**
   * Close the "More actions" menu.
   *
   * `refocus` gives the focus back to the toggle. That is right for Escape,
   * and for an action chosen from the menu, whose button has just been taken
   * off the screen. It is wrong for a press somewhere else on the page: the
   * operator pressed that other thing, and the focus belongs to it.
   */
  closeMore(refocus = false): void {
    if (!this.moreOpen()) {
      return;
    }

    this.moreOpen.set(false);

    if (refocus) {
      this._moreToggle()?.nativeElement.focus();
    }
  }

  /**
   * A press somewhere in the document, while the menu is open.
   *
   * Anywhere but the toggle closes it: outside the menu, or on one of the
   * actions, whose own handler ran before the press reached the document. The
   * toggle opens and closes the menu by itself.
   */
  pressed(event: Event): void {
    const target = event.target;

    if (!this.moreOpen() || !(target instanceof Element)) {
      return;
    }

    if (this._moreToggle()?.nativeElement.contains(target) === true) {
      return;
    }

    const menu = this._host.nativeElement.querySelector('.page-more-items');
    const inside = menu?.contains(target) === true;
    // The sheet has a scrim over the page and says by itself that it was
    // pressed. A press on its heading is a press on no entry.
    if (this.menu() && this.compact() && !inside) {
      return;
    }
    this.closeMore(inside);
  }

  /** Arrow Down and Arrow Up move through the menu and wrap. */
  onMenuKeydown(event: KeyboardEvent): void {
    if (!this.menu() || !this.moreOpen()) {
      return;
    }

    const items = this._menuItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = at + 1 >= items.length ? 0 : at + 1;
        break;
      case 'ArrowUp':
        next = at <= 0 ? items.length - 1 : at - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    items[next]?.focus();
  }

  private _menuItems(): HTMLElement[] {
    const list = this._host.nativeElement.querySelector('.page-more-items');
    return list === null
      ? []
      : Array.from(list.querySelectorAll<HTMLElement>(MENU_ITEMS));
  }
}
