// ============================================================================
// Console page assembly — injects the CSS + client script (real files under
// assets/, bundled as text) into the HTML shell at their placeholders. Assembled
// once at module load so each request just serves the cached string.
// ============================================================================

// Real, standalone asset files. The CSS/JS carry a `.txt` suffix so the bundler
// ships them verbatim as strings — esbuild's built-in .css/.js loaders would
// otherwise process them and can't be overridden. `.html`/`.txt` are Text by
// wrangler default, so no custom bundler rule is needed. See wrangler.toml.
import shell from './assets/shell.html';
import styles from './assets/styles.css.txt';
import client from './assets/client.js.txt';

// Function replacers avoid `$`-token interpretation of String.prototype.replace.
const PAGE = shell.replace('__STYLES__', () => styles).replace('__CLIENT__', () => client);

/** The full, ready-to-serve console HTML document. */
export function renderConsolePage(): string {
  return PAGE;
}
