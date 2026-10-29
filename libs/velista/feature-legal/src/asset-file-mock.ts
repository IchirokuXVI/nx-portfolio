// Stub for static asset imports (svg, avif, png, pdf, …) in Jest.
// Bundlers resolve these to a URL string at build time; tests only need a value.
//
// This library renders `ui` components that inline their icons with `?raw`, so it
// needs the same mapping even though it imports no asset of its own.
export default 'asset-file-stub';
