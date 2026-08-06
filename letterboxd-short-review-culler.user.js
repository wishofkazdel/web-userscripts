// ==UserScript==
// @name         Letterboxd Short Review Culler
// @namespace    https://github.com/stalkerhumanoid
// @version      2.0.0
// @author       @stalkerhumanoid
// @license      MIT
// @description  Hides short, low-effort reviews on Letterboxd (default: under 150 characters)
// @homepageURL  https://github.com/stalkerhumanoid/web-userscripts
// @supportURL   https://github.com/stalkerhumanoid/web-userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/stalkerhumanoid/web-userscripts/main/letterboxd-short-review-culler.user.js
// @updateURL    https://raw.githubusercontent.com/stalkerhumanoid/web-userscripts/main/letterboxd-short-review-culler.user.js
// @match        *://letterboxd.com/*
// @match        *://*.letterboxd.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
    'use strict';

    const DEBUG = false;

    const DEFAULT_MINIMUM = 150;
    const SETTING_KEY = 'characterMinimum';

    const REVIEW_SELECTOR = '.film-detail';
    const BODY_SELECTOR = '.body-text';
    const SPOILER_SELECTOR = '.contains-spoilers';

    const HIDDEN_ATTR = 'data-lsrc-hidden';

    let characterMinimum = DEFAULT_MINIMUM;

    function log(...args) {
        if (DEBUG) console.log('[Short Review Culler]', ...args);
    }

    // Managers disagree on the storage API: Violentmonkey and Tampermonkey ship the synchronous GM_*
    // functions, Greasemonkey 4+ and Safari's Userscripts expose the promise-based GM.* namespace, and
    // some expose neither. `typeof` guards rather than bare references, since an ungranted GM_getValue
    // is an undeclared identifier. Awaiting covers both shapes; without either, the default stands.
    async function readSetting(key, fallback) {
        if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        if (typeof GM === 'object' && typeof GM?.getValue === 'function') return GM.getValue(key, fallback);
        return fallback;
    }

    async function writeSetting(key, value) {
        if (typeof GM_setValue === 'function') return GM_setValue(key, value);
        if (typeof GM === 'object' && typeof GM?.setValue === 'function') return GM.setValue(key, value);
    }

    function injectStyle() {
        const style = document.createElement('style');
        style.textContent = `[${HIDDEN_ATTR}] { display: none !important; }`;
        (document.head || document.documentElement).append(style);
    }

    // Returns the review's length in characters, or null if this entry has no measurable body yet.
    function measure(entry) {
        const body = entry.querySelector(BODY_SELECTOR);
        if (!body) return null;

        // The spoiler notice is Letterboxd's chrome, not the member's writing, so it must not count
        // towards the length. Clone rather than mutate the live node.
        const copy = body.cloneNode(true);
        copy.querySelectorAll(SPOILER_SELECTOR).forEach(notice => notice.remove());

        const text = copy.textContent.replace(/\s+/g, ' ').trim();
        if (!text) return null;

        // Count code points, not UTF-16 units, so emoji don't each count double.
        return Array.from(text).length;
    }

    function cull(entry) {
        const length = measure(entry);

        // Fail open. An entry we cannot measure is one we do not understand — a rating-only diary
        // entry, a spoiler-masked review, or markup still streaming in — and hiding it would be a
        // guess. Leaving it unmarked lets a later pass reconsider it once its body arrives.
        if (length === null) return false;

        entry.toggleAttribute(HIDDEN_ATTR, length < characterMinimum);
        return true;
    }

    function entriesIn(root) {
        if (typeof root.matches !== 'function') return [];
        if (root.matches(REVIEW_SELECTOR)) return [root];

        const descendants = root.querySelectorAll(REVIEW_SELECTOR);
        if (descendants.length) return descendants;

        // Nothing below: the node may instead be a piece of an entry arriving late — the parser adds
        // a .film-detail empty and streams its body in afterwards, and Letterboxd's async sections do
        // the same. Without walking back up, an entry first seen bodyless would never be reconsidered.
        const ancestor = root.closest(REVIEW_SELECTOR);
        return ancestor ? [ancestor] : [];
    }

    function cullWithin(root) {
        let hidden = 0;
        for (const entry of entriesIn(root)) {
            if (cull(entry) && entry.hasAttribute(HIDDEN_ATTR)) hidden++;
        }
        return hidden;
    }

    // A full sweep reconsiders every entry, including ones already seen, so lowering the threshold
    // brings hidden reviews back without a reload.
    function sweep(reason) {
        const hidden = cullWithin(document.documentElement);
        log(`sweep (${reason}): ${hidden} hidden at minimum ${characterMinimum}`);
    }

    // Letterboxd keeps injecting review sections well after load (its /csi/ endpoints, pagination),
    // which the old fixed 1s timeout could never keep up with. Batch the burst so a section drop costs
    // one pass rather than one per mutation.
    function observe() {
        const pending = new Set();
        let scheduled = false;

        const flush = () => {
            if (!scheduled) return;
            scheduled = false;

            const entries = new Set();
            for (const node of pending) {
                for (const entry of entriesIn(node)) entries.add(entry);
            }
            pending.clear();

            let hidden = 0;
            for (const entry of entries) {
                if (cull(entry) && entry.hasAttribute(HIDDEN_ATTR)) hidden++;
            }
            if (hidden) log(`hid ${hidden} review(s) from mutations`);
        };

        // requestAnimationFrame gives the pre-paint slot, so an entry is hidden before it can flash —
        // but it does not fire in background tabs, and Letterboxd is a site people open in a dozen of
        // them at once. The timer is the floor that guarantees the pass happens either way; whichever
        // arrives first does the work and the other returns immediately.
        const schedule = () => {
            scheduled = true;
            requestAnimationFrame(flush);
            setTimeout(flush, 50);
        };

        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) pending.add(node);
                }
            }
            if (pending.size && !scheduled) schedule();
        }).observe(document.documentElement, { childList: true, subtree: true });
    }

    function registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand('Set minimum review length…', async () => {
            const answer = prompt('Hide reviews shorter than how many characters?', characterMinimum);
            if (answer === null) return;

            const parsed = Number(answer.trim());
            if (!Number.isInteger(parsed) || parsed < 0) {
                alert('Please enter a whole number of characters (0 or more).');
                return;
            }

            characterMinimum = parsed;
            await writeSetting(SETTING_KEY, parsed);
            sweep('setting changed');
        });
    }

    injectStyle();
    observe();
    registerMenu();

    // Deliberately not awaited before observing: blocking the first pass on storage would let short
    // reviews paint before being hidden. Start culling at the default, then correct course if the
    // stored threshold differs.
    readSetting(SETTING_KEY, DEFAULT_MINIMUM).then(stored => {
        if (Number.isInteger(stored) && stored >= 0 && stored !== characterMinimum) {
            characterMinimum = stored;
            sweep('stored setting loaded');
        }
    }).catch(error => log('could not read stored minimum, using default:', error));

    document.addEventListener('DOMContentLoaded', () => sweep('DOMContentLoaded'));
    window.addEventListener('load', () => sweep('load'));
})();
