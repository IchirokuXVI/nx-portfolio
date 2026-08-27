// Stub for static asset imports (svg, avif, png, fonts, video, …) in Jest.
// Bundlers resolve these to a URL string at build time; tests only need a value.
//
// The app needs its own copy because `translation-providers.ts` imports
// `@portfolio/damoclesSword/ui` for the translation descriptor, and that pulls the
// library's barrel, which reaches components that import SVGs. The library's jest
// config has mapped these all along; the app's had never needed to.
export default 'asset-file-stub';
