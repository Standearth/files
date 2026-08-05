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

   Vanilla ES2019. No dependencies.
   Verified against captures in ../widgets/ and ../index.html on 2026-08-05.
   ============================================================================ */

(function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ==========================================================================
     Config
     ========================================================================== */

  var CFG = {
    // Longest we wait for an EN gadget panel to render its content.
    gadgetTimeout: 9000,
    // Longest we wait for one history page to swap in.
    pageTimeout: 6000,
    // Poll interval while waiting for EN.
    pollInterval: 60,
    // Hard ceiling on history pages crawled. If a donor has more than this,
    // we stop, say so in the UI, and suppress every computed total.
    maxHistoryPages: 40,
    // Card expiry inside this many days is surfaced as information.
    expirySoonDays: 60,
    // How long we watch for an EN success response after the donor acts.
    successWatchMs: 60000
  };

  /* ==========================================================================
     Selector registry — the single source of truth.

     Every selector in this file lives here. Each entry records what it
     targets and which capture verified it. EN's gadget markup is
     undocumented and unversioned; this is the fragile boundary of the
     project, so it is all in one place.
     ========================================================================== */

  var SEL = {
    page: {
      // ENgrid wrapper and the column that holds the gadget buttons.
      // Verified: index.html, 2026-08-05
      engrid: '#engrid',
      column: '#engrid .body-main .en__component--column',
      copyblock: '.en__component--copyblock'
    },

    gadget: {
      // The clickable gadget tiles EN renders on page 2. data-componenttype
      // is EN's own stable identifier for which gadget it is.
      // Verified: index.html, 2026-08-05
      all: '.en__component--hubgadget',
      label: 'span',
      // Success flash EN writes after a gadget completes an update.
      // Verified: page-level style block in index.html, 2026-08-05
      success: '.en__hubgadget__response--success'
    },

    overlay: {
      // Panel EN injects on gadget click. One per gadget type.
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
      // Element whose presence means "this panel has finished rendering".
      // Polled rather than observed.
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

      // Amount lives in this copy block as prose, NOT in the amount radios.
      // The radios are the upgrade ladder and are pre-checked at $25 even for
      // a donor giving $1.33 — reading them would report a false amount.
      // Verified: giftview.html, 2026-08-05. This is the only route to the
      // current amount in the single-gift variant.
      currentCopy: '.en__component--copyblock--copyDonationPrevious',

      // Multi-gift variant. One <li> per recurring commitment, each carrying
      // its own amount, next payment date and card text. This is the shape
      // that must be handled for N > 1.
      // Verified: recurringgiftview.html, 2026-08-05
      listItem: '.en__hubPledge__list__item',

      // EN's own controls. We click these; we never submit anything.
      // Verified: giftview.html, 2026-08-05
      updateControl: '[data-action="update"]',
      cancelControl: '[data-action="cancel"]'
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
      lastButton: '.en__pagination__last'
    },

    details: {
      // Verified: supporterdetails.html, 2026-08-05
      field: '.en__field',
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
       element matching this selector. It exists only so every helper can
       refuse to touch it. Styling these with plain CSS is fine; touching
       them with script is what would move the account from PCI SAQ A to
       SAQ A-EP, so we do not.

       Note this deliberately includes .en__field--ccexpire and
       .en__field--ccnumberstatic even though they are readable — card
       expiry and last-four are taken from plain prose elsewhere in the
       page instead, so this whole subtree stays untouched.
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

     We have no backend, so analytics is the only monitoring channel. Every
     event below is PII-free. supporterId is never included.
     ========================================================================== */

  var health = {
    version: VERSION,
    booted: false,
    misses: [],
    harvest: {},
    notes: []
  };

  function miss(key) {
    if (health.misses.indexOf(key) === -1) health.misses.push(key);
    track('wrapper_selector_missing', { selectorKey: key });
  }

  function note(msg) {
    health.notes.push(msg);
  }

  function track(event, data) {
    try {
      var payload = { event: 'sehub_' + event };
      if (data) {
        for (var k in data) {
          if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
        }
      }
      // Guard against anything PII-shaped reaching the data layer.
      delete payload.supporterId;
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(payload);
    } catch (e) { /* analytics must never break the page */ }
  }

  /* Wrap a feature so its failure cannot stop the others. */
  function guard(name, fn) {
    return function () {
      try {
        return fn.apply(null, arguments);
      } catch (e) {
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
    try {
      return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    } catch (e) { return []; }
  }

  /* True if node is, or is inside, the card zone. */
  function inCardZone(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      return !!node.closest(SEL.cardZone);
    } catch (e) {
      return true; // if we cannot tell, assume it is card data and stand off
    }
  }

  /* querySelector that refuses to return anything in the card zone. */
  function safeQs(sel, root) {
    var found = qsa(sel, root);
    for (var i = 0; i < found.length; i++) {
      if (!inCardZone(found[i])) return found[i];
    }
    return null;
  }

  function safeQsa(sel, root) {
    return qsa(sel, root).filter(function (n) { return !inCardZone(n); });
  }

  function text(node) {
    if (!node || inCardZone(node)) return '';
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function safeText(sel, root) {
    return text(safeQs(sel, root));
  }

  function el(tag, cls, content) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content != null) n.textContent = String(content);
    return n;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /* Poll for a condition. Resolves with the value, or null on timeout.
     Used everywhere instead of MutationObserver so that no card field is
     ever placed under observation. */
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

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ==========================================================================
     Parsing

     Everything here is defensive. A value that does not parse to a positive
     finite number is discarded, and any feature that depended on it skips
     rather than showing the donor an approximation of their own generosity.
     ========================================================================== */

  var NUM = '\\d[\\d,\\u00a0 ]*(?:\\.\\d{1,2})?';
  var RE_CUR_BEFORE = new RegExp('\\b([A-Z]{3})\\s*[$£€¥]?\\s*(' + NUM + ')');
  var RE_CUR_AFTER = new RegExp('(' + NUM + ')\\s*([A-Z]{3})\\b');
  var RE_SYM_ONLY = new RegExp('([$£€¥])\\s*(' + NUM + ')');

  var SYMBOL_TO_CODE = { '$': null, '£': 'GBP', '€': 'EUR', '¥': 'JPY' };

  function toNumber(raw) {
    if (raw == null) return null;
    var cleaned = String(raw).replace(/[, \s]/g, '');
    var n = parseFloat(cleaned);
    return (typeof n === 'number' && isFinite(n) && n >= 0) ? n : null;
  }

  /* Parse the first money value in a string.
     Handles "USD$1.00", "1.33 USD", "$140.28" and "$1,234.56".
     Returns { amount, currency } or null. currency may be null when the
     string carried only a bare symbol. */
  function parseMoney(str) {
    if (!str) return null;
    var m = RE_CUR_BEFORE.exec(str);
    if (m) {
      var a = toNumber(m[2]);
      if (a !== null) return { amount: a, currency: m[1] };
    }
    m = RE_CUR_AFTER.exec(str);
    if (m) {
      var b = toNumber(m[1]);
      if (b !== null) return { amount: b, currency: m[2] };
    }
    m = RE_SYM_ONLY.exec(str);
    if (m) {
      var c = toNumber(m[2]);
      if (c !== null) return { amount: c, currency: SYMBOL_TO_CODE[m[1]] || null };
    }
    return null;
  }

  /* Parse every money value in a string — EN's "Total all time" field can
     hold one figure per currency, comma separated: "$140.28, $108.63". */
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

  /* Parse "2026-08-30" or "2026-3-23" into a local Date.
     Built from parts rather than Date.parse so it is not shifted into the
     previous day by UTC interpretation. */
  function parseDate(str) {
    if (!str) return null;
    var m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  /* Parse "expiry 08/2027" or "expiry 0827" into { month, year }.
     Two-digit years are read as 20xx. Returns null on anything ambiguous. */
  function parseExpiry(str) {
    if (!str) return null;
    var m = /expiry\s*(\d{2})\s*\/\s*(\d{2,4})/i.exec(str);
    if (!m) m = /expiry\s*(\d{2})(\d{2})\b/i.exec(str);
    if (!m) return null;
    var mo = +m[1];
    var yr = +m[2];
    if (mo < 1 || mo > 12) return null;
    if (yr < 100) yr += 2000;
    if (yr < 2000 || yr > 2100) return null;
    return { month: mo, year: yr };
  }

  /* "card ending in 0403" -> "0403" */
  function parseLast4(str) {
    var m = /ending in\s*(\d{4})/i.exec(str || '');
    return m ? m[1] : null;
  }

  /* ==========================================================================
     Formatting
     ========================================================================== */

  var LOCALE = (window.pageJson && window.pageJson.locale) || 'en-US';

  function formatMoney(amount, currency) {
    if (typeof amount !== 'number' || !isFinite(amount)) return '';
    var opts = {
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    };
    try {
      if (currency) {
        return new Intl.NumberFormat(LOCALE, {
          style: 'currency', currency: currency,
          minimumFractionDigits: opts.minimumFractionDigits,
          maximumFractionDigits: 2
        }).format(amount);
      }
      return '$' + new Intl.NumberFormat(LOCALE, opts).format(amount);
    } catch (e) {
      return '$' + amount.toFixed(2);
    }
  }

  function formatMoneyShort(amount) {
    if (typeof amount !== 'number' || !isFinite(amount)) return '';
    if (amount >= 1000) return '$' + Math.round(amount / 100) / 10 + 'k';
    return '$' + (amount % 1 === 0 ? amount : amount.toFixed(0));
  }

  function formatDate(dt, style) {
    if (!dt) return '';
    try {
      return new Intl.DateTimeFormat(LOCALE, style || {
        year: 'numeric', month: 'long', day: 'numeric'
      }).format(dt);
    } catch (e) {
      return dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate();
    }
  }

  function formatMonthYear(month, year) {
    try {
      return new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' })
        .format(new Date(year, month - 1, 1));
    } catch (e) {
      return month + '/' + year;
    }
  }

  /* ==========================================================================
     Gadget driver

     One overlay at a time, strictly serialised. Opening is always done by
     clicking EN's own tile; closing by clicking EN's own close control.
     ========================================================================== */

  var queue = Promise.resolve();

  function gadgetTile(type) {
    return qs(SEL.gadget.all + '[data-componenttype="' + type + '"]');
  }

  function overlayFor(type) {
    var sel = SEL.overlay.byType[type];
    return sel ? qs(sel) : null;
  }

  /* Open a gadget and wait for its content to render. Resolves with the
     overlay element, or null if the gadget is absent or never renders. */
  function openGadget(type) {
    var tile = gadgetTile(type);
    if (!tile) {
      miss('gadget.' + type);
      return Promise.resolve(null);
    }

    var readySel = SEL.overlay.readyByType[type];
    var overlaySel = SEL.overlay.byType[type];

    // Already open and rendered.
    var existing = overlayFor(type);
    if (existing && qs(readySel, existing)) return Promise.resolve(existing);

    tile.click();
    track('gadget_open', { gadget: type, source: 'wrapper' });

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
    if (!btn) {
      note('no close control found on ' + (overlay.className || 'overlay'));
      return Promise.resolve();
    }
    btn.click();
    return until(function () {
      return !document.body.contains(overlay) ||
             overlay.offsetParent === null ? true : null;
    }, 2000).then(function () { return delay(80); });
  }

  /* Serialise a harvest: open, read, close. The reader gets the overlay and
     must return its data synchronously or as a promise. */
  function harvest(type, reader) {
    queue = queue.then(function () {
      return openGadget(type).then(function (overlay) {
        if (!overlay) return null;
        var result;
        try {
          result = reader(overlay);
        } catch (e) {
          note('harvest ' + type + ' threw: ' + (e && e.message));
          result = null;
        }
        return Promise.resolve(result).then(function (r) {
          return closeOverlay(overlay).then(function () { return r; });
        }, function () {
          return closeOverlay(overlay).then(function () { return null; });
        });
      });
    });
    return queue;
  }

  /* Hand an action to EN: reveal the overlay and click EN's tile. */
  function openForDonor(type) {
    document.body.classList.remove('sehub-harvesting');
    var tile = gadgetTile(type);
    if (!tile) {
      miss('gadget.' + type);
      return;
    }
    track('gadget_open', { gadget: type, source: 'donor' });
    tile.click();
    watchForSuccess();
  }

  /* After the donor acts, watch for EN's success flash so we can tell them
     the summary is now out of date. We deliberately do not re-open the gift
     panel to re-read it — that panel holds card fields, and reloading is
     both honest and cheap. */
  var successWatching = false;
  function watchForSuccess() {
    if (successWatching) return;
    successWatching = true;
    until(function () {
      return qs(SEL.gadget.success) ? true : null;
    }, CFG.successWatchMs).then(function (found) {
      successWatching = false;
      if (found) {
        track('update_completed');
        showStaleNotice();
      }
    });
  }

  /* ==========================================================================
     Harvesters
     ========================================================================== */

  /* --- Recurring gift ---------------------------------------------------- */

  /* Returns { gifts: [...], status, source } or null.
     Handles both the single-gift state variant and the multi-gift list
     variant, so a donor with two commitments never has one gift's figures
     attributed to the other. */
  function readPledge(overlay) {
    var gifts = [];

    // Multi-gift list variant first — it is the more explicit markup.
    var items = safeQsa(SEL.pledge.listItem, overlay);
    if (items.length) {
      items.forEach(function (li) {
        var t = text(li);
        var money = parseMoney(t);
        var next = parseDate(t);
        gifts.push({
          id: li.getAttribute('data-recurringtxnid') || null,
          amount: money ? money.amount : null,
          currency: money ? money.currency : null,
          nextPayment: next,
          last4: parseLast4(t),
          expiry: parseExpiry(t),
          active: true
        });
      });
      return { gifts: gifts, status: gifts.length ? 'active' : 'none', source: 'list' };
    }

    // Single-gift state variant.
    var state = safeQs(SEL.pledge.state, overlay);
    if (!state) {
      miss('pledge.state');
      return null;
    }

    var cls = state.className || '';
    var status = cls.indexOf(SEL.pledge.stateActive) !== -1 ? 'active'
      : cls.indexOf(SEL.pledge.stateDormant) !== -1 ? 'dormant'
      : 'unknown';

    // Amount comes from the prose copy block, never from the amount radios.
    var copy = safeText(SEL.pledge.currentCopy, overlay);
    if (!copy) miss('pledge.currentCopy');
    var money = parseMoney(copy);

    gifts.push({
      id: null,
      amount: money ? money.amount : null,
      currency: money ? money.currency : null,
      nextPayment: parseDate(copy),
      last4: null,   // taken from history prose instead; card zone untouched
      expiry: null,  // ditto
      active: status === 'active'
    });

    return { gifts: gifts, status: status, source: 'state' };
  }

  /* --- Giving history --------------------------------------------------- */

  function readHistoryRows(overlay) {
    return safeQsa(SEL.txn.row, overlay).map(function (li) {
      var head = text(safeQs(SEL.txn.rowHeader, li));
      var pay = text(safeQs(SEL.txn.rowPayment, li));
      var money = parseMoney(head);
      var cls = li.className || '';
      var all = head + ' ' + pay;
      return {
        raw: all,
        date: parseDate(head),
        amount: money ? money.amount : null,
        currency: money ? money.currency : null,
        recurring: cls.indexOf(SEL.txn.rowRecurring) !== -1,
        started: /you started/i.test(head),
        last4: parseLast4(pay),
        expiry: parseExpiry(pay),
        // Rows we must not count. We have no capture of a refunded or
        // rejected row, so this matches on wording and is deliberately
        // broad — a miscount is worse than an exclusion.
        excluded: /refund|reject|declin|fail|charge\s*back|reversed|void/i.test(all)
      };
    });
  }

  function historyPageCount(overlay) {
    var last = safeQs(SEL.txn.lastButton, overlay);
    var n = last ? parseInt(last.getAttribute('data-page'), 10) : NaN;
    if (isFinite(n) && n > 0) return n;
    var pages = safeQsa(SEL.txn.pageButton, overlay).map(function (b) {
      return parseInt(b.getAttribute('data-page'), 10);
    }).filter(isFinite);
    return pages.length ? Math.max.apply(null, pages) : 1;
  }

  function rowSignature(overlay) {
    var first = safeQs(SEL.txn.row, overlay);
    return first ? text(first).slice(0, 120) : '';
  }

  /* Click through every page of the giving history, reporting progress.
     Returns { rows, pagesRead, pageCount, complete }.

     complete is false if we hit the page ceiling, a page failed to swap, or
     any row's amount would not parse. Nothing derived from an incomplete
     crawl is ever shown as a total. */
  function crawlHistory(overlay, onProgress) {
    var rows = readHistoryRows(overlay);
    var pageCount = historyPageCount(overlay);
    var seen = {};
    rows.forEach(function (r) { seen[r.raw] = true; });

    var limit = Math.min(pageCount, CFG.maxHistoryPages);
    var truncated = pageCount > CFG.maxHistoryPages;
    var pagesRead = 1;
    var stalled = false;

    if (truncated) {
      note('history has ' + pageCount + ' pages, ceiling is ' +
           CFG.maxHistoryPages + ' — totals suppressed');
      track('history_truncated', { pageCount: pageCount, ceiling: CFG.maxHistoryPages });
    }

    if (onProgress) onProgress(1, limit);

    function step(page) {
      if (page > limit || stalled) return Promise.resolve();

      // Re-query every iteration: EN re-renders the pagination strip, and
      // it is windowed, so the numbered button for a distant page may not
      // exist. Fall back to "next".
      var btn = safeQsa(SEL.txn.pageButton, overlay).filter(function (b) {
        return parseInt(b.getAttribute('data-page'), 10) === page && !b.disabled;
      })[0];

      if (!btn) {
        btn = safeQsa(SEL.txn.nextButton, overlay).filter(function (b) {
          return !b.disabled;
        })[0];
      }

      if (!btn) {
        stalled = true;
        note('history pagination ran out at page ' + page + ' of ' + limit);
        return Promise.resolve();
      }

      var before = rowSignature(overlay);
      btn.click();

      return until(function () {
        var now = rowSignature(overlay);
        return (now && now !== before) ? now : null;
      }, CFG.pageTimeout).then(function (changed) {
        if (!changed) {
          stalled = true;
          note('history page ' + page + ' did not load within ' + CFG.pageTimeout + 'ms');
          return;
        }
        readHistoryRows(overlay).forEach(function (r) {
          if (!seen[r.raw]) { seen[r.raw] = true; rows.push(r); }
        });
        pagesRead = page;
        if (onProgress) onProgress(page, limit);
        return step(page + 1);
      });
    }

    return step(2).then(function () {
      var counted = rows.filter(function (r) { return !r.excluded; });
      var unparsed = counted.filter(function (r) { return r.amount === null; }).length;
      if (unparsed) {
        note(unparsed + ' history rows had an unreadable amount — totals suppressed');
        track('history_unparsed_rows', { count: unparsed });
      }
      return {
        rows: rows,
        pagesRead: pagesRead,
        pageCount: pageCount,
        complete: !stalled && !truncated && unparsed === 0
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
    var byCurrency = {};
    var byYear = {};
    var counted = 0;
    var earliest = null;
    var latest = null;
    var thisYear = new Date().getFullYear();
    var ytd = {};

    crawl.rows.forEach(function (r) {
      if (r.excluded) return;
      if (r.amount === null || r.amount === 0) return;
      if (r.started) return;

      var cur = r.currency || 'USD';
      byCurrency[cur] = (byCurrency[cur] || 0) + r.amount;
      counted++;

      if (r.date) {
        var y = r.date.getFullYear();
        byYear[cur] = byYear[cur] || {};
        byYear[cur][y] = (byYear[cur][y] || 0) + r.amount;
        if (!earliest || r.date < earliest) earliest = r.date;
        if (!latest || r.date > latest) latest = r.date;
        if (y === thisYear) ytd[cur] = (ytd[cur] || 0) + r.amount;
      }
    });

    // Most recent card detail, from prose only.
    var card = null;
    var dated = crawl.rows.filter(function (r) { return r.date && r.last4; })
      .sort(function (a, b) { return b.date - a.date; });
    if (dated.length) {
      card = { last4: dated[0].last4, expiry: dated[0].expiry };
    }

    return {
      byCurrency: byCurrency,
      byYear: byYear,
      ytd: ytd,
      count: counted,
      earliest: earliest,
      latest: latest,
      card: card,
      complete: crawl.complete
    };
  }

  /* --- Personal details ------------------------------------------------- */

  function readDetails(overlay) {
    var out = {};
    Object.keys(SEL.details.byName).forEach(function (key) {
      var field = safeQs(SEL.details.byName[key], overlay);
      if (!field) return;
      var input = safeQs(SEL.details.input, field);
      if (!input) return;
      var v = '';
      if (input.tagName === 'SELECT') {
        var opt = input.options[input.selectedIndex];
        v = opt ? opt.text : '';
      } else {
        v = input.value || '';
      }
      v = v.trim();
      if (v) out[key] = v;
    });
    if (!Object.keys(out).length) miss('details.fields');
    return out;
  }

  /* --- Communication preferences ---------------------------------------- */

  function readSubs(overlay) {
    var boxes = safeQsa(SEL.subs.checkbox, overlay);
    if (!boxes.length) {
      miss('subs.checkbox');
      return null;
    }
    return boxes.map(function (box) {
      var label = box.id ? qs('label[for="' + cssEscape(box.id) + '"]', overlay) : null;
      if (!label) label = safeQs(SEL.subs.itemLabel, box.parentNode);
      // First line only — several of these labels carry a paragraph of
      // legal small print underneath, which is not a preference name.
      var full = text(label);
      var first = full.split(/(?:\.\s|\sBy submitting|\sOnce a month)/)[0];
      return {
        name: (first || full).replace(/\s*\(untick.*$/i, '').trim(),
        on: !!box.checked
      };
    }).filter(function (p) { return p.name; });
  }

  function cssEscape(v) {
    if (window.CSS && CSS.escape) return CSS.escape(v);
    return String(v).replace(/([.:#\[\]$])/g, '\\$1');
  }

  /* ==========================================================================
     Alerts

     Derived only from state visible in the DOM. One banner, highest priority
     only. Neutral wording: an upcoming expiry is information, not an
     emergency.

     NOT BUILT: payment-failed and gift-on-hold banners. Neither state is
     distinguishable in the captured markup — the failure copy block is
     present in the DOM whether or not a payment failed, so keying off it
     would tell donors their gift had failed when it had not. Recorded as a
     gap rather than guessed at.
     ========================================================================== */

  function buildAlerts(model) {
    var alerts = [];
    var now = new Date();

    if (model.pledge && model.pledge.status === 'dormant') {
      alerts.push({
        priority: 1,
        tone: 'info',
        icon: 'pause',
        label: 'Your monthly gift is not active',
        text: 'Your recurring gift is on file but is not currently being collected. ' +
              'You can restart it whenever you are ready.',
        action: { text: 'Restart your gift', gadget: 'PLEDGE' },
        type: 'gift_dormant'
      });
    }

    var card = model.card;
    if (card && card.expiry) {
      // Last day of the expiry month.
      var expEnd = new Date(card.expiry.year, card.expiry.month, 0);
      var days = Math.round((expEnd - now) / 86400000);
      var when = formatMonthYear(card.expiry.month, card.expiry.year);
      var tail = card.last4 ? ' ending ' + card.last4 : '';

      if (days < 0) {
        alerts.push({
          priority: 2,
          tone: 'urgent',
          icon: 'card',
          label: 'The card on file has expired',
          text: 'The card' + tail + ' expired in ' + when +
                '. Adding a current card keeps your support going.',
          action: { text: 'Update your card', gadget: 'PLEDGE' },
          type: 'card_expired'
        });
      } else if (days <= CFG.expirySoonDays) {
        alerts.push({
          priority: 3,
          tone: 'info',
          icon: 'card',
          label: 'The card on file expires soon',
          text: 'The card' + tail + ' expires in ' + when +
                '. You can update it now so nothing is interrupted.',
          action: { text: 'Update your card', gadget: 'PLEDGE' },
          type: 'card_expiring'
        });
      }
    }

    alerts.sort(function (a, b) { return a.priority - b.priority; });
    return alerts.slice(0, 1);
  }

  var ICONS = {
    pause: 'M9 5h2v14H9zM13 5h2v14h-2z',
    card: 'M3 6h18v3H3zM3 11h18v7H3zm2 3h5v2H5z',
    check: 'M9.6 16.6 4.9 12l1.4-1.4 3.3 3.3 7.9-7.9L18.9 7z',
    cross: 'M18 7.4 16.6 6 12 10.6 7.4 6 6 7.4 10.6 12 6 16.6 7.4 18 12 13.4 16.6 18 18 16.6 13.4 12z'
  };

  function icon(name, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'currentColor');
    if (cls) svg.setAttribute('class', cls);
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name] || '');
    svg.appendChild(path);
    return svg;
  }

  /* ==========================================================================
     Chart — giving by year

     One series, so one hue and no legend: the heading names the series.
     Grid recessive, values labelled selectively rather than on every bar,
     4px rounded data-ends anchored to the baseline, 2px gap between fills.
     A table view is always available, so the data never depends on colour.
     ========================================================================== */

  var SVGNS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          n.setAttribute(k, String(attrs[k]));
        }
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

  /* Rounded-top bar path, square where it meets the baseline. */
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

  function renderChart(series, currency) {
    // series: [{ year, total }] ascending. Below two points a chart says
    // nothing a stat tile does not say better.
    if (!series || series.length < 2) return null;

    var W = 720, H = 210;
    var padL = 48, padR = 10, padT = 22, padB = 30;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var max = 0;
    series.forEach(function (d) { if (d.total > max) max = d.total; });
    if (!(max > 0)) return null;

    var step = niceStep(max, 3);
    var top = Math.ceil(max / step) * step;
    var y = function (v) { return padT + plotH - (v / top) * plotH; };

    var band = plotW / series.length;
    var barW = Math.max(6, Math.min(band - 2, 56)); // 2px surface gap
    var maxIdx = 0;
    series.forEach(function (d, i) { if (d.total === max) maxIdx = i; });

    var wrap = el('div', 'sehub-chart__wrap');
    var svg = svgEl('svg', {
      'class': 'sehub-chart__svg',
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img'
    });

    var summary = 'Giving by year in ' + (currency || 'dollars') + ', ' +
      series[0].year + ' to ' + series[series.length - 1].year +
      '. Highest: ' + series[maxIdx].year + ' at ' +
      formatMoney(series[maxIdx].total, currency) + '.';
    svg.setAttribute('aria-label', summary);

    // Grid + y labels
    var grid = svgEl('g', { 'class': 'sehub-chart__grid' });
    for (var v = 0; v <= top + 1e-9; v += step) {
      grid.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
      var lbl = svgEl('text', {
        'class': 'sehub-chart__tick', x: padL - 8, y: y(v) + 4, 'text-anchor': 'end'
      });
      lbl.textContent = formatMoneyShort(v);
      grid.appendChild(lbl);
    }
    svg.appendChild(grid);

    // Bars, hit areas and x labels
    var tip = el('div', 'sehub-chart__tip');
    tip.setAttribute('aria-hidden', 'true');

    series.forEach(function (d, i) {
      var cx = padL + band * i + band / 2;
      var bx = cx - barW / 2;
      var by = y(d.total);
      var bh = padT + plotH - by;

      // Hit area first so the CSS sibling selector can tint the bar.
      // Pointer-only: keyboard and screen-reader users get the table view,
      // so this does not add a tab stop per year.
      var hit = svgEl('rect', {
        'class': 'sehub-chart__hit',
        x: padL + band * i, y: padT, width: band, height: plotH,
        'aria-hidden': 'true'
      });
      hit.addEventListener('mouseenter', function () {
        tip.textContent = d.year + ' · ' + formatMoney(d.total, currency);
        tip.style.left = (cx / W * 100) + '%';
        tip.style.top = (by / H * 100) + '%';
        tip.setAttribute('data-visible', 'true');
      });
      hit.addEventListener('mouseleave', function () {
        tip.removeAttribute('data-visible');
      });
      svg.appendChild(hit);

      svg.appendChild(svgEl('path', {
        'class': 'sehub-chart__bar',
        d: barPath(bx, by, barW, bh, 4)
      }));

      var xl = svgEl('text', {
        'class': 'sehub-chart__tick',
        x: cx, y: H - padB + 18, 'text-anchor': 'middle'
      });
      xl.textContent = String(d.year);
      svg.appendChild(xl);

      // Selective direct label: the peak only.
      if (i === maxIdx) {
        var vl = svgEl('text', {
          'class': 'sehub-chart__value',
          x: cx, y: by - 7, 'text-anchor': 'middle'
        });
        vl.textContent = formatMoney(d.total, currency);
        svg.appendChild(vl);
      }
    });

    // Baseline
    svg.appendChild(svgEl('line', {
      'class': 'sehub-chart__baseline',
      x1: padL, x2: W - padR, y1: y(0), y2: y(0)
    }));

    wrap.appendChild(svg);
    wrap.appendChild(tip);
    return wrap;
  }

  function renderChartTable(series, currency) {
    var table = el('table', 'sehub-table');
    var cap = el('caption', null, 'Your giving by year, in ' + (currency || 'dollars') + '.');
    table.appendChild(cap);

    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', null, 'Year'));
    hr.appendChild(el('th', null, 'Total'));
    qsa('th', hr).forEach(function (th) { th.setAttribute('scope', 'col'); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    series.forEach(function (d) {
      var tr = el('tr');
      var th = el('th', null, String(d.year));
      th.setAttribute('scope', 'row');
      tr.appendChild(th);
      tr.appendChild(el('td', null, formatMoney(d.total, currency)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  /* ==========================================================================
     Render
     ========================================================================== */

  var dash = null;   // our root element
  var regions = {};  // named slots we refill as data arrives

  function buildShell(container, firstGadget) {
    dash = el('div', 'sehub');
    dash.id = 'sehub-dashboard';

    regions.alerts = el('div', 'sehub-alerts');
    regions.alerts.setAttribute('role', 'status');
    regions.alerts.setAttribute('aria-live', 'polite');
    dash.appendChild(regions.alerts);

    regions.gift = el('div', 'sehub-card sehub-gift-card');
    dash.appendChild(regions.gift);

    regions.stats = el('div', 'sehub-stats');
    dash.appendChild(regions.stats);

    var giving = el('section', 'sehub__section');
    var gh = el('div', 'sehub__section-head');
    var gh2 = el('h2', null, 'Your giving');
    gh.appendChild(gh2);
    regions.givingNote = el('span', 'sehub__section-note');
    gh.appendChild(regions.givingNote);
    giving.appendChild(gh);
    regions.giving = el('div');
    giving.appendChild(regions.giving);
    dash.appendChild(giving);

    var acct = el('section', 'sehub__section');
    var ah = el('div', 'sehub__section-head');
    ah.appendChild(el('h2', null, 'Your account'));
    acct.appendChild(ah);
    regions.account = el('div', 'sehub-grid-2');
    acct.appendChild(regions.account);
    dash.appendChild(acct);

    // Inserted before the first gadget tile. That alone puts the reading
    // order at greeting -> alerts -> gift -> giving -> account -> contact ->
    // logout, with no DOM node moved and no positional selector used.
    container.insertBefore(dash, firstGadget);

    // Placeholders so the layout does not jump as each harvest lands.
    skeleton(regions.gift, 'gift');
    skeleton(regions.giving, 'block');
    skeleton(regions.account, 'pair');
  }

  function skeleton(region, kind) {
    clear(region);
    region.setAttribute('data-sehub-loading', 'true');
    var n = kind === 'pair' ? 2 : 1;
    for (var i = 0; i < n; i++) {
      var s = el('div', 'sehub-skeleton');
      s.style.display = 'block';
      s.appendChild(el('div', 'sehub-skeleton__bar sehub-skeleton__bar--title'));
      s.appendChild(el('div', 'sehub-skeleton__bar sehub-skeleton__bar--wide'));
      s.appendChild(el('div', 'sehub-skeleton__bar sehub-skeleton__bar--mid'));
      region.appendChild(s);
    }
  }

  function ready(region) {
    if (region) region.removeAttribute('data-sehub-loading');
  }

  function actionButton(label, gadget, variant) {
    var b = el('button', 'sehub-btn' + (variant ? ' sehub-btn--' + variant : ''), label);
    b.type = 'button';
    b.addEventListener('click', function () { openForDonor(gadget); });
    return b;
  }

  function renderAlerts(alerts) {
    clear(regions.alerts);
    if (!alerts.length) return;
    var a = alerts[0];

    var box = el('div', 'sehub-alert sehub-alert--' + a.tone);
    box.appendChild(icon(a.icon, 'sehub-alert__icon'));

    var body = el('div', 'sehub-alert__body');
    body.appendChild(el('strong', 'sehub-alert__label', a.label));
    body.appendChild(el('p', 'sehub-alert__text', a.text));

    if (a.action) {
      var wrap = el('div', 'sehub-alert__action');
      var btn = actionButton(a.action.text, a.action.gadget);
      btn.addEventListener('click', function () {
        track('alert_clicked', { alertType: a.type });
      });
      wrap.appendChild(btn);
      body.appendChild(wrap);
    }

    box.appendChild(body);
    regions.alerts.appendChild(box);
    track('alert_shown', { alertType: a.type });
  }

  function renderGift(model) {
    var region = regions.gift;
    clear(region);
    ready(region);

    var pledge = model.pledge;
    var gifts = (pledge && pledge.gifts) || [];
    var status = pledge ? pledge.status : 'unknown';

    var grid = el('div', 'sehub-gift');
    var main = el('div');
    var actions = el('div', 'sehub-gift__actions');

    if (!pledge) {
      // The gadget did not render. Say nothing about the gift, offer the
      // route through anyway — EN's own panel still works.
      grid.className = 'sehub-gift sehub-gift--none';
      main.appendChild(el('p', 'sehub-gift__label', 'Your recurring gift'));
      main.appendChild(el('p', 'sehub-gift__amount', 'View your gift'));
      main.appendChild(el('p', 'sehub-gift__meta-item',
        'Open your gift details to review or change your recurring donation.'));
      actions.appendChild(actionButton('Open gift details', 'PLEDGE'));
    } else if (status === 'active' && gifts.length) {
      renderActiveGifts(grid, main, actions, gifts, model);
    } else if (status === 'dormant') {
      grid.className = 'sehub-gift sehub-gift--dormant';
      main.appendChild(el('p', 'sehub-gift__label', 'Your recurring gift'));
      main.appendChild(el('p', 'sehub-gift__amount', 'Not active right now'));
      var prev = gifts[0];
      if (prev && prev.amount) {
        main.appendChild(el('p', 'sehub-gift__meta-item',
          'Your last recurring gift was ' +
          formatMoney(prev.amount, prev.currency) + ' a month.'));
      }
      actions.appendChild(actionButton('Restart your gift', 'PLEDGE'));
    } else {
      grid.className = 'sehub-gift sehub-gift--none';
      main.appendChild(el('p', 'sehub-gift__label', 'Monthly giving'));
      main.appendChild(el('p', 'sehub-gift__amount', 'Become a monthly supporter'));
      main.appendChild(el('p', 'sehub-gift__meta-item',
        'Monthly gifts let us plan campaigns further ahead.'));
      actions.appendChild(actionButton('Start a monthly gift', 'PLEDGE'));
    }

    grid.appendChild(main);
    grid.appendChild(actions);
    region.appendChild(grid);
  }

  function renderActiveGifts(grid, main, actions, gifts, model) {
    // N > 1 is rendered as N blocks. One gift's figures are never shown
    // under another's heading, and nothing is summed across them.
    main.appendChild(el('p', 'sehub-gift__label',
      gifts.length > 1 ? 'Your ' + gifts.length + ' recurring gifts'
                       : 'Your recurring gift'));

    gifts.forEach(function (g, i) {
      var block = el('div');
      if (i > 0) block.style.marginTop = '1.5rem';

      if (g.amount !== null) {
        var amt = el('p', 'sehub-gift__amount');
        amt.appendChild(document.createTextNode(formatMoney(g.amount, g.currency)));
        amt.appendChild(el('span', 'sehub-gift__cadence', ' a month'));
        block.appendChild(amt);
      } else {
        block.appendChild(el('p', 'sehub-gift__amount', 'Active'));
      }

      var meta = el('div', 'sehub-gift__meta');

      if (g.nextPayment) {
        var d1 = el('div', 'sehub-gift__meta-item');
        d1.appendChild(el('strong', null, 'Next payment'));
        d1.appendChild(document.createTextNode(formatDate(g.nextPayment)));
        meta.appendChild(d1);
      }

      // Card detail comes from the gift list prose when EN provides it, and
      // otherwise from the most recent history row. Never from a card field.
      var card = (g.last4 || g.expiry) ? g : (gifts.length === 1 ? model.card : null);
      if (card && card.last4) {
        var d2 = el('div', 'sehub-gift__meta-item');
        d2.appendChild(el('strong', null, 'Card'));
        var t = 'Ending ' + card.last4;
        if (card.expiry) {
          t += ' · expires ' + String(card.expiry.month).padStart(2, '0') +
               '/' + card.expiry.year;
        }
        d2.appendChild(document.createTextNode(t));
        meta.appendChild(d2);
      }

      if (meta.childNodes.length) block.appendChild(meta);
      main.appendChild(block);
    });

    actions.appendChild(actionButton('Manage your gift', 'PLEDGE'));
    actions.appendChild(actionButton('Update your card', 'PLEDGE', 'secondary'));
  }

  function renderStats(model) {
    var region = regions.stats;
    clear(region);

    var s = model.summary;
    var tiles = [];

    // Lifetime total. Only shown from a complete, fully parsed crawl. If the
    // crawl fell short we show EN's own reported figure instead of a number
    // we derived from partial data.
    if (s && s.complete && Object.keys(s.byCurrency).length) {
      tiles.push({
        label: 'Total given',
        values: Object.keys(s.byCurrency).sort().map(function (cur) {
          return formatMoney(s.byCurrency[cur], cur);
        }),
        sub: 'Across ' + s.count + (s.count === 1 ? ' gift' : ' gifts')
      });
    } else if (model.enTotal && model.enTotal.length) {
      tiles.push({
        label: 'Total given',
        values: model.enTotal.map(function (m) {
          return formatMoney(m.amount, m.currency);
        }),
        sub: 'As reported on your giving history'
      });
    }

    if (s && s.complete && Object.keys(s.ytd).length) {
      tiles.push({
        label: 'This year',
        values: Object.keys(s.ytd).sort().map(function (cur) {
          return formatMoney(s.ytd[cur], cur);
        }),
        sub: String(new Date().getFullYear())
      });
    }

    if (s && s.earliest) {
      var years = new Date().getFullYear() - s.earliest.getFullYear();
      tiles.push({
        label: 'Supporter since',
        values: [String(s.earliest.getFullYear())],
        sub: years >= 1 ? years + (years === 1 ? ' year' : ' years') + ' of support'
                        : 'Thank you for joining us'
      });
    }

    if (!tiles.length) return;

    tiles.forEach(function (t) {
      var tile = el('div', 'sehub-stat');
      tile.appendChild(el('div', 'sehub-stat__label', t.label));
      t.values.forEach(function (v) {
        tile.appendChild(el('div', 'sehub-stat__value', v));
      });
      if (t.sub) tile.appendChild(el('div', 'sehub-stat__sub', t.sub));
      region.appendChild(tile);
    });
  }

  function renderGiving(model, progress) {
    var region = regions.giving;
    clear(region);
    ready(region);

    var s = model.summary;
    var rows = (model.crawl && model.crawl.rows) || [];

    // Progress line while the crawl is still running.
    if (progress && progress.page < progress.total) {
      var p = el('div', 'sehub-progress');
      p.setAttribute('role', 'status');
      p.setAttribute('aria-live', 'polite');
      var track_ = el('div', 'sehub-progress__track');
      var fill = el('span', 'sehub-progress__fill');
      fill.style.width = Math.round(progress.page / progress.total * 100) + '%';
      track_.appendChild(fill);
      p.appendChild(el('span', null, 'Loading your full history'));
      p.appendChild(track_);
      p.appendChild(el('span', null, progress.page + ' of ' + progress.total));
      region.appendChild(p);
    }

    // Chart: only from a complete crawl, and only for the currency the donor
    // gave most in. A second currency is named in the note rather than
    // silently folded into the same bars.
    if (s && s.complete) {
      var currencies = Object.keys(s.byYear);
      if (currencies.length) {
        currencies.sort(function (a, b) { return s.byCurrency[b] - s.byCurrency[a]; });
        var primary = currencies[0];
        var series = Object.keys(s.byYear[primary])
          .map(function (y) { return { year: +y, total: s.byYear[primary][y] }; })
          .sort(function (a, b) { return a.year - b.year; });

        var chart = renderChart(series, primary);
        if (chart) {
          var box = el('div', 'sehub-chart');
          box.appendChild(chart);

          var toggle = el('button', 'sehub-btn sehub-btn--quiet sehub-table-toggle',
            'Show as table');
          toggle.type = 'button';
          var table = renderChartTable(series, primary);
          table.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
          toggle.addEventListener('click', function () {
            var open = table.hidden;
            table.hidden = !open;
            toggle.textContent = open ? 'Hide table' : 'Show as table';
            toggle.setAttribute('aria-expanded', String(open));
          });
          box.appendChild(toggle);
          box.appendChild(table);
          region.appendChild(box);

          if (currencies.length > 1) {
            regions.givingNote.textContent =
              'Chart shows ' + primary + ' gifts. You have also given in ' +
              currencies.slice(1).join(' and ') + '.';
          }
        }
      }
    } else if (model.crawl) {
      regions.givingNote.textContent =
        'Showing the gifts we could load. Totals are as reported by your giving history.';
    }

    // Recent gifts. Excluded rows are left out rather than shown greyed —
    // a refund is not a gift and does not belong in a giving list.
    var listRows = rows.filter(function (r) {
      return !r.excluded && r.date && r.amount !== null && r.amount > 0 && !r.started;
    }).sort(function (a, b) { return b.date - a.date; });

    if (!listRows.length) {
      var empty = el('p', 'sehub-gift__meta-item',
        'Your gifts will appear here once your first donation is processed.');
      region.appendChild(empty);
      return;
    }

    var SHOW = 8;
    var hist = el('div', 'sehub-history');
    var shown = 0;
    var currentYear = null;
    var list = null;

    function addRow(r) {
      var y = r.date.getFullYear();
      if (y !== currentYear) {
        currentYear = y;
        hist.appendChild(el('div', 'sehub-history__year', String(y)));
        list = el('ol', 'sehub-history__list');
        hist.appendChild(list);
      }
      var li = el('li', 'sehub-history__item');
      li.appendChild(el('span', 'sehub-history__date',
        formatDate(r.date, { year: 'numeric', month: 'short', day: 'numeric' })));

      var what = el('span', 'sehub-history__what');
      what.appendChild(document.createTextNode(r.recurring ? 'Monthly gift' : 'One-time gift'));
      if (r.last4) {
        what.appendChild(el('span', 'sehub-history__method', 'Card ending ' + r.last4));
      }
      li.appendChild(what);

      li.appendChild(el('span', 'sehub-history__amount',
        formatMoney(r.amount, r.currency)));
      list.appendChild(li);
    }

    for (var i = 0; i < Math.min(SHOW, listRows.length); i++) {
      addRow(listRows[i]);
      shown++;
    }
    region.appendChild(hist);

    if (listRows.length > shown) {
      var more = el('button', 'sehub-btn sehub-btn--secondary',
        'Show all ' + listRows.length + ' gifts');
      more.type = 'button';
      more.addEventListener('click', function () {
        for (var j = shown; j < listRows.length; j++) addRow(listRows[j]);
        more.parentNode.removeChild(more);
        track('history_expanded', { count: listRows.length });
      });
      var wrap = el('div');
      wrap.style.marginTop = '1rem';
      wrap.appendChild(more);
      region.appendChild(wrap);
    }
  }

  function renderAccount(model) {
    var region = regions.account;
    clear(region);
    ready(region);

    // Details
    if (model.details && Object.keys(model.details).length) {
      var d = model.details;
      var card = el('div', 'sehub-card');
      var head = el('div', 'sehub-card__head');
      head.appendChild(el('h3', null, 'Your details'));
      card.appendChild(head);

      var dl = el('dl', 'sehub-deflist');
      function pair(label, value) {
        if (!value) return;
        dl.appendChild(el('dt', null, label));
        dl.appendChild(el('dd', null, value));
      }
      var name = [d.firstName, d.lastName].filter(Boolean).join(' ');
      pair('Name', name);
      pair('Email', d.email);
      pair('Phone', d.phone);
      var place = [d.city, d.region, d.postcode].filter(Boolean).join(', ');
      pair('Address', [d.address1, place, d.country].filter(Boolean).join(' · '));
      card.appendChild(dl);

      var a = el('div');
      a.style.marginTop = '1.25rem';
      a.appendChild(actionButton('Update your details', 'SUPPORTER_DETAILS', 'secondary'));
      card.appendChild(a);
      region.appendChild(card);
    }

    // Preferences
    if (model.subs && model.subs.length) {
      var pc = el('div', 'sehub-card');
      var ph = el('div', 'sehub-card__head');
      ph.appendChild(el('h3', null, 'Email and text preferences'));
      pc.appendChild(ph);

      var ul = el('ul', 'sehub-prefs');
      model.subs.forEach(function (p) {
        var li = el('li');
        li.appendChild(icon(p.on ? 'check' : 'cross',
          'sehub-prefs__mark sehub-prefs__mark--' + (p.on ? 'on' : 'off')));
        li.appendChild(el('span', 'sehub-prefs__name', p.name));
        // Text label as well as the glyph — state never rests on colour.
        li.appendChild(el('span', 'sehub-prefs__state', p.on ? 'On' : 'Off'));
        ul.appendChild(li);
      });
      pc.appendChild(ul);
      pc.appendChild(actionButton('Update your preferences',
        'SUPPORTER_SUBSCRIPTIONS', 'secondary'));
      region.appendChild(pc);
    }

    if (!region.childNodes.length) {
      region.parentNode.style.display = 'none';
    }
  }

  function showStaleNotice() {
    if (!dash || qs('.sehub-stale', dash)) return;
    var box = el('div', 'sehub-stale');
    box.setAttribute('role', 'status');
    box.appendChild(el('span', null,
      'Your change is saved. Reload the page to see it reflected in this summary.'));
    var btn = el('button', 'sehub-btn sehub-btn--secondary', 'Reload');
    btn.type = 'button';
    btn.addEventListener('click', function () { window.location.reload(); });
    box.appendChild(btn);
    regions.gift.appendChild(box);
  }

  /* ==========================================================================
     Copyblock classification

     EN gives the three copy blocks on this page no distinguishing class, and
     positional selectors are not allowed, so they are identified by content:
     the logout block by its logout link, the contact block by the address or
     phone number it contains, and the intro by being the block above the
     first gadget. Failure to identify one is a clean skip — the block just
     keeps EN's default styling.
     ========================================================================== */

  function classifyCopyblocks(container, firstGadget) {
    var blocks = qsa(SEL.page.copyblock, container);
    if (!blocks.length) return;

    var logout = null, help = null;

    blocks.forEach(function (b) {
      if (!logout && qs('a[href*="/logout/"]', b)) { logout = b; return; }
      if (!help && (qs('.__cf_email__', b) ||
                    qs('a[href*="email-protection"]', b) ||
                    /@stand\.earth|STAND-33|1-833/i.test(text(b)))) {
        help = b;
      }
    });

    if (logout) logout.classList.add('sehub-copyblock--logout');
    if (help) help.classList.add('sehub-copyblock--help');

    blocks.forEach(function (b) {
      if (b === logout || b === help) return;
      var before = firstGadget &&
        (b.compareDocumentPosition(firstGadget) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (before) b.classList.add('sehub-copyblock--intro');
    });
  }

  /* ==========================================================================
     Boot
     ========================================================================== */

  function uncloak() {
    document.documentElement.classList.remove('sehub-cloak');
  }

  function boot() {
    var pj = window.pageJson;

    // Boot on the Supporter Hub only, then branch. The same bundle loads on
    // all three pages, so page 2 is never assumed.
    if (!pj || pj.pageType !== 'supporterhub') {
      uncloak();
      return;
    }

    track('hub_view', { pageNumber: pj.pageNumber });

    if (pj.pageNumber !== 2) {
      // Pages 1 and 3 get the stylesheet's branding and nothing else.
      uncloak();
      return;
    }

    var tiles = qsa(SEL.gadget.all);
    if (!tiles.length) {
      miss('gadget.all');
      uncloak();
      return;
    }

    var container = tiles[0].parentNode;
    if (!container) {
      miss('page.column');
      uncloak();
      return;
    }

    // Hide EN's tiles and take them out of the accessibility tree so donors
    // using a screen reader do not meet every control twice. Nothing is
    // removed, and both changes are reversible.
    document.body.classList.add('sehub-on');
    tiles.forEach(function (t) { t.setAttribute('aria-hidden', 'true'); });

    guard('copyblocks', classifyCopyblocks)(container, tiles[0]);
    guard('shell', buildShell)(container, tiles[0]);
    uncloak();
    health.booted = true;

    var model = { pledge: null, details: null, subs: null, crawl: null,
                  summary: null, card: null, enTotal: null };

    var t0 = Date.now();

    // Quick harvests first so the page reads as finished sooner, then the
    // long history crawl with progressive updates.
    document.body.classList.add('sehub-harvesting');

    harvest('PLEDGE', readPledge).then(function (pledge) {
      model.pledge = pledge;
      health.harvest.pledge = !!pledge;
      guard('renderGift', renderGift)(model);
      guard('renderAlerts', renderAlerts)(buildAlerts(model));
    });

    harvest('SUPPORTER_DETAILS', readDetails).then(function (details) {
      model.details = details;
      health.harvest.details = !!(details && Object.keys(details).length);
      guard('renderAccount', renderAccount)(model);
    });

    harvest('SUPPORTER_SUBSCRIPTIONS', readSubs).then(function (subs) {
      model.subs = subs;
      health.harvest.subs = !!(subs && subs.length);
      guard('renderAccount', renderAccount)(model);
    });

    harvest('TXN_GIVING', function (overlay) {
      model.enTotal = parseAllMoney(safeText(SEL.txn.totalValue, overlay));

      // First page renders immediately; the rest fills in behind it.
      model.crawl = { rows: readHistoryRows(overlay), complete: false };
      guard('renderGiving', renderGiving)(model, { page: 1, total: historyPageCount(overlay) });

      return crawlHistory(overlay, function (page, total) {
        guard('renderGiving', renderGiving)(model, { page: page, total: total });
      });
    }).then(function (crawl) {
      health.harvest.history = !!crawl;
      if (!crawl) {
        guard('renderGiving', renderGiving)(model, null);
        return;
      }
      model.crawl = crawl;
      model.summary = summarise(crawl);
      model.card = model.summary.card;

      guard('renderGiving', renderGiving)(model, null);
      guard('renderStats', renderStats)(model);
      // Card expiry only becomes knowable after the history crawl, so the
      // alert region is recomputed once here.
      guard('renderAlerts', renderAlerts)(buildAlerts(model));
      guard('renderGift', renderGift)(model);

      track('prefetch_complete', {
        ms: Date.now() - t0,
        pagesRead: crawl.pagesRead,
        pageCount: crawl.pageCount,
        complete: crawl.complete
      });
    });

    queue.then(function () {
      document.body.classList.remove('sehub-harvesting');
      health.harvest.ms = Date.now() - t0;
    });
  }

  /* Expose health for manual inspection. Contains no donor data. */
  window.__hubWrapper = { version: VERSION, health: health };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      try { boot(); } catch (e) { uncloak(); }
    });
  } else {
    try { boot(); } catch (e) { uncloak(); }
  }
})();
