import { Directive } from '@angular/core';

/**
 * Marks the routed content projected into `<lib-damocles-sword-layout>`.
 *
 * The layout renders this template only after translations have loaded, so
 * routed components — and their pure translate pipes — are never instantiated
 * before their translations are available.
 *
 * Usage:
 * ```html
 * <lib-damocles-sword-layout>
 *   <ng-template libDamoclesSwordLayoutContent>
 *     <router-outlet></router-outlet>
 *   </ng-template>
 * </lib-damocles-sword-layout>
 * ```
 */
@Directive({
  selector: 'ng-template[libDamoclesSwordLayoutContent]',
})
export class LayoutContent {}
