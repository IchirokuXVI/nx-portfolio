import { Directive } from '@angular/core';

/**
 * Marks the routed content projected into `<lib-damoclesSword-layout>`.
 *
 * The layout renders this template only after translations have loaded, so
 * routed components — and their pure translate pipes — are never instantiated
 * before their translations are available.
 *
 * Usage:
 * ```html
 * <lib-damoclesSword-layout>
 *   <ng-template libDamoclesSwordLayoutContent>
 *     <router-outlet></router-outlet>
 *   </ng-template>
 * </lib-damoclesSword-layout>
 * ```
 */
@Directive({
  selector: 'ng-template[libDamoclesSwordLayoutContent]',
})
export class LayoutContent {}
