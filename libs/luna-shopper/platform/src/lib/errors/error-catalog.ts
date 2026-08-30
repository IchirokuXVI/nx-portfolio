import { DEFAULT_LOCALE, type SupportedLocale } from '../localization/locale';
import { ERROR_CODES, type ErrorCode } from './error-codes';

/**
 * The error catalog (plan 0004, sections 2 and 12).
 *
 * Maps each stable error code to a user readable message in every supported
 * locale (English and Spanish at minimum, more later). The exception filter looks
 * a message up here so the house envelope's `message` is already translated to the
 * request locale, and the frontend never has to know backend error codes to show
 * something readable.
 *
 * Messages may contain `{name}` style placeholders filled from a domain
 * exception's `messageArgs`.
 */
export const ERROR_CATALOG: Record<
  ErrorCode,
  Record<SupportedLocale, string>
> = {
  [ERROR_CODES.VALIDATION_FAILED]: {
    en: 'Some of the submitted values are invalid.',
    es: 'Algunos de los valores enviados no son válidos.',
  },
  [ERROR_CODES.UNAUTHORIZED]: {
    en: 'You need to sign in to do that.',
    es: 'Necesitas iniciar sesión para hacer eso.',
  },
  [ERROR_CODES.FORBIDDEN]: {
    en: 'You do not have permission to do that.',
    es: 'No tienes permiso para hacer eso.',
  },
  [ERROR_CODES.NOT_FOUND]: {
    en: 'The requested resource was not found.',
    es: 'No se encontró el recurso solicitado.',
  },
  [ERROR_CODES.CONFLICT]: {
    en: 'That request conflicts with the current state.',
    es: 'Esa solicitud entra en conflicto con el estado actual.',
  },
  [ERROR_CODES.RATE_LIMITED]: {
    en: 'Too many requests. Please slow down and try again shortly.',
    es: 'Demasiadas solicitudes. Reduce el ritmo e inténtalo de nuevo en breve.',
  },
  // Phrased as a statement about the deployment rather than about the caller,
  // because the caller did nothing wrong (plan 0026, section 3.1).
  [ERROR_CODES.NOT_CONFIGURED]: {
    en: 'That sign in method is not available on this server.',
    es: 'Ese método de inicio de sesión no está disponible en este servidor.',
  },
  // Phrased as something that is being fixed rather than something to go and do,
  // because in the normal case the client has already started updating itself by
  // the time this is on screen (velista plan 0034, D9).
  [ERROR_CODES.CLIENT_TOO_OLD]: {
    en: 'This version of the app is out of date. It is updating itself now.',
    es: 'Esta versión de la aplicación está obsoleta. Se está actualizando ahora.',
  },
  [ERROR_CODES.INTERNAL]: {
    en: 'Something went wrong on our side. Please try again.',
    es: 'Algo salió mal de nuestro lado. Inténtalo de nuevo.',
  },
};

/** Substitutes `{key}` placeholders from `args`, leaving unknown ones intact. */
function interpolate(
  template: string,
  args?: Record<string, string | number>
): string {
  if (!args) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in args ? String(args[key]) : match
  );
}

/**
 * Resolves the localized message for a code, falling back to the default locale
 * when the requested one is missing, then interpolating any message arguments.
 */
export function resolveErrorMessage(
  code: ErrorCode,
  locale: SupportedLocale = DEFAULT_LOCALE,
  args?: Record<string, string | number>
): string {
  const byLocale = ERROR_CATALOG[code] ?? ERROR_CATALOG[ERROR_CODES.INTERNAL];
  const template = byLocale[locale] ?? byLocale[DEFAULT_LOCALE];
  return interpolate(template, args);
}
