# web-userscripts

Personal userscripts. One self-contained `*.user.js` file per script, at the repo root, installed
straight into a userscript manager (primarily Violentmonkey).

No build step, no bundler, no dependencies, no framework. Nothing here should ever need `npm install`.

## KISS is the point

A userscript is a small, direct tweak to someone else's page. If a script needs real architecture, it
should be a browser extension instead — not a userscript quietly growing into one.

The bar for adding anything:

- **Prefer the boring approach.** A plain `querySelectorAll` and a `for` loop is usually the answer.
- **Add machinery only against a problem you have actually observed**, never a hypothetical one.
- **Count the elements before optimising a scan.** These pages hold dozens of items, not thousands.

Worked example, from `letterboxd-short-review-culler.user.js`. It once carried a mutation scheduler: a
pending-node `Set`, a dedupe pass, and a `requestAnimationFrame` raced against a `setTimeout` — all so
it wouldn't have to re-scan the page. The page has twelve review entries. Replacing the whole apparatus
with "re-scan everything, throttled" cut ~70 lines and was *more* correct, because deleting the
incremental tracking also deleted the bug where an entry whose body streamed in late was never
reconsidered.

Complexity that exists to avoid cheap work is not an optimisation. It is just more surface to be wrong on.

## Conventions

- **The filename must end in `.user.js`.** Every manager keys one-click install off that suffix; without
  it the raw GitHub URL just renders as text.
- Metadata block: `@name @namespace @version @author @license @description @match @run-at @grant`, plus
  `@downloadURL`/`@updateURL` pointing at the raw GitHub file. **Bump `@version` on every change** or
  installed copies will never update.
- `@grant` exactly what the script uses and nothing more; `@grant none` when it uses nothing.
- Wrap the body in an IIFE with `'use strict'`.
- Feature-detect optional manager APIs with `typeof GM_x === 'function'` — a bare reference to an
  ungranted or unsupported one throws `ReferenceError`.
- **Fail open.** When the page's markup isn't what the script expects, do nothing rather than guess.
  Sites redesign without warning, and a script that hides the wrong element is far worse than one that
  hides nothing. Log a found-count so a silent failure is diagnosable.
- Keep site-specific knowledge — why *these* selectors, what else on the page reuses that class — in
  comments next to the selectors, not in this file.

## Testing

Userscripts are only really testable in a browser. Helium is installed locally.

- **Use `helium-browser --headless=new --dump-dom <url>`.** Plain `--headless` silently returns zero
  bytes, which looks exactly like a site block and will waste your time.
- Sites like Letterboxd return 403 to `curl` and to WebFetch — the browser is the only way in. Deeper
  paths may hit a Cloudflare interstitial even headless, so check for a `Just a moment...` title before
  trusting what you fetched.
- **Test against a saved copy of the real page** with the script injected, not just hand-written
  fixtures. Real markup is what catches problems a fixture can't imagine — for example a class that
  still exists but is now reused by unrelated page furniture, so matching it hides the wrong things.
- `node --check <file>` for syntax.
