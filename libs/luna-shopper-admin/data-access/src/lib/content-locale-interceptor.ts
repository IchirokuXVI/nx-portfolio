import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ApiUrl } from './api-url';
import { ContentLocaleStore } from './content-locale-store';

/**
 * Says which language the operator reads on every gateway request (admin plan
 * 0026, section 4).
 *
 * Until this, the back office sent no `Accept-Language` at all, so the gateway's
 * `resolveLocale` fell through to `DEFAULT_LOCALE` and every server message came
 * back in English. That was never a decision about content: it was two defaults
 * agreeing. With the header on the request, every refusal and every validation
 * detail comes back in the language the operator chose, and once backend plan
 * `0111` lands the catalog listings are ordered in it as well.
 *
 * A bare locale code, with no q weighting and no region. The backend parses a
 * full `Accept-Language` list and keeps only the primary subtag, so `en` is the
 * simplest input it accepts, and velista's interceptor sends the same shape.
 *
 * **The `isGateway` guard is not optional**, and it is the reason this is a
 * third interceptor rather than a line inside one of the other two: the rule
 * that nothing sends a header to a URL that is not the gateway is stated in
 * `clientVersionInterceptor` and holds here for the same reason.
 *
 * Third, after the token and the version, so the request it clones already
 * carries both.
 */
export const contentLocaleInterceptor: HttpInterceptorFn = (req, next) => {
  const urls = inject(ApiUrl);
  if (!urls.isGateway(req.url)) {
    return next(req);
  }

  const locale = inject(ContentLocaleStore).locale();
  return next(req.clone({ setHeaders: { 'Accept-Language': locale } }));
};
