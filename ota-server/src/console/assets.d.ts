// Text-module imports (wrangler `Text` rule → esbuild `text` loader). These
// asset files are bundled verbatim as strings, so the worker keeps needing no
// separate frontend build/asset pipeline while the source stays as real files.
declare module '*.html' {
  const content: string;
  export default content;
}
declare module '*.txt' {
  const content: string;
  export default content;
}
