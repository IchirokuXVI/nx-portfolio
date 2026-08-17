import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { RokuLocaleStore } from './roku-locale-store';

/**
 * Attach the active locale to every outgoing request as `Accept-Language`, so the
 * server can return locale-dependent data without any service method threading a
 * locale argument. This is the transport half of locale-aware data access; the
 * refetch half (re-running a query when the locale changes) is `withLocale` /
 * `refetchOnLocaleChange`.
 *
 * Register once where HttpClient is provided:
 * `provideHttpClient(withInterceptors([localeHeaderInterceptor]))`.
 */
export const localeHeaderInterceptor: HttpInterceptorFn = (req, next) => {
  const locale = inject(RokuLocaleStore).getLocale();
  return next(req.clone({ setHeaders: { 'Accept-Language': locale } }));
};
