/* ============================================================================
   Stand.earth Supporter Hub — dashboard wrapper
   hub-dashboard.js

   A progressive-enhancement layer over Engaging Networks' Supporter Hub.
   It reads what EN has already rendered, presents it as a dashboard, and
   hands every donor action back to EN's own controls.

   WHAT IT DOES NOT DO
   -------------------
   - No network requests of its own. No EN REST API. Ever.
   - No re-implemented submits. Every action clicks an EN control.
   - Nothing is removed from the DOM. Hiding is CSS-only.
   - supporterId never leaves the page: not stored, not logged, not sent.
   - It never reads, writes, observes, or listens anywhere inside
     .en__hubUpdateCC or any .en__field--vgs / .en__field--cc* element.
     There are no MutationObservers in this file at all — waiting is done by
     polling querySelector, so no card field is ever under observation.
   - It never displays a figure it could not derive from the page. Where the
     data is not there, the component is skipped rather than approximated.

   Vanilla ES2019. No dependencies.
   Verified against captures in ../widgets/ and ../index.html on 2026-08-05.
   ============================================================================ */

(function () {
  'use strict';

  var VERSION = '2.0.0';

  /* ==========================================================================
     Config

     Everything a non-developer might reasonably want to change lives here.
     The two feature flags below are OFF because the data behind them does
     not exist yet — see the comments. Turning either on without supplying a
     real source would put an invented number in front of a donor.
     ========================================================================== */

  var CFG = {
    /* --- Organisation ------------------------------------------------- */
    orgName: 'Stand.earth',
    orgTagline: 'Your giving, in one place',
    // Optional logo mark for the top bar. Leave empty to use the initial
    // badge instead. Use the same CDN URL you uploaded the logo to.
    orgMarkUrl: '',

    /* --- Donor services ----------------------------------------------- */
    // Displayed under the contact block in the sidebar. Hours only — the
    // name, email and phone come from EN's page-builder copy block so
    // Fundraising can change them when staff change, without a deploy.
    supportHours: 'Mon–Fri, 9am–5pm Pacific',

    /* --- Upgrade offer (build spec B6) --------------------------------- */
    upgrade: {
      enabled: true,
      rate: 0.10,        // proportion of the current gift to ask for
      floor: 2,          // never ask for less than this
      cap: 25,           // never ask for more than this
      amountCeiling: 500, // above this monthly amount, no banner — those
                          // donors go to a conversation with staff, not a nudge
      maxPct: 50         // if the computed ask exceeds this percentage of the
                         // current gift, suppress. A $2 ask against a $1.33
                         // gift is a 150% increase, which is not a nudge.
    },

    /* --- Impact figures ------------------------------------------------
       OFF, and it must stay off until Fundraising owns the number.

       To turn this on, set enabled:true and supply costPerUnit — the
       dollars behind one unit — plus singular/plural labels. The dashboard
       will then divide verified giving totals by it.

       Do not guess this value. A quantified impact claim needs an owner,
       and "$X provides Y meals" printed next to a donor's own giving total
       is a claim the organisation has to be able to stand behind.
       ------------------------------------------------------------------- */
    impact: {
      enabled: false,
      costPerUnit: null,      // e.g. 2.50
      unit: 'meal',
      unitPlural: 'meals',
      verb: 'provided'
    },

    /* --- Annual giving goal --------------------------------------------
       OFF. EN does not expose a per-donor goal anywhere in the hub DOM, so
       there is nothing to read. Set enabled:true and amount to show the
       same goal to every donor, which is a campaign decision, not a
       technical one.
       ------------------------------------------------------------------- */
    goal: {
      enabled: false,
      amount: null            // e.g. 1000
    },

    /* --- Timing -------------------------------------------------------- */
    gadgetTimeout: 9000,      // longest wait for an EN panel to render
    pageTimeout: 6000,        // longest wait for one history page to swap
    pollInterval: 60,
    maxHistoryPages: 40,      // ceiling on the background crawl
    expirySoonDays: 60,       // card expiry inside this window is surfaced
    successWatchMs: 60000,
    historyRows: 12           // rows shown before "Show all"
  };

  /* ==========================================================================
     Selector registry — the single source of truth.

     Every selector in this file lives here, each recording what it targets
     and which capture verified it. EN's gadget markup is undocumented and
     unversioned, so this is the fragile boundary of the whole project.
     ========================================================================== */

  var SEL = {
    page: {
      engrid: '#engrid',
      copyblock: '.en__component--copyblock'
    },

    gadget: {
      // Clickable gadget tiles on page 2. data-componenttype is EN's own
      // stable identifier for which gadget it is.
      // Verified: index.html, 2026-08-05
      all: '.en__component--hubgadget',
      // Success flash EN writes after a gadget completes an update.
      // Verified: page style block in index.html, 2026-08-05
      success: '.en__hubgadget__response--success'
    },

    overlay: {
      // Panel EN injects on gadget click, one per gadget type.
      // Verified: all files in ../widgets/, 2026-08-05
      any: '.en__hubOverlay',
      close: '.en__button--close',
      closeLink: '.en__hubOverlay__header a',
      byType: {
        PLEDGE: '.en__hubOverlay--pledge',
        TXN_GIVING: '.en__hubOverlay--txngiving',
        SUPPORTER_DETAILS: '.en__hubOverlay--supporterdetails',
        SUPPORTER_SUBSCRIPTIONS: '.en__hubOverlay--supportersubscriptions'
      },
      // Element whose presence means "this panel finished rendering".
      // Polled, never observed.
      readyByType: {
        PLEDGE: '.en__hubPledge',
        TXN_GIVING: '.en__hubTxnGiving',
        SUPPORTER_DETAILS: '.en__field--firstName',
        SUPPORTER_SUBSCRIPTIONS: '.en__field__input--checkbox'
      }
    },

    pledge: {
      // Single-gift variant. The state class is EN's own donor-status flag.
      // Verified: giftview.html (activeRecurring), reactivategift.html
      //           (dormantRecurring), 2026-08-05
      state: '.en__hubPledge__state',
      stateActive: 'en__hubPledge__state--activeRecurring',
      stateDormant: 'en__hubPledge__state--dormantRecurring',

      // The amount lives in this copy block as prose, NOT in the amount
      // radios. The radios are the upgrade ladder and are pre-checked at $25
      // even for a donor giving $1.33, so reading them reports a false
      // amount. This copy block is the only route to the current amount in
      // the single-gift variant.
      // Verified: giftview.html, 2026-08-05
      currentCopy: '.en__component--copyblock--copyDonationPrevious',

      // Multi-gift variant: one <li> per commitment, each carrying its own
      // amount, next payment date and card text. The shape that must be
      // handled for N > 1.
      // Verified: recurringgiftview.html, 2026-08-05
      listItem: '.en__hubPledge__list__item',

      // EN's own controls. We click these; we never submit anything.
      // Verified: giftview.html, 2026-08-05
      updateControl: '[data-action="update"]',
      cancelControl: '[data-action="cancel"]',

      // Amount ladder, used only to prefill an upgrade. Outside the card
      // zone. Verified: giftview.html, 2026-08-05
      amountRadio: 'input[name="donationAmt"]',
      amountOther: '.en__field__input--other'
    },

    txn: {
      // Verified: transactionhistory.html, 2026-08-05
      root: '.en__hubTxnGiving',
      totalValue: '.en__hubTxnGiving__transactions__total span',
      row: '.en__hubTxnGiving__transaction',
      rowHeader: '.en__hubTxnGiving__transaction__header',
      rowPayment: '.en__hubTxnGiving__transaction__payment',
      rowRecurring: 'en__hubTxnGiving__transaction--recurring',
      pagination: '.en__pagination',
      pageButton: '.en__pagination__page',
      nextButton: '.en__pagination__next',
      lastButton: '.en__pagination__last',
      // EN moves this class to the current page button on every page change.
      // It is the most reliable "the page actually changed" signal — far
      // better than comparing row text, which is identical between two pages
      // whenever a donor has given the same amount on the same day of the
      // month with the same card. Verified: transactionhistory.html, 2026-08-05
      activePage: '.en__pagination .en__button--active',

      // NOT PRESENT in the 2026-08-05 captures. EN can be configured to
      // expose an already-issued receipt for download on each history row
      // (Giving History gadget settings). The Receipt column appears
      // automatically once that setting is on and this matches; until then
      // the column is omitted rather than faked.
      rowReceipt: 'a[href*="receipt"], a[download]'
    },

    details: {
      // Verified: supporterdetails.html, 2026-08-05
      input: '.en__field__input',
      byName: {
        firstName: '.en__field--firstName',
        lastName: '.en__field--lastName',
        email: '.en__field--emailAddress',
        phone: '.en__field--phoneNumber',
        address1: '.en__field--address1',
        city: '.en__field--city',
        region: '.en__field--region',
        postcode: '.en__field--postcode',
        country: '.en__field--country'
      }
    },

    subs: {
      // Verified: managesubscriptions.html, 2026-08-05
      checkbox: 'input.en__field__input--checkbox',
      itemLabel: '.en__field__label--item'
    },

    /* ------------------------------------------------------------------
       CARD ZONE — the standdown list.

       Nothing in this file reads, writes, observes or listens inside any
       element matching this selector. It exists so every helper can refuse
       to touch it. Styling these with plain CSS is fine; touching them with
       script is what would move the account from PCI SAQ A to SAQ A-EP.

       This deliberately includes .en__field--ccexpire and
       .en__field--ccnumberstatic even though both are readable — card
       expiry and last-four are taken from plain prose elsewhere on the page
       instead, so the whole subtree stays untouched.
       Verified: giftview.html, 2026-08-05
       ------------------------------------------------------------------ */
    cardZone: [
      '.en__hubUpdateCC',
      '.en__field--vgs',
      '.en__field--ccnumber',
      '.en__field--ccvv',
      '.en__field--ccexpire',
      '.en__field--ccnumberstatic',
      '[class*="vgs-collect"]'
    ].join(', ')
  };

  /* ==========================================================================
     Health and analytics

     No backend, so analytics is the only monitoring channel. Every event is
     PII-free; supporterId is never included.
     ========================================================================== */

  var health = { version: VERSION, booted: false, misses: [], harvest: {}, notes: [] };

  function miss(key) {
    if (health.misses.indexOf(key) === -1) health.misses.push(key);
    track('wrapper_selector_missing', { selectorKey: key });
  }

  function note(msg) { health.notes.push(msg); }

  function track(event, data) {
    try {
      var payload = { event: 'sehub_' + event };
      if (data) {
        for (var k in data) {
          if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
        }
      }
      delete payload.supporterId;  // belt and braces
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(payload);
    } catch (e) { /* analytics must never break the page */ }
  }

  /* Wrap a feature so its failure cannot stop the others. */
  function guard(name, fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) {
        note(name + ' threw: ' + (e && e.message));
        track('feature_error', { feature: name });
        return null;
      }
    };
  }

  /* ==========================================================================
     DOM helpers
     ========================================================================== */

  function qs(sel, root) {
    try { return (root || document).querySelector(sel); } catch (e) { return null; }
  }

  function qsa(sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    catch (e) { return []; }
  }

  /* True if node is, or is inside, the card zone. */
  function inCardZone(node) {
    if (!node || node.nodeType !== 1) return false;
    try { return !!node.closest(SEL.cardZone); }
    catch (e) { return true; }  // if we cannot tell, assume card data and stand off
  }

  function safeQs(sel, root) {
    var found = qsa(sel, root);
    for (var i = 0; i < found.length; i++) if (!inCardZone(found[i])) return found[i];
    return null;
  }

  function safeQsa(sel, root) {
    return qsa(sel, root).filter(function (n) { return !inCardZone(n); });
  }

  function text(node) {
    if (!node || inCardZone(node)) return '';
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function safeText(sel, root) { return text(safeQs(sel, root)); }

  function el(tag, cls, content) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content != null) n.textContent = String(content);
    return n;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function append(parent) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  /* Poll for a condition. Resolves with the value, or null on timeout. Used
     everywhere instead of MutationObserver so no card field is ever placed
     under observation. */
  function until(test, timeout) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + (timeout || CFG.gadgetTimeout);
      (function tick() {
        var v;
        try { v = test(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(tick, CFG.pollInterval);
      })();
    });
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ==========================================================================
     Parsing

     Defensive throughout. A value that does not parse to a positive finite
     number is discarded, and any feature that depended on it skips rather
     than showing the donor an approximation of their own generosity.
     ========================================================================== */

  var NUM = '\\d[\\d,\\u00a0 ]*(?:\\.\\d{1,2})?';
  var RE_CUR_BEFORE = new RegExp('\\b([A-Z]{3})\\s*[$£€¥]?\\s*(' + NUM + ')');
  var RE_CUR_AFTER = new RegExp('(' + NUM + ')\\s*([A-Z]{3})\\b');
  var RE_SYM_ONLY = new RegExp('([$£€¥])\\s*(' + NUM + ')');
  var SYMBOL_TO_CODE = { '$': null, '£': 'GBP', '€': 'EUR', '¥': 'JPY' };

  function toNumber(raw) {
    if (raw == null) return null;
    var n = parseFloat(String(raw).replace(/[,\s ]/g, ''));
    return (typeof n === 'number' && isFinite(n) && n >= 0) ? n : null;
  }

  /* Parse the first money value in a string. Handles "USD$1.00", "1.33 USD",
     "$140.28" and "$1,234.56". currency is null for a bare symbol. */
  function parseMoney(str) {
    if (!str) return null;
    var m = RE_CUR_BEFORE.exec(str);
    if (m) { var a = toNumber(m[2]); if (a !== null) return { amount: a, currency: m[1] }; }
    m = RE_CUR_AFTER.exec(str);
    if (m) { var b = toNumber(m[1]); if (b !== null) return { amount: b, currency: m[2] }; }
    m = RE_SYM_ONLY.exec(str);
    if (m) { var c = toNumber(m[2]); if (c !== null) return { amount: c, currency: SYMBOL_TO_CODE[m[1]] || null }; }
    return null;
  }

  /* EN's "Total all time" field can hold one figure per currency, comma
     separated: "$140.28, $108.63". */
  function parseAllMoney(str) {
    if (!str) return [];
    var out = [];
    var re = new RegExp('(?:\\b([A-Z]{3})\\s*)?([$£€¥])?\\s*(' + NUM + ')\\s*(?:([A-Z]{3})\\b)?', 'g');
    var m;
    while ((m = re.exec(str)) !== null) {
      if (!m[0].trim()) { re.lastIndex++; continue; }
      var a = toNumber(m[3]);
      if (a === null) continue;
      out.push({ amount: a, currency: m[1] || m[4] || SYMBOL_TO_CODE[m[2]] || null });
    }
    return out;
  }

  /* "2026-08-30" or "2026-3-23" into a local Date. Built from parts rather
     than Date.parse, so it is not shifted a day by UTC interpretation. */
  function parseDate(str) {
    if (!str) return null;
    var m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  /* "expiry 08/2027" or "expiry 0827" into { month, year }. Two-digit years
     read as 20xx. Null on anything ambiguous. */
  function parseExpiry(str) {
    if (!str) return null;
    var m = /expiry\s*(\d{2})\s*\/\s*(\d{2,4})/i.exec(str) || /expiry\s*(\d{2})(\d{2})\b/i.exec(str);
    if (!m) return null;
    var mo = +m[1], yr = +m[2];
    if (mo < 1 || mo > 12) return null;
    if (yr < 100) yr += 2000;
    if (yr < 2000 || yr > 2100) return null;
    return { month: mo, year: yr };
  }

  function parseLast4(str) {
    var m = /ending in\s*(\d{4})/i.exec(str || '');
    return m ? m[1] : null;
  }

  /* ==========================================================================
     Formatting
     ========================================================================== */

  var LOCALE = (window.pageJson && window.pageJson.locale) || 'en-US';

  function formatMoney(amount, currency, forceCents) {
    if (typeof amount !== 'number' || !isFinite(amount)) return '';
    var min = (forceCents || amount % 1 !== 0) ? 2 : 0;
    try {
      if (currency) {
        return new Intl.NumberFormat(LOCALE, {
          style: 'currency', currency: currency,
          minimumFractionDigits: min, maximumFractionDigits: 2
        }).format(amount);
      }
      return '$' + new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: min, maximumFractionDigits: 2
      }).format(amount);
    } catch (e) {
      return '$' + amount.toFixed(min);
    }
  }

  function formatMoneyShort(amount) {
    if (typeof amount !== 'number' || !isFinite(amount)) return '';
    if (amount >= 1000) return '$' + (Math.round(amount / 100) / 10) + 'k';
    return '$' + (amount % 1 === 0 ? amount : amount.toFixed(0));
  }

  function formatDate(dt, style) {
    if (!dt) return '';
    try {
      return new Intl.DateTimeFormat(LOCALE, style ||
        { year: 'numeric', month: 'short', day: 'numeric' }).format(dt);
    } catch (e) {
      return dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate();
    }
  }

  function formatMonthYear(month, year) {
    try {
      return new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' })
        .format(new Date(year, month - 1, 1));
    } catch (e) { return month + '/' + year; }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function initials(first, last) {
    var a = (first || '').trim().charAt(0);
    var b = (last || '').trim().charAt(0);
    return ((a + b) || a || '?').toUpperCase();
  }

  /* ==========================================================================
     Icons
     ========================================================================== */

  var ICONS = {
    heart: 'M12 20.7 3.9 12.6a5.3 5.3 0 0 1 7.5-7.5l.6.6.6-.6a5.3 5.3 0 1 1 7.5 7.5z',
    card: 'M3 6h18v3H3zM3 11h18v7H3zm2 3h5v2H5z',
    calendar: 'M7 2v2h10V2h2v2h3v18H2V4h3V2zm13 8H4v10h16z',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3z',
    hash: 'M9 3 8.4 8H4v2h4.1l-.6 4H3v2h4.2L6.6 21h2l.6-5h4l-.6 5h2l.6-5H20v-2h-4.6l.6-4H21V8h-4.4l.6-5h-2l-.6 5h-4l.6-5zM9.9 10h4l-.6 4h-4z',
    repeat: 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
    mail: 'M2 5h20v14H2zm2 2v.3l8 5 8-5V7z',
    phone: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.2 11 11 0 0 0 3.5.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .6 3.5 1 1 0 0 1-.3 1z',
    pin: 'M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
    person: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5c0-3-4-5.5-9-5.5z',
    pencil: 'M3 17.2V21h3.8L18 9.8 14.2 6zm17.7-10.1a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8L18.9 8.9z',
    download: 'M12 3v10.2l3.6-3.6L17 11l-5 5-5-5 1.4-1.4L12 13.2V3zM5 19h14v2H5z',
    trend: 'M4 18.6 2.6 17.2 10 9.8l4 4 6-6.8V4h-6.4l2.2 2.2L14 11 10 7 1.2 15.8z',
    sparkle: 'M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z',
    help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm1.8-6.3-.9.9c-.6.6-.9 1.1-.9 2.4h-2v-.5c0-1 .4-1.8 1-2.4l1.2-1.3c.4-.3.6-.8.6-1.3a2 2 0 0 0-4 0H8a4 4 0 0 1 8 0c0 .8-.3 1.5-.9 2.2z',
    close: 'M18 7.4 16.6 6 12 10.6 7.4 6 6 7.4 10.6 12 6 16.6 7.4 18 12 13.4 16.6 18 18 16.6 13.4 12z',
    check: 'M9.6 16.6 4.9 12l1.4-1.4 3.3 3.3 7.9-7.9L18.9 7z',
    pause: 'M9 5h2v14H9zM13 5h2v14h-2z',
    bell: 'M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22zm7-6v-5a7 7 0 0 0-5.5-6.8V3a1.5 1.5 0 0 0-3 0v1.2A7 7 0 0 0 5 11v5l-2 2v1h18v-1z',
    doc: 'M14 2H5v20h14V7zm0 6V3.5L18.5 8z',
    external: 'M8 6h10v10h-2V9.4L7.4 18 6 16.6 14.6 8H8z',
    leaf: 'M20 3C9 3 4 9 4 16c0 1.3.2 2.4.5 3.3l-1.6 1.6L4.3 22.3l1.6-1.6c.9.3 2 .5 3.3.5C17 21.2 21 14 20 3z'
  };

  function icon(name, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'currentColor');
    if (cls) svg.setAttribute('class', cls);
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name] || '');
    svg.appendChild(p);
    return svg;
  }

  /* ==========================================================================
     Gadget driver

     One overlay at a time, strictly serialised. Opening always clicks EN's
     own tile; closing always clicks EN's own close control.
     ========================================================================== */

  var queue = Promise.resolve();

  function gadgetTile(type) {
    return qs(SEL.gadget.all + '[data-componenttype="' + type + '"]');
  }

  function overlayFor(type) {
    var sel = SEL.overlay.byType[type];
    return sel ? qs(sel) : null;
  }

  function openGadget(type) {
    var tile = gadgetTile(type);
    if (!tile) { miss('gadget.' + type); return Promise.resolve(null); }

    var readySel = SEL.overlay.readyByType[type];
    var overlaySel = SEL.overlay.byType[type];

    var existing = overlayFor(type);
    if (existing && qs(readySel, existing)) return Promise.resolve(existing);

    tile.click();
    return until(function () {
      var o = qs(overlaySel);
      return (o && qs(readySel, o)) ? o : null;
    }, CFG.gadgetTimeout).then(function (o) {
      if (!o) {
        miss('overlay.' + type);
        note('gadget ' + type + ' did not render within ' + CFG.gadgetTimeout + 'ms');
      }
      return o;
    });
  }

  /* Close via EN's own control, never by removing the node. */
  function closeOverlay(overlay) {
    if (!overlay) return Promise.resolve();
    var btn = safeQs(SEL.overlay.close, overlay) || qs(SEL.overlay.closeLink, overlay);
    if (!btn) { note('no close control on ' + (overlay.className || 'overlay')); return Promise.resolve(); }
    btn.click();
    return until(function () {
      return (!document.body.contains(overlay) || overlay.offsetParent === null) ? true : null;
    }, 2000).then(function () { return delay(80); });
  }

  /* Serialise a harvest: open, read, close. */
  function harvest(type, reader) {
    queue = queue.then(function () {
      return openGadget(type).then(function (overlay) {
        if (!overlay) return null;
        var result;
        try { result = reader(overlay); }
        catch (e) { note('harvest ' + type + ' threw: ' + (e && e.message)); result = null; }
        return Promise.resolve(result).then(function (r) {
          return closeOverlay(overlay).then(function () { return r; });
        }, function () {
          return closeOverlay(overlay).then(function () { return null; });
        });
      });
    });
    return queue;
  }

  /* Hand an action to EN: reveal the overlay and click EN's own tile.
     `prefill` optionally seeds the amount ladder for an upgrade. */
  function openForDonor(type, opts) {
    opts = opts || {};
    document.body.classList.remove('sehub-harvesting');

    var tile = gadgetTile(type);
    if (!tile) { miss('gadget.' + type); return; }

    track('gadget_open', { gadget: type, source: opts.source || 'dashboard' });
    tile.click();
    watchForSuccess();

    if (opts.prefillAmount) {
      // Wait for the panel, then seed EN's own amount control. If anything
      // is missing the donor simply lands on the panel unprefilled, which
      // is a working outcome rather than a broken one.
      until(function () {
        var o = overlayFor(type);
        return (o && qs(SEL.overlay.readyByType[type], o)) ? o : null;
      }, CFG.gadgetTimeout).then(function (o) {
        if (o) guard('prefillAmount', prefillAmount)(o, opts.prefillAmount);
      });
    }

    if (opts.focusSelector) {
      until(function () {
        var o = overlayFor(type);
        return o ? safeQs(opts.focusSelector, o) : null;
      }, CFG.gadgetTimeout).then(function (control) {
        if (control && control.scrollIntoView) {
          var reduce = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          control.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        }
      });
    }
  }

  /* Seed EN's amount ladder. Prefers an exact radio match; otherwise uses
     EN's own "other" field. Never touches a payment field. */
  function prefillAmount(overlay, amount) {
    var radios = safeQsa(SEL.pledge.amountRadio, overlay);
    if (!radios.length) { miss('pledge.amountRadio'); return; }

    var target = null;
    for (var i = 0; i < radios.length; i++) {
      var v = parseMoney(radios[i].value || '');
      if (v && Math.abs(v.amount - amount) < 0.005) { target = radios[i]; break; }
    }

    if (target) {
      target.click();
      track('upgrade_prefilled', { mode: 'ladder' });
      return;
    }

    var other = null;
    for (var j = 0; j < radios.length; j++) {
      if (/other/i.test(radios[j].value || '')) { other = radios[j]; break; }
    }
    if (!other) { note('no Other amount option to prefill'); return; }

    other.click();
    var input = safeQs(SEL.pledge.amountOther, overlay);
    if (!input) { miss('pledge.amountOther'); return; }
    input.value = amount.toFixed(2);
    // EN's own handlers listen for these; dispatching keeps its state in sync.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    track('upgrade_prefilled', { mode: 'other' });
  }

  /* After the donor acts, watch for EN's success flash so we can say the
     summary is now out of date. We deliberately do not re-open the gift
     panel to re-read it — that panel holds card fields, and offering a
     reload is both honest and cheap. */
  var successWatching = false;
  function watchForSuccess() {
    if (successWatching) return;
    successWatching = true;
    until(function () { return qs(SEL.gadget.success) ? true : null; }, CFG.successWatchMs)
      .then(function (found) {
        successWatching = false;
        if (found) { track('update_completed'); showStaleNotice(); }
      });
  }

  /* ==========================================================================
     Harvesters
     ========================================================================== */

  function readPledge(overlay) {
    var gifts = [];

    // Multi-gift list variant first — the more explicit markup.
    var items = safeQsa(SEL.pledge.listItem, overlay);
    if (items.length) {
      items.forEach(function (li) {
        var t = text(li);
        var money = parseMoney(t);
        gifts.push({
          id: li.getAttribute('data-recurringtxnid') || null,
          amount: money ? money.amount : null,
          currency: money ? money.currency : null,
          nextPayment: parseDate(t),
          last4: parseLast4(t),
          expiry: parseExpiry(t),
          active: true
        });
      });
      return {
        gifts: gifts,
        status: gifts.length ? 'active' : 'none',
        source: 'list',
        // The list variant offers Close only — no cancel control. Checked
        // rather than assumed, so we never advertise an action the panel
        // cannot perform.
        hasCancel: !!safeQs(SEL.pledge.cancelControl, overlay)
      };
    }

    var state = safeQs(SEL.pledge.state, overlay);
    if (!state) { miss('pledge.state'); return null; }

    var cls = state.className || '';
    var status = cls.indexOf(SEL.pledge.stateActive) !== -1 ? 'active'
      : cls.indexOf(SEL.pledge.stateDormant) !== -1 ? 'dormant' : 'unknown';

    var copy = safeText(SEL.pledge.currentCopy, overlay);
    if (!copy) miss('pledge.currentCopy');
    var money = parseMoney(copy);

    gifts.push({
      id: null,
      amount: money ? money.amount : null,
      currency: money ? money.currency : null,
      nextPayment: parseDate(copy),
      last4: null,   // taken from history prose; card zone left untouched
      expiry: null,
      active: status === 'active'
    });

    return {
      gifts: gifts,
      status: status,
      source: 'state',
      hasCancel: !!safeQs(SEL.pledge.cancelControl, overlay)
    };
  }

  function readHistoryRows(overlay) {
    return safeQsa(SEL.txn.row, overlay).map(function (li) {
      var head = text(safeQs(SEL.txn.rowHeader, li));
      var pay = text(safeQs(SEL.txn.rowPayment, li));
      var money = parseMoney(head);
      var all = head + ' ' + pay;
      var receipt = safeQs(SEL.txn.rowReceipt, li);
      return {
        raw: all,
        date: parseDate(head),
        amount: money ? money.amount : null,
        currency: money ? money.currency : null,
        recurring: (li.className || '').indexOf(SEL.txn.rowRecurring) !== -1,
        started: /you started/i.test(head),
        last4: parseLast4(pay),
        expiry: parseExpiry(pay),
        receiptHref: receipt ? receipt.getAttribute('href') : null,
        // Rows that must not be counted. We have no capture of a refunded or
        // rejected row, so this matches on wording and is deliberately
        // broad — an exclusion is safer than a miscount.
        excluded: /refund|reject|declin|fail|charge\s*back|reversed|void/i.test(all)
      };
    });
  }

  function historyPageCount(overlay) {
    var last = safeQs(SEL.txn.lastButton, overlay);
    var n = last ? parseInt(last.getAttribute('data-page'), 10) : NaN;
    if (isFinite(n) && n > 0) return n;
    var pages = safeQsa(SEL.txn.pageButton, overlay)
      .map(function (b) { return parseInt(b.getAttribute('data-page'), 10); })
      .filter(isFinite);
    return pages.length ? Math.max.apply(null, pages) : 1;
  }

  /* A fingerprint of "which page is showing".

     Row text alone is not enough: a donor giving the same amount on the same
     day of each month with the same card produces byte-identical rows, so two
     consecutive history pages can look the same and the crawl would conclude
     the page never loaded. Leading with EN's active-page marker fixes that,
     with row count and first-row text as fallbacks if EN drops the class. */
  function historySignature(overlay) {
    var active = safeQs(SEL.txn.activePage, overlay);
    var page = active ? (active.getAttribute('data-page') || text(active)) : '';
    var rows = safeQsa(SEL.txn.row, overlay);
    return page + '|' + rows.length + '|' + (rows.length ? text(rows[0]).slice(0, 80) : '');
  }

  /* Click through every page of the giving history, reporting progress.
     complete is false if we hit the page ceiling, a page failed to swap, or
     any counted row's amount would not parse. Nothing derived from an
     incomplete crawl is ever shown as a total. */
  function activePageNumber(overlay, fallback) {
    var active = safeQs(SEL.txn.activePage, overlay);
    var n = active ? parseInt(active.getAttribute('data-page'), 10) : NaN;
    return isFinite(n) ? n : fallback;
  }

  function crawlHistory(overlay, onProgress) {
    var rows = readHistoryRows(overlay);
    var pageCount = historyPageCount(overlay);

    /* Pages are tracked by number, not by row text. Deduplicating on text
       would silently drop a second genuine gift of the same amount, on the
       same day, with the same card — which understates a donor's total.
       Tracking pages instead protects against re-reading a page we already
       counted, which is the only way a real duplicate can occur here. */
    var pagesSeen = {};
    pagesSeen[activePageNumber(overlay, 1)] = true;

    var limit = Math.min(pageCount, CFG.maxHistoryPages);
    var truncated = pageCount > CFG.maxHistoryPages;
    var pagesRead = 1;
    var stalled = false;

    if (truncated) {
      note('history has ' + pageCount + ' pages, ceiling is ' + CFG.maxHistoryPages +
           ' — totals suppressed');
      track('history_truncated', { pageCount: pageCount, ceiling: CFG.maxHistoryPages });
    }

    if (onProgress) onProgress(1, limit);

    function step(page) {
      if (page > limit || stalled) return Promise.resolve();

      // Re-query every iteration: EN re-renders the pagination strip and it
      // is windowed, so a numbered button for a distant page may not exist.
      var btn = safeQsa(SEL.txn.pageButton, overlay).filter(function (b) {
        return parseInt(b.getAttribute('data-page'), 10) === page && !b.disabled;
      })[0];
      if (!btn) {
        btn = safeQsa(SEL.txn.nextButton, overlay).filter(function (b) { return !b.disabled; })[0];
      }
      if (!btn) {
        stalled = true;
        note('history pagination ran out at page ' + page + ' of ' + limit);
        return Promise.resolve();
      }

      var before = historySignature(overlay);
      btn.click();

      return until(function () {
        var now = historySignature(overlay);
        return (now && now !== before) ? now : null;
      }, CFG.pageTimeout).then(function (changed) {
        if (!changed) {
          stalled = true;
          note('history page ' + page + ' did not load within ' + CFG.pageTimeout + 'ms');
          return;
        }
        // Which page did we actually land on? With the "next" fallback this
        // is not always the page we asked for.
        var landed = activePageNumber(overlay, page);
        if (!pagesSeen[landed]) {
          pagesSeen[landed] = true;
          rows = rows.concat(readHistoryRows(overlay));
        }
        pagesRead = Object.keys(pagesSeen).length;
        if (onProgress) onProgress(pagesRead, limit);
        return step(page + 1);
      });
    }

    return step(2).then(function () {
      var counted = rows.filter(function (r) { return !r.excluded && !r.started; });
      var unparsed = counted.filter(function (r) { return r.amount === null; }).length;
      if (unparsed) {
        note(unparsed + ' history rows had an unreadable amount — totals suppressed');
        track('history_unparsed_rows', { count: unparsed });
      }
      return {
        rows: rows, pagesRead: pagesRead, pageCount: pageCount,
        // Every condition must hold. A total derived from a crawl that
        // skipped a page is a wrong number about someone's own generosity,
        // which is worse than showing no number at all.
        complete: !stalled && !truncated && unparsed === 0 && pagesRead >= limit
      };
    });
  }

  /* Turn crawled rows into figures. Grouped by currency, because this
     account's history mixes them. Excludes the three row types that would
     otherwise misstate a donor's giving:
       - zero-value rows (EN writes these to establish scheduling on
         migrated recurring gifts)
       - refunds, rejections and failures
       - "you started a ... donation" rows, which announce a schedule rather
         than record a payment */
  function summarise(crawl) {
    var byCurrency = {}, byMonth = {}, ytd = {};
    var counted = 0, earliest = null, latest = null;
    var now = new Date();
    var thisYear = now.getFullYear();

    crawl.rows.forEach(function (r) {
      if (r.excluded || r.started) return;
      if (r.amount === null || r.amount === 0) return;

      var cur = r.currency || 'USD';
      byCurrency[cur] = (byCurrency[cur] || 0) + r.amount;
      counted++;

      if (r.date) {
        var key = r.date.getFullYear() + '-' + pad2(r.date.getMonth() + 1);
        byMonth[cur] = byMonth[cur] || {};
        byMonth[cur][key] = (byMonth[cur][key] || 0) + r.amount;
        if (!earliest || r.date < earliest) earliest = r.date;
        if (!latest || r.date > latest) latest = r.date;
        if (r.date.getFullYear() === thisYear) ytd[cur] = (ytd[cur] || 0) + r.amount;
      }
    });

    // Schedule start, from EN's own "you started a ... donation" row.
    var startRow = crawl.rows.filter(function (r) { return r.started && r.date; })
      .sort(function (a, b) { return a.date - b.date; })[0];

    // Most recent card detail, from prose only.
    var dated = crawl.rows.filter(function (r) { return r.date && r.last4; })
      .sort(function (a, b) { return b.date - a.date; });
    var card = dated.length ? { last4: dated[0].last4, expiry: dated[0].expiry } : null;

    var months = null;
    if (earliest) {
      months = (now.getFullYear() - earliest.getFullYear()) * 12 +
               (now.getMonth() - earliest.getMonth());
      if (months < 0) months = 0;
    }

    return {
      byCurrency: byCurrency, byMonth: byMonth, ytd: ytd,
      count: counted, earliest: earliest, latest: latest,
      started: startRow ? startRow.date : null,
      monthsGiving: months, card: card, complete: crawl.complete,
      currencies: Object.keys(byCurrency).sort(function (a, b) {
        return byCurrency[b] - byCurrency[a];
      })
    };
  }

  function readDetails(overlay) {
    var out = {};
    Object.keys(SEL.details.byName).forEach(function (key) {
      var field = safeQs(SEL.details.byName[key], overlay);
      if (!field) return;
      var input = safeQs(SEL.details.input, field);
      if (!input) return;
      var v;
      if (input.tagName === 'SELECT') {
        var opt = input.options[input.selectedIndex];
        // An unset select sits on its placeholder option, whose value is
        // empty. Its label ("Select State/Province") is not the donor's
        // region, so treat it as absent.
        v = (opt && opt.value) ? opt.text : '';
      } else {
        v = input.value || '';
      }
      v = v.trim();
      if (v) out[key] = v;
    });
    if (!Object.keys(out).length) miss('details.fields');
    return out;
  }

  function cssEscape(v) {
    if (window.CSS && CSS.escape) return CSS.escape(v);
    return String(v).replace(/([.:#\[\]$])/g, '\\$1');
  }

  function readSubs(overlay) {
    var boxes = safeQsa(SEL.subs.checkbox, overlay);
    if (!boxes.length) { miss('subs.checkbox'); return null; }
    return boxes.map(function (box) {
      var label = box.id ? qs('label[for="' + cssEscape(box.id) + '"]', overlay) : null;
      if (!label) label = safeQs(SEL.subs.itemLabel, box.parentNode);
      // First sentence only — several of these labels carry a paragraph of
      // small print underneath, which is not the name of a preference.
      var full = text(label);
      var first = full.split(/(?:\.\s|\sBy submitting|\sOnce a month)/)[0];
      return { name: (first || full).replace(/\s*\(untick.*$/i, '').trim(), on: !!box.checked };
    }).filter(function (p) { return p.name; });
  }

  /* ==========================================================================
     Alerts

     Derived only from state visible in the DOM. One banner, highest priority
     only. Neutral wording: an upcoming expiry is information, not an
     emergency.

     NOT BUILT: payment-failed and gift-on-hold banners. Neither state is
     distinguishable in the captured markup — the failure copy block is
     present whether or not a payment failed, so keying off it would tell
     donors their gift had failed when it had not. Recorded as a gap rather
     than guessed at.
     ========================================================================== */

  function buildAlerts(model) {
    var alerts = [];
    var now = new Date();

    if (model.pledge && model.pledge.status === 'dormant') {
      alerts.push({
        priority: 1, tone: 'urgent', iconName: 'pause', type: 'gift_dormant',
        title: 'Your monthly gift is not active',
        text: 'Your recurring gift is on file but is not currently being collected. ' +
              'You can restart it whenever you are ready.',
        action: { text: 'Restart your gift', gadget: 'PLEDGE' }
      });
    }

    /* Which card is this alert about?

       When EN's gift panel states a card per gift, that is authoritative and
       must win — otherwise a donor with two gifts gets told the card from
       their giving history is expiring while the tile beside it shows a
       different card. Only when no gift states a card do we fall back to the
       most recent card seen in the history prose.

       With several cards on file the soonest expiry is the one worth
       raising, and the banner names its last four so it is never ambiguous
       which card is meant. */
    var gifts = (model.pledge && model.pledge.gifts) || [];
    var stated = gifts.filter(function (g) { return g.expiry; });
    var candidates = stated.length ? stated
      : (model.card && model.card.expiry ? [model.card] : []);

    candidates.sort(function (a, b) {
      return (a.expiry.year * 12 + a.expiry.month) - (b.expiry.year * 12 + b.expiry.month);
    });

    var card = candidates[0];
    if (card) {
      var expEnd = new Date(card.expiry.year, card.expiry.month, 0); // last day of month
      var days = Math.round((expEnd - now) / 86400000);
      var when = formatMonthYear(card.expiry.month, card.expiry.year);
      var tail = card.last4 ? ' ending ' + card.last4 : '';

      if (days < 0) {
        alerts.push({
          priority: 2, tone: 'urgent', iconName: 'card', type: 'card_expired',
          title: 'The card on file has expired',
          text: 'The card' + tail + ' expired in ' + when +
                '. Adding a current card keeps your support going.',
          action: { text: 'Update card', gadget: 'PLEDGE' }
        });
      } else if (days <= CFG.expirySoonDays) {
        alerts.push({
          priority: 3, tone: 'notice', iconName: 'card', type: 'card_expiring',
          title: 'Your card expires in ' + days + (days === 1 ? ' day' : ' days'),
          text: 'The card' + tail + ' expires in ' + when +
                '. You can update it now so nothing is interrupted.',
          action: { text: 'Update card', gadget: 'PLEDGE' }
        });
      }
    }

    alerts.sort(function (a, b) { return a.priority - b.priority; });
    return alerts.slice(0, 1);
  }

  /* --------------------------------------------------------------------------
     Upgrade offer (build spec B6)

     The percentage is always derived from the displayed amounts. A hardcoded
     "10%" is only true for a donor giving exactly the round number the copy
     was written against, which is why this is computed.

     Wording is "increases your support", not "increases your impact" —
     percentage-of-dollars is defensible without a Fundraising sign-off; a
     quantified impact claim is not.
     -------------------------------------------------------------------------- */

  function buildUpgrade(model, alertShowing) {
    var u = CFG.upgrade;
    if (!u.enabled) return null;

    // Suppressed while an alert is showing, so the donor is never asked for
    // more in the same breath as being told something is wrong.
    if (alertShowing) return null;

    if (!model.pledge || model.pledge.status !== 'active') return null;
    var gifts = model.pledge.gifts || [];
    // With more than one commitment there is no single "current amount" to
    // ladder from, so no offer.
    if (gifts.length !== 1) return null;

    var g = gifts[0];
    var A = g.amount;
    if (typeof A !== 'number' || !isFinite(A) || A <= 0) return null;
    if (A > u.amountCeiling) return null;

    var uplift = Math.min(Math.max(Math.round(A * u.rate), u.floor), u.cap);
    var newAmt = A + uplift;
    var pctShown = Math.round(uplift / A * 100);
    if (pctShown > u.maxPct) return null;

    return {
      uplift: uplift, newAmt: newAmt, pct: pctShown, currency: g.currency,
      title: 'An additional ' + formatMoney(uplift, g.currency, true) +
             '/month increases your support by ' + pctShown + '%',
      text: 'You can change or reverse it at any time.',
      buttonText: 'Give ' + formatMoney(newAmt, g.currency, true) + '/month'
    };
  }

  /* ==========================================================================
     Chart — giving over the last 12 months

     One series, so one hue and no legend: the card heading names the series.
     Grid recessive, values labelled selectively, 4px rounded data-ends
     anchored to the baseline, 2px gap between fills. A table view is always
     available, so the data never depends on colour.
     ========================================================================== */

  var SVGNS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, String(attrs[k]));
      }
    }
    return n;
  }

  function niceStep(max, targetTicks) {
    var rough = max / (targetTicks || 3);
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var candidates = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] * mag >= rough) return candidates[i] * mag;
    }
    return 10 * mag;
  }

  /* Rounded-top bar, square where it meets the baseline. */
  function barPath(x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h));
    var y0 = y + h;
    return 'M' + x + ' ' + y0 +
      'L' + x + ' ' + (y + rr) +
      'Q' + x + ' ' + y + ' ' + (x + rr) + ' ' + y +
      'L' + (x + w - rr) + ' ' + y +
      'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + rr) +
      'L' + (x + w) + ' ' + y0 + 'Z';
  }

  /* Last 12 months, oldest first, zero-filled. */
  function monthSeries(byMonthForCurrency) {
    var out = [];
    var now = new Date();
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
      out.push({
        key: key,
        date: d,
        label: formatDate(d, { month: 'short' }),
        full: formatDate(d, { month: 'long', year: 'numeric' }),
        total: byMonthForCurrency[key] || 0
      });
    }
    return out;
  }

  function renderChart(series, currency) {
    var max = 0;
    series.forEach(function (d) { if (d.total > max) max = d.total; });
    if (!(max > 0)) return null;

    var W = 760, H = 220;
    var padL = 46, padR = 8, padT = 24, padB = 34;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var step = niceStep(max, 3);
    var top = Math.ceil(max / step) * step;
    var y = function (v) { return padT + plotH - (v / top) * plotH; };

    var band = plotW / series.length;
    var barW = Math.max(6, Math.min(band - 2, 46));  // 2px surface gap
    var maxIdx = 0;
    series.forEach(function (d, i) { if (d.total === max) maxIdx = i; });

    var wrap = el('div', 'sehub-chart__wrap');
    var svg = svgEl('svg', {
      'class': 'sehub-chart__svg',
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': 'Giving over the last 12 months, in ' + (currency || 'dollars') +
        '. Highest: ' + series[maxIdx].full + ' at ' +
        formatMoney(series[maxIdx].total, currency) + '.'
    });

    var grid = svgEl('g', { 'class': 'sehub-chart__grid' });
    for (var v = 0; v <= top + 1e-9; v += step) {
      grid.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
      var lbl = svgEl('text', { 'class': 'sehub-chart__tick', x: padL - 8, y: y(v) + 4, 'text-anchor': 'end' });
      lbl.textContent = formatMoneyShort(v);
      grid.appendChild(lbl);
    }
    svg.appendChild(grid);

    var tip = el('div', 'sehub-chart__tip');
    tip.setAttribute('aria-hidden', 'true');

    series.forEach(function (d, i) {
      var cx = padL + band * i + band / 2;
      var by = y(d.total);
      var bh = padT + plotH - by;

      // Hit area first, so the CSS sibling selector can tint the bar. Bigger
      // than the mark. Pointer-only: keyboard and screen-reader users get the
      // table, so this adds no tab stop per month.
      var hit = svgEl('rect', {
        'class': 'sehub-chart__hit',
        x: padL + band * i, y: padT, width: band, height: plotH, 'aria-hidden': 'true'
      });
      hit.addEventListener('mouseenter', function () {
        tip.textContent = d.full + ' · ' + formatMoney(d.total, currency);
        tip.style.left = (cx / W * 100) + '%';
        tip.style.top = (by / H * 100) + '%';
        tip.setAttribute('data-visible', 'true');
      });
      hit.addEventListener('mouseleave', function () { tip.removeAttribute('data-visible'); });
      svg.appendChild(hit);

      if (bh > 0) {
        svg.appendChild(svgEl('path', {
          'class': 'sehub-chart__bar', d: barPath(cx - barW / 2, by, barW, bh, 4)
        }));
      }

      var xl = svgEl('text', {
        'class': 'sehub-chart__tick', x: cx, y: H - padB + 20, 'text-anchor': 'middle'
      });
      xl.textContent = d.label;
      svg.appendChild(xl);

      // Selective direct label: the peak only, never a number on every bar.
      if (i === maxIdx) {
        var vl = svgEl('text', {
          'class': 'sehub-chart__value', x: cx, y: by - 8, 'text-anchor': 'middle'
        });
        vl.textContent = formatMoney(d.total, currency);
        svg.appendChild(vl);
      }
    });

    append(wrap, svg, tip);
    return wrap;
  }

  /* Ring meter for a single ratio against a limit. Explicit track, the
     figure printed in the centre, and both values spelled out beside it, so
     the number never depends on reading an arc. */
  function renderMeter(value, limit) {
    var pct = Math.max(0, Math.min(1, limit > 0 ? value / limit : 0));
    var R = 30, C = 2 * Math.PI * R, SW = 9;

    var svg = svgEl('svg', {
      'class': 'sehub-meter', viewBox: '0 0 78 78', role: 'img',
      'aria-label': Math.round(pct * 100) + '% of your goal reached.'
    });
    svg.appendChild(svgEl('circle', {
      'class': 'sehub-meter__track', cx: 39, cy: 39, r: R, 'stroke-width': SW
    }));
    svg.appendChild(svgEl('circle', {
      'class': 'sehub-meter__fill', cx: 39, cy: 39, r: R, 'stroke-width': SW,
      'stroke-dasharray': C, 'stroke-dashoffset': C * (1 - pct),
      transform: 'rotate(-90 39 39)'
    }));
    var t = svgEl('text', {
      'class': 'sehub-meter__label', x: 39, y: 44, 'text-anchor': 'middle'
    });
    t.textContent = Math.round(pct * 100) + '%';
    svg.appendChild(t);
    return svg;
  }

  /* ==========================================================================
     Render
     ========================================================================== */

  var dash = null;
  var R = {};   // named regions we refill as data arrives

  function skeleton(region, lines) {
    clear(region);
    var s = el('div', 'sehub-skeleton');
    s.setAttribute('data-show', '');
    s.appendChild(el('div', 'sehub-skeleton__bar sehub-skeleton__bar--title'));
    for (var i = 0; i < (lines || 2); i++) {
      s.appendChild(el('div', 'sehub-skeleton__bar sehub-skeleton__bar--' +
        (i % 2 ? 'mid' : 'wide')));
    }
    region.appendChild(s);
  }

  function actionButton(label, gadget, variant, opts, iconName) {
    var b = el('button', 'sehub-btn' + (variant ? ' sehub-btn--' + variant : ''));
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName));
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', function () { openForDonor(gadget, opts || {}); });
    return b;
  }

  function buildShell(container) {
    dash = el('div', 'sehub');
    dash.id = 'sehub-dashboard';

    /* --- top bar --- */
    var bar = el('div', 'sehub-topbar');
    var brand = el('div', 'sehub-brand');
    var mark = el('div', 'sehub-brand__mark');
    if (CFG.orgMarkUrl) {
      var img = document.createElement('img');
      img.src = CFG.orgMarkUrl;
      img.alt = '';
      mark.appendChild(img);
    } else {
      mark.appendChild(icon('leaf'));
    }
    var brandText = el('div');
    append(brandText,
      el('div', 'sehub-brand__name', CFG.orgName),
      el('div', 'sehub-brand__tag', CFG.orgTagline));
    append(brand, mark, brandText);

    var acts = el('div', 'sehub-topbar__actions');
    var help = el('button', 'sehub-tblink');
    help.type = 'button';
    append(help, icon('help'), document.createTextNode('Get help'));
    help.addEventListener('click', function () {
      var target = qs('.sehub-help', dash);
      if (!target) return;
      var reduce = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      track('help_opened');
    });
    R.whoami = el('div', 'sehub-whoami');
    append(acts, help, R.whoami);
    append(bar, brand, acts);
    dash.appendChild(bar);

    /* --- hero --- */
    R.hero = el('div', 'sehub-hero');
    R.heroTitle = el('h1', null, 'Your giving');
    R.heroSub = el('p', 'sehub-hero__sub');
    append(R.hero, R.heroTitle, R.heroSub);
    dash.appendChild(R.hero);

    /* --- layout --- */
    var layout = el('div', 'sehub-layout');
    R.main = el('div', 'sehub-main');
    R.aside = el('aside', 'sehub-aside');
    R.aside.setAttribute('aria-label', 'Your details and support');
    append(layout, R.main, R.aside);
    dash.appendChild(layout);

    /* --- main regions --- */
    R.banners = el('div', 'sehub-banners');
    R.banners.setAttribute('role', 'status');
    R.banners.setAttribute('aria-live', 'polite');
    R.banners.style.display = 'flex';
    R.banners.style.flexDirection = 'column';
    R.banners.style.gap = '1rem';
    R.main.appendChild(R.banners);

    R.gift = el('div', 'sehub-card');
    R.main.appendChild(R.gift);

    R.impactHead = el('div', 'sehub-section-head');
    append(R.impactHead, icon('trend'), el('h2', null, 'Your giving at a glance'));
    R.impactHead.style.display = 'none';
    R.main.appendChild(R.impactHead);

    R.impact = el('div', 'sehub-impact');
    R.main.appendChild(R.impact);

    R.chart = el('div', 'sehub-card');
    R.chart.style.display = 'none';
    R.main.appendChild(R.chart);

    R.history = el('div', 'sehub-card');
    R.main.appendChild(R.history);

    /* --- sidebar regions --- */
    R.details = el('div', 'sehub-card');
    R.aside.appendChild(R.details);

    R.help = el('div', 'sehub-card sehub-help');
    R.aside.appendChild(R.help);

    // First child of the column, so the dashboard leads the page. EN's own
    // copy blocks are relocated into it below; the logout block stays where
    // EN put it, which is after the gadget tiles and therefore after us.
    container.insertBefore(dash, container.firstChild);

    skeleton(R.gift, 3);
    skeleton(R.history, 3);
    skeleton(R.details, 3);
  }

  function renderIdentity(model) {
    var d = model.details || {};
    var first = d.firstName || '';
    var last = d.lastName || '';

    // Who-am-I chip
    clear(R.whoami);
    var name = [first, last].filter(Boolean).join(' ');
    // Reset the display each time: this runs once before the details
    // harvest lands (when there is no name yet) and again after.
    R.whoami.style.display = name ? '' : 'none';
    if (name) {
      append(R.whoami,
        el('span', 'sehub-avatar', initials(first, last)),
        el('span', null, name));
    }

    // Hero
    R.heroTitle.textContent = first ? 'Welcome back, ' + first : 'Welcome back';

    var bits = [];
    var s = model.summary;
    if (s && s.earliest) {
      bits.push('Supporter since ' + formatDate(s.earliest,
        { year: 'numeric', month: 'long', day: 'numeric' }));
    }
    bits.push('Thank you for your generosity.');
    R.heroSub.textContent = bits.join(' · ');
  }

  function renderBanners(model) {
    clear(R.banners);

    var alerts = buildAlerts(model);
    var a = alerts[0];

    if (a) {
      var box = el('div', 'sehub-banner sehub-banner--' + a.tone);
      var ic = el('div', 'sehub-banner__icon');
      ic.appendChild(icon(a.iconName));
      var body = el('div', 'sehub-banner__body');
      append(body,
        el('div', 'sehub-banner__title', a.title),
        el('p', 'sehub-banner__text', a.text));
      var act = el('div', 'sehub-banner__action');
      var btn = actionButton(a.action.text, a.action.gadget, null,
        { source: 'alert', focusSelector: SEL.pledge.updateControl });
      btn.addEventListener('click', function () { track('alert_clicked', { alertType: a.type }); });
      act.appendChild(btn);
      append(box, ic, body, act);
      R.banners.appendChild(box);
      track('alert_shown', { alertType: a.type });
    }

    var up = buildUpgrade(model, !!a);
    if (up) {
      var ubox = el('div', 'sehub-banner sehub-banner--offer');
      var uic = el('div', 'sehub-banner__icon');
      uic.appendChild(icon('sparkle'));
      var ubody = el('div', 'sehub-banner__body');
      append(ubody,
        el('div', 'sehub-banner__title', up.title),
        el('p', 'sehub-banner__text', up.text));
      var uact = el('div', 'sehub-banner__action');
      var ubtn = actionButton(up.buttonText, 'PLEDGE', null,
        { source: 'upgrade', prefillAmount: up.newAmt });
      ubtn.appendChild(icon('external'));
      ubtn.addEventListener('click', function () {
        track('upgrade_banner_clicked', { uplift: up.uplift, pct: up.pct });
      });
      uact.appendChild(ubtn);
      append(ubox, uic, ubody, uact);
      R.banners.appendChild(ubox);
      track('upgrade_banner_shown', { uplift: up.uplift, pct: up.pct });
    }
  }

  function metaItem(iconName, label, value, sub) {
    if (!value) return null;
    var item = el('div', 'sehub-meta__item');
    var ic = el('div', 'sehub-meta__icon');
    ic.appendChild(icon(iconName));
    var t = el('div', 'sehub-meta__text');
    append(t, el('div', 'sehub-meta__label', label), el('div', 'sehub-meta__value', value));
    if (sub) t.appendChild(el('div', 'sehub-meta__sub', sub));
    append(item, ic, t);
    return item;
  }

  function renderGift(model) {
    clear(R.gift);

    var pledge = model.pledge;
    var gifts = (pledge && pledge.gifts) || [];
    var status = pledge ? pledge.status : 'unknown';
    var s = model.summary;

    if (!pledge) {
      // The gadget did not render. Say nothing about the gift; offer the
      // route through anyway, because EN's own panel still works.
      var top0 = el('div', 'sehub-gift__top');
      var ic0 = el('div', 'sehub-gift__icon'); ic0.appendChild(icon('heart'));
      var h0 = el('div', 'sehub-gift__headline');
      append(h0,
        el('div', 'sehub-gift__label', 'Your recurring gift'),
        el('div', 'sehub-gift__amount', 'View your gift'));
      append(top0, ic0, h0);
      var acts0 = el('div', 'sehub-actions');
      acts0.appendChild(actionButton('Open gift details', 'PLEDGE', null, { source: 'gift' }));
      append(R.gift, top0, acts0);
      return;
    }

    // N > 1: one block per commitment. One gift's figures are never shown
    // under another's heading, and nothing is summed across them.
    gifts.forEach(function (g, i) {
      var top = el('div', 'sehub-gift__top');
      if (i > 0) top.style.marginTop = '1.5rem';

      var ic = el('div', 'sehub-gift__icon');
      ic.appendChild(icon('heart'));

      var head = el('div', 'sehub-gift__headline');
      var label = gifts.length > 1 ? 'Recurring gift ' + (i + 1) + ' of ' + gifts.length
                                   : 'Your monthly gift';
      head.appendChild(el('div', 'sehub-gift__label', label));

      var amt = el('div', 'sehub-gift__amount');
      if (g.amount !== null && status === 'active') {
        amt.appendChild(document.createTextNode(formatMoney(g.amount, g.currency)));
        amt.appendChild(el('span', 'sehub-gift__cadence', ' / month'));
      } else if (status === 'dormant') {
        amt.textContent = 'Not active';
      } else {
        amt.textContent = g.amount !== null ? formatMoney(g.amount, g.currency) : 'Active';
      }
      head.appendChild(amt);

      var pill = el('span', 'sehub-pill' + (status === 'active' ? '' : ' sehub-pill--muted'),
        status === 'active' ? 'Active' : status === 'dormant' ? 'Paused' : 'On file');

      append(top, ic, head, pill);
      R.gift.appendChild(top);

      /* --- meta grid --- */
      var meta = el('div', 'sehub-meta');
      var card = (g.last4 || g.expiry) ? g : (gifts.length === 1 ? model.card : null);
      var dmy = { year: 'numeric', month: 'short', day: 'numeric' };

      /* Account-level facts come from the whole giving history, so they are
         only true of a single commitment. With two gifts, repeating
         "76 donations" under each would claim each gift had 76 of its own —
         so those tiles are dropped rather than duplicated, and the per-gift
         tiles keep their reading order. */
      var single = gifts.length === 1;

      append(meta,
        metaItem('repeat', 'Frequency', status === 'active' ? 'Monthly' : 'Monthly (paused)'),
        single ? metaItem('calendar', 'Start date',
          s && s.started ? formatDate(s.started, dmy) : null) : null,
        single ? metaItem('calendar', 'Last donation',
          s && s.latest ? formatDate(s.latest, dmy) : null) : null,
        metaItem('calendar', 'Next donation',
          g.nextPayment ? formatDate(g.nextPayment, dmy) : null,
          g.nextPayment ? 'Scheduled' : null),
        single ? metaItem('hash', 'Total gifts',
          s && s.complete && s.count ? s.count + (s.count === 1 ? ' donation' : ' donations') : null,
          s && s.complete && s.monthsGiving ? s.monthsGiving + ' months of giving' : null) : null,
        metaItem('card', 'Payment method',
          card && card.last4 ? 'Card •••• ' + card.last4 : null,
          card && card.expiry ? 'Exp ' + pad2(card.expiry.month) + '/' +
            String(card.expiry.year).slice(-2) : null)
      );

      if (meta.childNodes.length) R.gift.appendChild(meta);
    });

    /* --- actions ---
       Every one of these opens EN's own panel; none of them submits
       anything. Cancel is a real button at the same size and contrast as
       the rest, and reaching it takes no more steps than upgrading.

       There is no Pause control: EN's pledge gadget exposes update and
       cancel only. A pause button that silently did something else would be
       worse than its absence. */
    var acts = el('div', 'sehub-actions');
    if (status === 'dormant') {
      acts.appendChild(actionButton('Restart your gift', 'PLEDGE', null,
        { source: 'gift', focusSelector: SEL.pledge.updateControl }, 'repeat'));
    } else {
      acts.appendChild(actionButton('Change amount', 'PLEDGE', null,
        { source: 'gift', focusSelector: SEL.pledge.amountRadio }, 'pencil'));
      acts.appendChild(actionButton('Update payment', 'PLEDGE', 'outline',
        { source: 'gift' }, 'card'));
      if (!pledge || pledge.hasCancel !== false) {
        acts.appendChild(actionButton('Cancel gift', 'PLEDGE', 'quiet',
          { source: 'gift', focusSelector: SEL.pledge.cancelControl }, 'close'));
      }
    }
    R.gift.appendChild(acts);
  }

  function tile(label, values, opts) {
    opts = opts || {};
    var t = el('div', 'sehub-tile' + (opts.highlight ? ' sehub-tile--highlight' : ''));
    t.appendChild(el('div', 'sehub-tile__label', label));
    values.forEach(function (v) { t.appendChild(el('div', 'sehub-tile__value', v)); });
    return t;
  }

  function renderImpact(model) {
    clear(R.impact);
    var s = model.summary;
    var tiles = [];

    /* This year */
    if (s && s.complete && Object.keys(s.ytd).length) {
      var yt = tile('This year',
        s.currencies.filter(function (c) { return s.ytd[c]; })
          .map(function (c) { return formatMoney(s.ytd[c], c); }));
      addImpactNote(yt, s.ytd[s.currencies[0]], 'in ' + new Date().getFullYear());
      tiles.push(yt);
    }

    /* Lifetime */
    if (s && s.complete && Object.keys(s.byCurrency).length) {
      var lt = tile('Lifetime giving',
        s.currencies.map(function (c) { return formatMoney(s.byCurrency[c], c); }),
        { highlight: true });
      addImpactNote(lt, s.byCurrency[s.currencies[0]], 'since you joined');
      tiles.push(lt);
    } else if (model.enTotal && model.enTotal.length) {
      // Crawl incomplete: fall back to the figure EN itself reports rather
      // than a total derived from partial data.
      var et = tile('Lifetime giving',
        model.enTotal.map(function (m) { return formatMoney(m.amount, m.currency); }),
        { highlight: true });
      et.appendChild(el('div', 'sehub-tile__note', 'As reported on your giving history'));
      tiles.push(et);
    }

    /* Goal — only when someone has set one. See CFG.goal. */
    if (CFG.goal.enabled && CFG.goal.amount > 0 && s && s.complete) {
      var cur = s.currencies[0];
      var given = s.ytd[cur] || 0;
      var gt = tile(new Date().getFullYear() + ' giving goal',
        [formatMoney(CFG.goal.amount, cur)]);
      var row = el('div', 'sehub-goal');
      var txt = el('div', 'sehub-goal__text');
      var p1 = el('p'); p1.appendChild(el('strong', null, formatMoney(given, cur)));
      p1.appendChild(document.createTextNode(' given'));
      var p2 = el('p');
      p2.appendChild(document.createTextNode(
        formatMoney(Math.max(0, CFG.goal.amount - given), cur) + ' to go'));
      append(txt, p1, p2);
      append(row, txt, renderMeter(given, CFG.goal.amount));
      gt.appendChild(row);
      tiles.push(gt);
    }

    if (!tiles.length) { R.impactHead.style.display = 'none'; return; }
    R.impactHead.style.display = '';
    tiles.forEach(function (t) { R.impact.appendChild(t); });
  }

  /* Impact notes are only rendered when Fundraising has supplied a
     cost-per-unit. Without one there is no defensible multiplier, so the
     tile shows the money and nothing else. */
  function addImpactNote(tileEl, amount, suffix) {
    var im = CFG.impact;
    if (!im.enabled || !(im.costPerUnit > 0)) return;
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return;
    var units = Math.floor(amount / im.costPerUnit);
    if (units < 1) return;
    var noteEl = el('div', 'sehub-tile__note');
    var ic = el('div', 'sehub-tile__note-icon');
    ic.appendChild(icon('leaf'));
    var body = el('span');
    body.appendChild(el('strong', null,
      units.toLocaleString(LOCALE) + ' ' + (units === 1 ? im.unit : im.unitPlural)));
    body.appendChild(document.createTextNode(' ' + im.verb + ' ' + suffix));
    append(noteEl, ic, body);
    tileEl.appendChild(noteEl);
  }

  function renderChartCard(model) {
    var s = model.summary;
    if (!s || !s.complete || !s.currencies.length) { R.chart.style.display = 'none'; return; }

    var cur = s.currencies[0];
    var series = monthSeries(s.byMonth[cur] || {});
    var chart = renderChart(series, cur);
    if (!chart) { R.chart.style.display = 'none'; return; }

    clear(R.chart);
    R.chart.style.display = '';

    var head = el('div', 'sehub-cardhead');
    var hgroup = el('div');
    append(hgroup,
      el('h2', null, 'Giving over the last 12 months'),
      el('p', 'sehub-cardhead__sub',
        'Recurring gifts plus any one-time donations' +
        (s.currencies.length > 1 ? ', shown in ' + cur : '')));
    head.appendChild(hgroup);

    var toggle = el('button', 'sehub-btn sehub-btn--outline sehub-btn--sm', 'Show as table');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    head.appendChild(toggle);
    R.chart.appendChild(head);
    R.chart.appendChild(chart);

    // Table view, always available so the data never depends on colour.
    var table = el('table', 'sehub-table');
    table.hidden = true;
    var thead = el('thead'), hr = el('tr');
    ['Month', 'Total'].forEach(function (h, i) {
      var th = el('th', i ? 'sehub-table__num' : null, h);
      th.setAttribute('scope', 'col');
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    var tbody = el('tbody');
    series.forEach(function (d) {
      var tr = el('tr');
      var th = el('th', null, d.full);
      th.setAttribute('scope', 'row');
      tr.appendChild(th);
      tr.appendChild(el('td', 'sehub-table__num', formatMoney(d.total, cur)));
      tbody.appendChild(tr);
    });
    append(table, thead, tbody);
    var wrap = el('div', 'sehub-tablewrap');
    wrap.appendChild(table);
    R.chart.appendChild(wrap);

    toggle.addEventListener('click', function () {
      var open = table.hidden;
      table.hidden = !open;
      toggle.textContent = open ? 'Hide table' : 'Show as table';
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  function renderHistory(model, progress) {
    clear(R.history);

    var rows = (model.crawl && model.crawl.rows) || [];
    var listRows = rows.filter(function (r) {
      return !r.excluded && !r.started && r.date && r.amount !== null && r.amount > 0;
    }).sort(function (a, b) { return b.date - a.date; });

    var head = el('div', 'sehub-cardhead');
    var hgroup = el('div');
    hgroup.appendChild(el('h2', null, 'Giving history'));
    hgroup.appendChild(el('p', 'sehub-cardhead__sub',
      'Your donations to ' + CFG.orgName + '.'));
    head.appendChild(hgroup);

    // Annual statements are a staff request path, not something the hub can
    // generate. The button is only offered when we found an address to send
    // the request to.
    if (model.supportEmail) {
      var req = el('a', 'sehub-btn sehub-btn--outline sehub-btn--sm');
      req.href = 'mailto:' + model.supportEmail +
        '?subject=' + encodeURIComponent('Annual giving statement request');
      req.appendChild(icon('doc'));
      req.appendChild(document.createTextNode('Request annual statement'));
      req.addEventListener('click', function () { track('statement_requested'); });
      head.appendChild(req);
    }
    R.history.appendChild(head);

    if (!listRows.length) {
      R.history.appendChild(el('p', 'sehub-cardhead__sub',
        'Your gifts will appear here once your first donation is processed.'));
      appendProgress(R.history, progress);
      return;
    }

    var hasReceipts = listRows.some(function (r) { return r.receiptHref; });
    var showAll = false;

    var wrap = el('div', 'sehub-tablewrap');
    var table = el('table', 'sehub-table');
    var thead = el('thead'), hr = el('tr');

    var cols = [{ t: 'Date' }, { t: 'Type' }, { t: 'Method' },
                { t: 'Amount', cls: 'sehub-table__num' }];
    if (hasReceipts) cols.push({ t: 'Receipt', cls: 'sehub-table__end' });
    cols.forEach(function (c) {
      var th = el('th', c.cls || null, c.t);
      th.setAttribute('scope', 'col');
      hr.appendChild(th);
    });
    thead.appendChild(hr);

    var tbody = el('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    R.history.appendChild(wrap);

    function paint() {
      clear(tbody);
      var limit = showAll ? listRows.length : Math.min(CFG.historyRows, listRows.length);
      for (var i = 0; i < limit; i++) {
        var r = listRows[i];
        var tr = el('tr');
        var th = el('th', null, formatDate(r.date));
        th.setAttribute('scope', 'row');
        tr.appendChild(th);
        tr.appendChild(el('td', 'sehub-table__muted', r.recurring ? 'Recurring' : 'One-time'));
        tr.appendChild(el('td', 'sehub-table__muted',
          r.last4 ? 'Card •••• ' + r.last4 : '—'));
        tr.appendChild(el('td', 'sehub-table__num', formatMoney(r.amount, r.currency)));
        if (hasReceipts) {
          var td = el('td', 'sehub-table__end');
          if (r.receiptHref) {
            var a = el('a', 'sehub-iconbtn');
            a.href = r.receiptHref;
            a.setAttribute('aria-label',
              'Download receipt for ' + formatDate(r.date) + ', ' +
              formatMoney(r.amount, r.currency));
            a.appendChild(icon('download'));
            td.appendChild(a);
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }
    paint();

    if (listRows.length > CFG.historyRows) {
      var more = el('button', 'sehub-btn sehub-btn--outline sehub-btn--sm',
        'Show all ' + listRows.length + ' gifts');
      more.type = 'button';
      more.style.marginTop = '1rem';
      more.addEventListener('click', function () {
        showAll = !showAll;
        paint();
        more.textContent = showAll ? 'Show recent gifts only'
                                   : 'Show all ' + listRows.length + ' gifts';
        if (showAll) track('history_expanded', { count: listRows.length });
      });
      R.history.appendChild(more);
    }

    appendProgress(R.history, progress);
  }

  function appendProgress(region, progress) {
    if (!progress || progress.page >= progress.total) return;
    var p = el('div', 'sehub-progress');
    p.setAttribute('role', 'status');
    p.setAttribute('aria-live', 'polite');
    var tr = el('div', 'sehub-progress__track');
    var fill = el('span', 'sehub-progress__fill');
    fill.style.width = Math.round(progress.page / progress.total * 100) + '%';
    tr.appendChild(fill);
    append(p,
      el('span', null, 'Loading your full history'),
      tr,
      el('span', null, progress.page + ' of ' + progress.total));
    region.appendChild(p);
  }

  function renderDetails(model) {
    clear(R.details);
    var d = model.details || {};

    var head = el('div', 'sehub-aside__head');
    head.appendChild(el('h2', null, 'Your details'));
    var edit = el('button', 'sehub-link');
    edit.type = 'button';
    append(edit, icon('pencil'), document.createTextNode('Edit'));
    edit.addEventListener('click', function () {
      openForDonor('SUPPORTER_DETAILS', { source: 'details' });
    });
    head.appendChild(edit);
    R.details.appendChild(head);

    var list = el('ul', 'sehub-idlist');
    function row(iconName, value) {
      if (!value) return;
      var li = el('li');
      append(li, icon(iconName), el('span', null, value));
      list.appendChild(li);
    }
    row('person', [d.firstName, d.lastName].filter(Boolean).join(' '));
    row('mail', d.email);
    row('phone', d.phone);
    var place = [d.city, d.region, d.postcode].filter(Boolean).join(', ');
    row('pin', [d.address1, place, d.country].filter(Boolean).join('\n'));
    if (list.childNodes.length) R.details.appendChild(list);

    if (model.subs && model.subs.length) {
      R.details.appendChild(el('hr', 'sehub-rule'));

      var ph = el('div', 'sehub-aside__head');
      var ptitle = el('h3');
      append(ptitle, icon('bell'), document.createTextNode(' Preferences'));
      ptitle.style.display = 'flex';
      ptitle.style.alignItems = 'center';
      ptitle.style.gap = '0.5rem';
      ph.appendChild(ptitle);

      var manage = el('button', 'sehub-link', 'Manage');
      manage.type = 'button';
      manage.addEventListener('click', function () {
        openForDonor('SUPPORTER_SUBSCRIPTIONS', { source: 'preferences' });
      });
      ph.appendChild(manage);
      R.details.appendChild(ph);

      var ul = el('ul', 'sehub-prefs');
      model.subs.forEach(function (p) {
        var li = el('li');
        li.setAttribute('data-on', String(p.on));
        li.appendChild(icon(p.on ? 'check' : 'close',
          'sehub-prefs__mark sehub-prefs__mark--' + (p.on ? 'on' : 'off')));
        li.appendChild(el('span', 'sehub-prefs__name', p.name));
        // A text state as well as the glyph and the strikethrough, so the
        // state never rests on colour or decoration alone.
        li.appendChild(el('span', 'sehub-vh', p.on ? ' — on' : ' — off'));
        ul.appendChild(li);
      });
      R.details.appendChild(ul);
    }
  }

  function showStaleNotice() {
    if (!dash || qs('.sehub-stale', dash)) return;
    var box = el('div', 'sehub-stale');
    box.setAttribute('role', 'status');
    box.appendChild(icon('check'));
    box.appendChild(el('span', null,
      'Your change is saved. Reload the page to see it in this summary.'));
    var btn = el('button', 'sehub-btn sehub-btn--outline sehub-btn--sm', 'Reload');
    btn.type = 'button';
    btn.addEventListener('click', function () { window.location.reload(); });
    box.appendChild(btn);
    R.gift.appendChild(box);
  }

  /* ==========================================================================
     EN copy blocks

     EN gives the three copy blocks on this page no distinguishing class, and
     positional selectors are not allowed, so they are identified by content:
     the logout block by its logout link, the contact block by the address or
     phone number it contains, and the intro by being the block above the
     first gadget.

     The intro and contact blocks are RELOCATED into the dashboard with
     appendChild, which moves the node itself — the markup, links and text
     are untouched, and Fundraising keeps editing them in the page builder
     exactly as before. Nothing is rewritten, duplicated or removed. If a
     block cannot be identified it simply stays where EN put it.
     ========================================================================== */

  function placeCopyblocks(container, firstGadget, model) {
    var blocks = qsa(SEL.page.copyblock, container);
    if (!blocks.length) return;

    var logout = null, help = null;

    blocks.forEach(function (b) {
      if (!logout && qs('a[href*="/logout/"]', b)) { logout = b; return; }
      if (!help && (qs('.__cf_email__', b) || qs('a[href*="email-protection"]', b) ||
                    /@[a-z0-9.-]+\.[a-z]{2,}|STAND-33|1-833/i.test(text(b)))) {
        help = b;
      }
    });

    if (logout) logout.classList.add('sehub-copyblock--logout');

    if (help) {
      help.classList.add('sehub-copyblock--help');
      R.help.appendChild(el('h2', null, 'Here to help'));
      R.help.appendChild(help);                      // moves the node
      var hours = el('div', 'sehub-help__hours');
      append(hours, icon('clock'), el('span', null, CFG.supportHours));
      R.help.appendChild(hours);

      // Pick up an address for the annual-statement request, without
      // hardcoding anyone's name or address in this file.
      var mailto = qs('a[href^="mailto:"]', help);
      if (mailto) {
        model.supportEmail = mailto.getAttribute('href').replace(/^mailto:/, '').split('?')[0];
      } else {
        var m = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(text(help));
        if (m) model.supportEmail = m[0];
      }
    } else {
      R.help.style.display = 'none';
    }

    blocks.forEach(function (b) {
      if (b === logout || b === help) return;
      var before = firstGadget &&
        (b.compareDocumentPosition(firstGadget) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (before) {
        b.classList.add('sehub-copyblock--intro');
        R.hero.appendChild(b);                       // moves the node
      }
    });
  }

  /* ==========================================================================
     Boot
     ========================================================================== */

  function uncloak() { document.documentElement.classList.remove('sehub-cloak'); }

  function boot() {
    var pj = window.pageJson;

    // Boot on the Supporter Hub only, then branch. The same bundle loads on
    // all three pages, so page 2 is never assumed.
    if (!pj || pj.pageType !== 'supporterhub') { uncloak(); return; }

    track('hub_view', { pageNumber: pj.pageNumber });

    // Shared chrome hook. Set on all three hub pages so the stylesheet can
    // brand the footer, login and logout consistently — the dashboard itself
    // is gated separately on .sehub-on below.
    document.body.classList.add('sehub-branded');

    if (pj.pageNumber !== 2) { uncloak(); return; }  // pages 1 and 3: branding only

    var tiles = qsa(SEL.gadget.all);
    if (!tiles.length) { miss('gadget.all'); uncloak(); return; }

    var container = tiles[0].parentNode;
    if (!container) { miss('page.column'); uncloak(); return; }

    // Hide EN's tiles and take them out of the accessibility tree so donors
    // using a screen reader do not meet every control twice. Nothing is
    // removed, and both changes are reversible.
    document.body.classList.add('sehub-on');
    tiles.forEach(function (t) { t.setAttribute('aria-hidden', 'true'); });

    guard('shell', buildShell)(container);
    if (!dash) { uncloak(); return; }

    var model = {
      pledge: null, details: null, subs: null, crawl: null,
      summary: null, card: null, enTotal: null, supportEmail: null
    };

    guard('copyblocks', placeCopyblocks)(container, tiles[0], model);
    guard('identity', renderIdentity)(model);
    uncloak();
    health.booted = true;

    var t0 = Date.now();
    document.body.classList.add('sehub-harvesting');

    // Quick harvests first so the page reads as finished sooner; the long
    // history crawl runs last with progressive updates.
    harvest('PLEDGE', readPledge).then(function (pledge) {
      model.pledge = pledge;
      health.harvest.pledge = !!pledge;
      guard('renderGift', renderGift)(model);
      guard('renderBanners', renderBanners)(model);
    });

    harvest('SUPPORTER_DETAILS', readDetails).then(function (details) {
      model.details = details;
      health.harvest.details = !!(details && Object.keys(details).length);
      guard('identity', renderIdentity)(model);
      guard('renderDetails', renderDetails)(model);
    });

    harvest('SUPPORTER_SUBSCRIPTIONS', readSubs).then(function (subs) {
      model.subs = subs;
      health.harvest.subs = !!(subs && subs.length);
      guard('renderDetails', renderDetails)(model);
    });

    harvest('TXN_GIVING', function (overlay) {
      model.enTotal = parseAllMoney(safeText(SEL.txn.totalValue, overlay));

      // First page renders immediately; the rest fills in behind it.
      model.crawl = { rows: readHistoryRows(overlay), complete: false };
      var total = historyPageCount(overlay);
      guard('renderHistory', renderHistory)(model, { page: 1, total: total });
      guard('renderImpact', renderImpact)(model);

      return crawlHistory(overlay, function (page, tot) {
        guard('renderHistory', renderHistory)(model, { page: page, total: tot });
      });
    }).then(function (crawl) {
      health.harvest.history = !!crawl;
      if (!crawl) { guard('renderHistory', renderHistory)(model, null); return; }

      model.crawl = crawl;
      model.summary = summarise(crawl);
      model.card = model.summary.card;

      guard('identity', renderIdentity)(model);
      guard('renderHistory', renderHistory)(model, null);
      guard('renderImpact', renderImpact)(model);
      guard('renderChartCard', renderChartCard)(model);
      // Start date, gift count and card expiry only become knowable after the
      // crawl, so the gift card and banners are recomputed once here.
      guard('renderGift', renderGift)(model);
      guard('renderBanners', renderBanners)(model);

      track('prefetch_complete', {
        ms: Date.now() - t0, pagesRead: crawl.pagesRead,
        pageCount: crawl.pageCount, complete: crawl.complete
      });
    });

    queue.then(function () {
      document.body.classList.remove('sehub-harvesting');
      health.harvest.ms = Date.now() - t0;
    });
  }

  /* Exposed for manual inspection. Contains no donor data. */
  window.__hubWrapper = { version: VERSION, health: health, config: CFG };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      try { boot(); } catch (e) { uncloak(); }
    });
  } else {
    try { boot(); } catch (e) { uncloak(); }
  }
})();
