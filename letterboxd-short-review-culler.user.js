// ==UserScript==
// @name         Letterboxd Short Review Culler
// @namespace    https://github.com/stalkerhumanoid
// @version      2.0.2
// @author       @stalkerhumanoid
// @license      MIT
// @description  Hides short, low-effort reviews on Letterboxd (default: under 150 characters)
// @homepageURL  https://github.com/stalkerhumanoid/web-userscripts
// @supportURL   https://github.com/stalkerhumanoid/web-userscripts/issues
// @match        *://*.letterboxd.com/film/*
// @exlcude      *://letterboxd.com/activity/*
// @exlcude      *://letterboxd.com/*/film/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL https://update.greasyfork.org/scripts/439029/Letterboxd%20Short%20Review%20Culler.user.js
// @updateURL https://update.greasyfork.org/scripts/439029/Letterboxd%20Short%20Review%20Culler.meta.js
// ==/UserScript==

(() => {
    'use strict';

    const DEFAULT_MINIMUM = 150;
    const MINIMUM_KEY = 'characterMinimum';
    const DEBUG_KEY = 'debug';

    // Current Letterboxd markup first, pre-redesign names last. The old names are kept because the
    // /film/<slug>/reviews/ and member /films/reviews/ pages could not be verified, and may still
    // serve them.
    //
    // Note what is absent: .body-text on its own. It survived the redesign but is no longer
    // review-specific — the same class wraps the film synopsis and the promo banners — so it is only
    // ever reached via an entry, where those cannot match.
    const ENTRY_SELECTOR = '.js-production-viewing, .production-viewing, .film-detail';
    const WRAPPER_SELECTOR = '.js-listitem, .listitem';
    const BODY_SELECTOR = '.js-review-body, .film-detail-content .body-text';

    // Reviews inside the popular/friends reviews block at the top of the film page are left alone —
    // culling there would gut the page's main draw.
    //
    // Two selectors on purpose, because the two failure modes are complementary. The `js-popular*`
    // class is Letterboxd's own JS hook and is stable against the section moving around the page,
    // but could be renamed. `:nth-child(1)` survives a class rename, but only holds while the section
    // stays the first child of its parent. Whichever one Letterboxd breaks, the other should catch
    // it. The class match is deliberately a substring so a rename to e.g. `js-popular-reviews` or
    // `js-popular-friend-reviews` both continue to match.
    const EXEMPT_SELECTOR = [
        'section.film-reviews[class*="js-popular"]',
        'section.film-reviews:nth-child(1)',
    ].join(', ');

    const HIDDEN_ATTR = 'data-lsrc-hidden';

    const hasStorage = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

    let characterMinimum = hasStorage ? GM_getValue(MINIMUM_KEY, DEFAULT_MINIMUM) : DEFAULT_MINIMUM;
    if (!Number.isInteger(characterMinimum) || characterMinimum < 0) characterMinimum = DEFAULT_MINIMUM;

    let debug = hasStorage ? GM_getValue(DEBUG_KEY, false) === true : false;

    function log(...args) {
        if (debug) console.log('[Short Review Culler]', ...args);
    }

    // No-op without storage, so the menu still works for the session on a manager that offers menu
    // commands but not persistence.
    function save(key, value) {
        if (hasStorage) GM_setValue(key, value);
    }

    // Returns the review's length in characters, or null if this entry has no measurable body.
    function measure(entry) {
        const body = entry.querySelector(BODY_SELECTOR);
        if (!body) return null;

        // textContent carries the markup's own indentation and newlines, which would otherwise count.
        const text = body.textContent.replace(/\s+/g, ' ').trim();
        if (!text) return null;

        // Count code points, not UTF-16 units, so emoji don't each count double.
        return Array.from(text).length;
    }

    // Returns true if the entry ended up hidden.
    function cull(entry) {
        // Skip exempt sections before we even measure. closest() walks up from the entry, so this
        // catches the entry wherever it sits inside the section, not just as a direct child.
        if (entry.closest(EXEMPT_SELECTOR)) return false;

        const length = measure(entry);

        // Fail open. An entry we cannot measure is one we do not understand — a rating-only diary
        // entry, or markup that has changed under us — and hiding it would be a guess.
        if (length === null) return false;

        // Hide the row wrapper rather than the entry itself: the wrapper carries the row's spacing and
        // separator, so hiding only the inner article leaves a visible gap. Checking the direct parent
        // rather than closest() keeps this tight — closest() walks up arbitrarily far, and could match
        // a wrapper enclosing several entries and take them all with it.
        const parent = entry.parentElement;
        const target = parent?.matches(WRAPPER_SELECTOR) ? parent : entry;
        return target.toggleAttribute(HIDDEN_ATTR, length < characterMinimum);
    }

    // Every entry is reconsidered each time, so lowering the minimum brings reviews back without a
    // reload. The page holds a dozen or so entries, which is far too few to be worth tracking
    // incrementally. The found count is logged because it is the signal that matters if Letterboxd
    // changes its markup again: entries=0 means the selectors need updating.
    function sweep(reason) {
        const entries = document.querySelectorAll(ENTRY_SELECTOR);
        let hidden = 0;
        for (const entry of entries) {
            if (cull(entry)) hidden++;
        }
        log(`${reason}: ${hidden}/${entries.length} hidden, minimum ${characterMinimum}`);
    }

    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand('Set minimum review length…', () => {
            const answer = prompt('Hide reviews shorter than how many characters?', characterMinimum);
            if (answer === null) return;

            const parsed = Number(answer.trim());
            if (!Number.isInteger(parsed) || parsed < 0) {
                alert('Please enter a whole number of characters (0 or more).');
                return;
            }

            characterMinimum = parsed;
            save(MINIMUM_KEY, parsed);
            sweep('minimum changed');
        });

        GM_registerMenuCommand('Toggle debug logging', () => {
            debug = !debug;
            save(DEBUG_KEY, debug);
            sweep('debug toggled');
            alert(`Debug logging ${debug ? 'enabled' : 'disabled'}.`);
        });
    }

    const style = document.createElement('style');
    style.textContent = `[${HIDDEN_ATTR}] { display: none !important; }`;
    (document.head || document.documentElement).append(style);

    // Letterboxd keeps injecting review sections after load (its /csi/ endpoints, pagination), which a
    // fixed timeout could never keep up with.
    //
    // The sweep runs synchronously in the observer callback, and that placement is doing real work:
    // MutationObserver callbacks are microtasks, so they run before the next render, and an entry is
    // hidden before it can flash on screen. The throttle then stops a page full of unrelated DOM churn
    // (lazy images, tooltips) from causing a sweep per batch, and the trailing sweep picks up whatever
    // landed inside the throttle window.
    let throttle = 0;
    new MutationObserver(() => {
        if (throttle) return;
        sweep('mutation');
        throttle = setTimeout(() => {
            throttle = 0;
            sweep('settled');
        }, 100);
    }).observe(document.documentElement, { childList: true, subtree: true });

    registerMenu();
    sweep('start');
})();
