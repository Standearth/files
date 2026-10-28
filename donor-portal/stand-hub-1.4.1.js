/* =====================================================================
   STAND HUB WRAPPER: SCRIPT (v1.4.1)

   What it does: reads EN's own Hub data (same-origin JSON), draws the dashboard,
   and drives EN's own gadget controls. Every change is still made by EN.
   Principles: never calls the ENS API; never touches card fields (they live in
   EN's VGS frames); never logs or displays personal data, supporter or gift IDs;
   every gift change is confirmed by the donor first.

   Contents
     1. Config (contact, amounts, history request)    7. Dashboard (banners, cards, history, statement)
     2. Utilities (DOM, money, dates, storage)        8. EN popups (accessibility, titles, layouts, forms)
     3. Data (gift and giving-history JSON)           9. Global listeners (clicks, keys, outside click)
     4. EN driver and gift form modes                10. Page frame (top bar, greeting)
     5. Wrapper dialog                               11. Boot
     6. Flows (cancel, re-activate, combine, upgrade, start monthly)

   Troubleshooting: add ?standhub=debug to the Hub URL and open the console;
   each step logs a "[StandHub] ..." line (names and counts only, never values).
   Add ?standhub=off to see EN's original Hub without the wrapper.
   This readable file is the source: edit it, then rebuild the minified paste-in blocks.
   ===================================================================== */
(function () {
  'use strict';
  if (!document.body || !document.body.classList.contains('stand-hub')) return; // kill switch: ?standhub=off

  /* ---------- 1. Config ---------- */
  var CFG = {
    contact: { name: 'Cary', email: 'gifts@stand.earth', phone: '1-833-STAND-33', phoneDigits: '1-833-782-6333', hours: 'Monday to Friday, 9:00 AM to 5:00 PM PT' },
    upgradePct: function (c) { return c <= 2500 ? 20 : c < 4000 ? 15 : 10; }, // % more to offer, by the gift in cents (team, 27 Oct): up to $25 +20%, under $40 +15%, from $40 +10%; banner and subtle ask
    newGiftUrl: 'https://act.stand.earth/page/77077/donate/1', // "Start a new monthly gift" when a past gift's card has expired
    signInPath: 'hub/1', // the Hub's sign-in step: the session screen's fallback when the page has no EN Logout link
    expiryWarnDays: 45,
    // Giving History: exactly the request EN's own gadget makes (Network tab, 20 Oct 2026), same page size.
    historyPath: 'txngiving/transaction?rows={rows}&start={start}&inmem=true&nd=true&ev=true&p2p=true', // receipts left out: not used, and they add work for EN
    historyRows: 10, // EN's own page size; EN refused 200 (HTTP 400). Pages after the first load in parallel.
    historyMaxPages: 40, // at most 40 requests
    waitMs: 10000
  };
  var REASONS = [
    ['tight', 'Money is tight right now'],
    ['elsewhere', 'I’m giving to another organization'],
    ['card', 'There’s a problem with my card'],
    ['unhappy', 'I’m unhappy with Stand.earth'],
    ['other', 'Something else']
  ];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DEBUG = /[?&]standhub=debug(&|$)/.test(location.search);
  function log(msg) { if (DEBUG && window.console) console.info('[StandHub] ' + msg); } // ?standhub=debug: steps and status codes only
  var S = { data: null, currentGiftId: null, bypass: false, uid: 0 };

  /* ---------- 2. Utilities ---------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  // Builds DOM safely: text always goes through textContent, never innerHTML.
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function uid(p) { S.uid += 1; return 'sh-' + p + '-' + S.uid; }
  function visible(n) { return !!(n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length)); }
  function money(a, cur) {
    var n = cents(Number(a) || 0);
    var s = n % 1 === 0 ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '$' + s + (cur ? ' ' + cur : '');
  }
  function charge(a, cur, monthly) { return money(a, cur || 'CAD') + (monthly ? ' Monthly' : ''); }
  function upgradeTo(a) { var c = Math.round(a * 100); return Math.ceil(c * (100 + CFG.upgradePct(c)) / 10000); } // rounded up to a whole amount; in whole cents, so 25 x 1.2 can't come out as 31
  function usd(a) { return 'US$' + cents(a).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function longDate(y, m, d) { return MONTHS_LONG[m - 1] + ' ' + d + ', ' + y; }
  function placeLine(me) { return [me.city, [me.region, me.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', '); }
  function fmtDate(ms) { var d = new Date(ms); return isNaN(d) ? '' : MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function ordinal(n) { var s = n % 100 > 10 && n % 100 < 14 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'; return n + s; }
  // EN sends expiry as 08/2027, 082027 or 0827.
  function parseExpiry(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 6) return { m: +d.slice(0, 2), y: +d.slice(2) };
    if (d.length === 4) return { m: +d.slice(0, 2), y: 2000 + +d.slice(2) };
    return null;
  }
  function daysToExpiry(exp) { return exp ? (new Date(exp.y, exp.m, 0, 23, 59, 59) - new Date()) / 864e5 : null; }
  function waitFor(test, ms) {
    return new Promise(function (resolve, reject) {
      var hit = test(); if (hit) { resolve(hit); return; }
      var obs = new MutationObserver(function () { var r = test(); if (r) { obs.disconnect(); clearTimeout(t); resolve(r); } });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      var t = setTimeout(function () { obs.disconnect(); reject(new Error('timeout')); }, ms || CFG.waitMs);
    });
  }
  function afterPaint(fn) { requestAnimationFrame(function () { requestAnimationFrame(fn); }); }
  function safe(name, fn) { try { return fn(); } catch (e) { if (window.console) console.warn('[StandHub] ' + name + ' skipped'); return null; } }
  var store = { // remembered for this visit (until the tab closes)
    get: function (k) { try { return sessionStorage.getItem('standhub:' + k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem('standhub:' + k, v); } catch (e) { /* storage blocked */ } }
  };
  function contactLine() {
    return el('p', { class: 'sh-hint' }, ['Prefer help? ' + CFG.contact.name + ' can do this for you: ',
      mailLink(), ' or ' + CFG.contact.phone + '.']);
  }

  function fire(n, type) { n.dispatchEvent(new Event(type || 'change', { bubbles: true })); } // tell EN a field changed
  function cents(x) { return Math.round(x * 100) / 100; }
  function fmtExp(e) { return String(e.m).padStart(2, '0') + '/' + e.y; } // 08/2027
  function mailLink() { return el('a', { href: 'mailto:' + CFG.contact.email, text: CFG.contact.email }); }
  function sum(o) { return Object.keys(o).reduce(function (t, k) { return t + o[k]; }, 0); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function srOnly(tag, text) { return el(tag, { class: 'sh-sr-only', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap', text: text }); }

  /* ---------- 3. Data (same-origin JSON that EN's own Hub script loads) ---------- */
  function pageId() {
    var pj = window.pageJson || {};
    if (pj.campaignPageId) return String(pj.campaignPageId);
    var f = qs('form.en__component--page'); var m = f && /\/page\/(\d+)\//.exec(f.getAttribute('action') || '');
    if (!m) m = /\/page\/(\d+)\//.exec(location.pathname);
    return m ? m[1] : null;
  }
  function gadgetId(type) { var g = qs('.en__component--hubgadget[data-componenttype="' + type + '"]'); return g && g.getAttribute('data-componentid'); }
  function getJSON(path) {
    return fetch(path, { credentials: 'same-origin', headers: { 'Accept': 'application/json, text/javascript', 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function gadgetUrl(type, tail) {
    var p = pageId(), g = gadgetId(type);
    return p && g ? '/page/' + encodeURIComponent(p) + '/hubgadget/' + encodeURIComponent(g) + '/' + tail : null;
  }
  var ME_KEYS = { firstName: 0, lastName: 0, emailAddress: 'email', phoneNumber: 'phone', address1: 'line1', city: 'city', region: 'region', postcode: 'postcode', country: 'country' };
  function useDetails(me) { if (!me) return; S.meSaved = me; if (S.data) { Object.assign(S.data.me, me); render(); } } // current details win over the ones from login
  function loadDetails() { // EN's details gadget has the current details; its gift data keeps the ones from login
    var url = gadgetUrl('SUPPORTER_DETAILS', 'supporterdetails'); if (!url) return Promise.resolve(null);
    return getJSON(url).then(function (j) {
      // EN keys the values by display label ("First Name"); its jsonContent maps each label to the field ("firstName")
      var d = (j && j.data) || {}, cfg = {}, label = {}, f = {};
      try { cfg = JSON.parse((j && j.jsonContent) || '{}'); } catch (e) { /* no field list */ }
      Object.keys(cfg.fields || {}).forEach(function (k) { var x = cfg.fields[k]; if (x && x.fieldName) { label[x.name] = x.fieldName; label[x.heading] = x.fieldName; } });
      Object.keys(d).forEach(function (k) { var n = label[k] || k, v = d[k]; if (n in ME_KEYS && (typeof v === 'string' || typeof v === 'number')) f[n] = String(v); });
      var keys = Object.keys(f); log('details: EN details gadget ' + (keys.length ? 'gave ' + keys.join(', ') : 'gave no details (labels: ' + Object.keys(d).filter(function (k) { return !/id$/i.test(k); }) + ')'));
      if (!keys.length) return null;
      var me = {}; Object.keys(ME_KEYS).forEach(function (k) { if (ME_KEYS[k] && k in f) me[ME_KEYS[k]] = f[k].trim(); });
      if ('firstName' in f || 'lastName' in f) { me.name = [f.firstName, f.lastName].filter(Boolean).join(' ').trim(); me.first = (f.firstName || '').trim(); }
      return me;
    }).catch(function (e) { log('details: EN details gadget request failed (' + e.message + '), showing details from login'); return null; });
  }
  function normalizePledge(j) {
    var d = (j && j.data) || {}, sup = d.supporter || {};
    var list = d.recurringTxns && d.recurringTxns.length ? d.recurringTxns : (d.recurring ? [d.recurring] : []);
    var gifts = list.map(function (t) {
      var last4 = String(t.lastFourDigits || '').replace(/\D/g, '').slice(-4);
      return {
        id: String(t.id), status: String(t.status || '').toUpperCase(), day: Number(t.frequencyDay) || null,
        amount: Number(t.amount) || 0, currency: String(t.currency || 'CAD').toUpperCase(),
        last4: last4, exp: parseExpiry(t.expiry), bank: !!t.bankPayment,
        canUpdateCard: !!t.allowCardUpdate && !t.bankPayment && !!last4, next: Number(t.nextPaymentDate) || null
      };
    });
    return {
      state: String(d.state || ''), gifts: gifts, fields: Object.keys(d).join(', '), target: d.recurring && d.recurring.id ? String(d.recurring.id) : null, // the past gift EN re-activates, if EN says
      region: String(sup.region || ''), country: String(sup.country || ''),
      me: { name: [sup.firstName, sup.lastName].filter(Boolean).join(' '), first: sup.firstName || '', email: sup.emailAddress || '', phone: sup.phoneNumber || '', line1: sup.address1 || '', city: sup.city || '', region: sup.region || '', postcode: sup.postcode || '', country: sup.country || '' }
    };
  }
  function loadPledge() { var u = gadgetUrl('PLEDGE', 'pledge'); return u ? getJSON(u).then(normalizePledge) : Promise.reject(new Error('ids')); }
  /* Giving History. EN's field formats aren't documented, so every value is parsed defensively
     and debug mode logs the shape of the reply (field names, value patterns, never values). */
  function num(v) { if (typeof v === 'number') return v; var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
  function dateOf(v) { // EN sends epoch milliseconds
    var d = new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : v);
    return v === null || v === undefined || v === '' || isNaN(d) ? null : { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  function rowPaid(t) { // "Card ending 4242", "Apple Pay (Card ending 4242)", "PayPal", "Bank payment": the gift card's wording; no expiry in history
    var pt = String(t.paymentType || '').toLowerCase(), last = String(t.ccLastFour || t.lastFourDigits || '').replace(/\D/g, '').slice(-4);
    if (/paypal/.test(pt + ' ' + String(t.gateway || '').toLowerCase())) return 'PayPal';
    var wallet = /apple/.test(pt) ? 'Apple Pay' : /google/.test(pt) ? 'Google Pay' : /wallet/.test(pt) ? 'Digital wallet' : '', card = last ? 'Card ending ' + last : '';
    return wallet ? wallet + (card ? ' (' + card + ')' : '') : card || (/bank|ach|eft|debit/.test(pt) ? 'Bank payment' : '');
  }
  function rowsOf(j) { return j && Array.isArray(j.data) ? j.data : []; }
  function normSummary(s) { // {USD: '53.05', CAD: '50.07'}
    var out = {}; if (s && typeof s === 'object') Object.keys(s).forEach(function (k) { var a = num(s[k]); if (/^[a-z]{3}$/i.test(k) && a) out[k.toUpperCase()] = a; });
    return Object.keys(out).length ? out : null;
  }
  var SKIP_STATUS = /fail|reject|declin|error|pend|cancel|void|refund|chargeback|reversed/i;
  function loadHistory() {
    if (!gadgetUrl('TXN_GIVING', '')) { log('history: Giving History gadget not on page'); return Promise.resolve(null); }
    var out = { summary: null, years: {}, list: [], rows: 0, counted: 0 }, pages = 0, skipped = {}, statuses = {}, t0 = Date.now();
    function add(t) {
      if (!t || typeof t !== 'object') return;
      var st = String(t.transactionStatus || '');
      statuses[st.slice(0, 20) || '(blank)'] = 1;
      var dt = dateOf(t.createdOn), y = dt && dt.y;
      var c = String(t.currency || '').toUpperCase();
      var cs = out.summary ? Object.keys(out.summary) : [];
      if (!c && cs.length === 1) c = cs[0];
      var a = num(t.amount), why = SKIP_STATUS.test(st + ' ' + (t.transactionType || '')) ? 'status' : !y ? 'date' : !c ? 'currency' : !(a > 0) ? 'amount' : '';
      if (why) { skipped[why] = (skipped[why] || 0) + 1; return; }
      out.counted += 1; out.years[c] = out.years[c] || {}; out.years[c][y] = cents((out.years[c][y] || 0) + a);
      out.list.push({ k: y * 1e4 + dt.m * 100 + dt.d, dt: dt, a: a, c: c, type: /^(true|y|yes|1)$/i.test(String(t.recurringPayment)) || /recur/i.test(String(t.transactionType || '')) ? 'Monthly gift' : 'One-time gift', paid: rowPaid(t) });
    }
    function page(start, rows) { return getJSON(gadgetUrl('TXN_GIVING', CFG.historyPath.replace('{rows}', rows).replace('{start}', start))); }
    function take(j) { var rows = rowsOf(j); rows.forEach(add); pages += 1; out.rows += rows.length; return rows.length; }
    function done() {
      log('history: ' + pages + ' request(s) in ' + (Date.now() - t0) + ' ms, ' + out.rows + ' rows, ' + out.counted + ' counted, left out ' + JSON.stringify(skipped) + '; statuses: ' + Object.keys(statuses) + '; currencies: ' + Object.keys(out.years));
      return out;
    }
    function first(rows) {
      return page(0, rows).then(function (j) {
        var p = (j && j.pagination) || {};
        out.summary = normSummary(j && j.summary);
        var n = take(j), total = num(p.total !== undefined ? p.total : p.totalRows !== undefined ? p.totalRows : p.totalCount);
        if (!n || !total || n >= total) return done(); // EN gives the total; without it, the first page is all we show
        var starts = []; for (var st = n; st < total && starts.length < CFG.historyMaxPages; st += n) starts.push(st);
        return Promise.all(starts.map(function (st) { return page(st, n); })).then(function (js) { js.forEach(take); return done(); }); // the rest at once
      });
    }
    return first(CFG.historyRows).catch(function (e) { log('history: request failed (' + e.message + ')'); return null; });
  }
  function mainCurrency(h) { // the currency of most of the donor's gifts; ties go to the larger total, then CAD
    var sm = h.summary || {}, cs = Object.keys(sm).concat(Object.keys(h.years)).filter(function (c, i, a) { return a.indexOf(c) === i; });
    var n = {}; h.list.forEach(function (r) { n[r.c] = (n[r.c] || 0) + 1; });
    return cs.sort(function (a, b) { return (n[b] || 0) - (n[a] || 0) || (sm[b] || sum(h.years[b] || {})) - (sm[a] || sum(h.years[a] || {})) || (b === 'CAD') - (a === 'CAD'); })[0];
  }
  function cardExpired(g) { var n = new Date(); return !!(g && g.exp) && (g.exp.y < n.getFullYear() || (g.exp.y === n.getFullYear() && g.exp.m < n.getMonth() + 1)); }
  function inactiveGift() { // the past gift to show and re-activate: EN's own pick when its data names one, else paused, then on hold, then the latest
    if (!S.data) return null;
    var past = S.data.gifts.filter(function (g) { return g.status !== 'ACTIVE'; }), rank = { PAUSED: 0, SUSPENDED: 1 };
    return (S.data.target && past.filter(function (g) { return g.id === S.data.target; })[0]) || past.sort(function (a, b) {
      var ra = rank[a.status] === undefined ? 2 : rank[a.status], rb = rank[b.status] === undefined ? 2 : rank[b.status];
      return ra - rb || (b.next || 0) - (a.next || 0);
    })[0] || null;
  }
  function activeGifts() { return S.data ? S.data.gifts.filter(function (g) { return g.status === 'ACTIVE'; }) : []; }
  function giftById(id) { return S.data ? S.data.gifts.filter(function (g) { return g.id === String(id); })[0] : null; }
  function paidWith(g) { return g.last4 ? 'Card ending ' + g.last4 + (g.exp ? ', expires ' + fmtExp(g.exp) : '') : (g.bank ? 'Bank payment' : 'PayPal or another method'); }

  /* ---------- 4. EN driver and gift form modes: opens EN's gift gadget and presses EN's own controls ---------- */
  var en = {
    tile: function () { return qs('.en__component--hubgadget[data-componenttype="PLEDGE"]'); },
    overlay: function () { var o = qs('.en__hubOverlay--pledge'); return o && visible(o) ? o : null; },
    form: function () { var o = en.overlay(); return o && qs('.en__hubPledge__state', o); },
    hasPanel: function (f) { return !!(f && qs('.en__hubPledge__panel--manage, .en__hubPledge__panel--donate', f)); },
    open: function () {
      var o = en.overlay();
      if (o && (qs('.en__hubPledge__list__item', o) || en.hasPanel(en.form()))) return Promise.resolve(o);
      function go() {
        var t = en.tile(); if (!t) return Promise.reject(new Error('tile'));
        t.click();
        return waitFor(function () { var o2 = en.overlay(); return o2 && qs('.en__hubPledge__list__item, .en__hubPledge__state', o2) ? o2 : null; });
      }
      if (o) log('EN: closing an old gift screen first');
      return o ? en.close().then(go) : go(); // e.g. EN's "cancelled" screen left open after a change
    },
    select: function (id) {
      var sel = '.en__hubPledge__list__item[data-recurringtxnid="' + String(id).replace(/[^0-9]/g, '') + '"]';
      return waitFor(function () { var o = en.overlay(); return !o ? null : qs(sel, o) || (en.hasPanel(en.form()) ? 'form' : null); }, 8000).then(function (hit) {
        S.currentGiftId = String(id);
        if (hit === 'form') { log('EN: opened the gift form directly (one gift, no list)'); return en.form(); }
        hit.click();
        return waitFor(function () { var f = en.form(); return en.hasPanel(f) ? f : null; });
      }, function () { log('EN: gift not found in EN\'s list'); throw new Error('gift'); });
    },
    openGift: function (id) { return en.open().then(function () { return id ? en.select(id) : waitFor(function () { var f = en.form(); return en.hasPanel(f) ? f : null; }); }); },
    result: function () {
      return waitFor(function () {
        var f = en.form(); if (!f) return null;
        if (f.classList.contains('en__hubPledge__state--failed')) return 'failed';
        return en.hasPanel(f) ? null : 'success';
      }, 20000);
    },
    press: function (selector) {
      var f = en.form(), b = f && qs(selector, f); if (!b) return Promise.reject(new Error('control'));
      f.classList.remove('en__hubPledge__state--failed');
      S.bypass = true; try { b.click(); } finally { S.bypass = false; }
      return en.result();
    },
    setStatus: function (v) { var s = qs('select[name="uiPaymentstatus"]', en.form()); if (!s) { log('re-activate: no Payment status field on the gift form'); throw new Error('status'); } s.value = v; fire(s); },
    setAmount: function (a) {
      var f = en.form(), other = f && qs('input[name="donationAmt"][value="Other"]', f), box = f && qs('input[name="donationAmt.other"]', f);
      if (!other || !box) throw new Error('amount');
      other.checked = true; fire(other);
      box.value = String(a); fire(box, 'input'); fire(box);
    },
    close: function () {
      var o = en.overlay(), c = o && qs('.en__hubOverlay__header a', o); if (o) o.setAttribute('data-sh-driver', '1'); if (c) c.click();
      return waitFor(function () { return en.overlay() ? null : true; }, 4000).catch(function () { return true; });
    },
    focus: function (what) {
      var f = en.form(); if (!f) return;
      var target = null; setMode(f, what);
      if (what === 'amount') target = qs('input[name="donationAmt"]:checked', f) || qs('input[name="donationAmt"]', f);
      if (what === 'day') target = qs('select[name="recurrday"]', f);
      if (what === 'card') {
        var extra = qs('.en__hubUpdateCC__additional', f), toggle = qs('.en__hubUpdateCC__toggle', f);
        if (toggle && extra && !qs('.en__hubUpdateCC--enabled', f)) toggle.click(); // EN's own toggle opens the section (enPage.css collapses it) and starts EN's card editing
        target = qs('.en__hubUpdateCC__additional .en__field__label', f) || toggle;
        if (target && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      }
      if (target) afterPaint(function () { target.scrollIntoView({ block: 'center' }); target.focus(); });
    }
  };

  // EN has one form for amount, card and day. Each button shows only its part; the rest stays in the form
  // with EN's own current values, and any field EN flags as invalid is shown again (CSS).
  function pick(sel, want) { // choose an option by its value or its words
    if (!sel || !want) return false; want = String(want).toLowerCase();
    var alias = { ca: 'canada', canada: 'ca', us: 'united states', usa: 'united states', 'united states': 'us', gb: 'united kingdom', uk: 'united kingdom', 'united kingdom': 'gb' }, w2 = alias[want];
    var o = qsa('option', sel).filter(function (x) { var v = x.value.toLowerCase(), t = x.textContent.trim().toLowerCase(); return v === want || t === want || (w2 && (v === w2 || t === w2)); })[0];
    if (!o) return false; sel.value = o.value; fire(sel); return true;
  }
  function restoreDormant(f, g) { // re-activate form: EN's saved expiry and address, Payment status Active
    if (!f || !f.classList.contains('en__hubPledge__state--dormantRecurring')) return;
    var st = qs('select[name="uiPaymentstatus"]', f), ex = qsa('select[name="ccexpire"]', f), me = (S.data && S.data.me) || {}, done = [];
    if (st && pick(st, 'ACTIVE')) done.push('status');
    if (g && g.exp && !cardExpired(g) && ex.length === 2 && pick(ex[0], String(g.exp.m).padStart(2, '0')) && pick(ex[1], String(g.exp.y))) done.push('expiry');
    else if (cardExpired(g) && ex.length === 2) { ex.forEach(function (sel, i) { if (!qs('option[value=""]', sel)) sel.insertBefore(el('option', { value: '', text: i ? 'Year' : 'Month' }), sel.firstChild); sel.value = ''; }); done.push('expiry left for the new card'); }
    [['address1', me.line1], ['city', me.city], ['postcode', me.postcode]].forEach(function (p) {
      var i = qs('input[name="' + p[0] + '"]', f); if (i && !i.value.trim() && p[1]) { i.value = p[1]; fire(i, 'input'); done.push(p[0]); }
    });
    placeholder(qs('select[name="region"]', f), 'Choose a state or province', me.region); placeholder(qs('select[name="country"]', f), 'Choose a country', me.country); // first, so they can't clear what is filled in
    [['country', me.country], ['region', me.region]].forEach(function (p) { var sel = qs('select[name="' + p[0] + '"]', f); if (sel && !sel.value && pick(sel, p[1])) done.push(p[0]); });
    log('re-activate: filled from EN\'s saved details: ' + (done.join(', ') || 'nothing needed'));
  }
  function currentAddress(f) { // Update card: EN prefills the address from sign-in; use the current one from EN's details gadget
    var me = S.meSaved, done = []; if (!me) return;
    [['address1', me.line1], ['city', me.city], ['postcode', me.postcode]].forEach(function (p) {
      var i = qs('input[name="' + p[0] + '"]', f); if (i && p[1] && i.value !== p[1]) { i.value = p[1]; fire(i, 'input'); fire(i); done.push(p[0]); }
    });
    [['country', me.country], ['region', me.region]].forEach(function (p) { var sel = qs('select[name="' + p[0] + '"]', f); if (sel && p[1] && pick(sel, p[1])) done.push(p[0]); });
    log('update card: address from EN\'s current details: ' + (done.join(', ') || 'already current'));
  }
  function savedMsg(f) { // the donor's change in words, shown in place of EN's general "updated" copy
    var g = giftById(S.currentGiftId) || inactiveGift(), cur = (g && g.currency) || 'CAD', a = chosenAmount(f), d = qs('select[name="recurrday"]', f), has = function (c) { return f.classList.contains(c); };
    if (has('sh-mode--card')) return 'Your card has been updated.';
    if (has('sh-mode--day')) return d && +d.value ? 'Your payment day is now the ' + ordinal(+d.value) + ' of each month.' : '';
    if (has('sh-mode--amount') && a) return has('en__hubPledge__state--dormantRecurring') ? 'Your monthly gift of ' + money(a, cur) + ' is active again.' : 'Your monthly gift is now ' + money(a, cur) + '.';
    return '';
  }
  function expiryLabels(o) { // EN's expiry has one label for two selects
    qsa('.en__field--ccexpire .en__field__item', o).forEach(function (it, i) {
      var sel = qs('select', it); if (!sel || qs('.sh-sublabel', it)) return; if (!sel.id) sel.id = 'sh-exp-' + i;
      it.insertBefore(el('label', { for: sel.id, class: 'sh-sublabel', text: i ? 'Year' : 'Month' }), sel);
    });
  }
  function pledgeSaved(o) { // EN shows its success copy as a new panel after the save
    var f = qs('.en__hubPledge__state', o), p = f && f.__shMsg && qsa('.en__hubPledge__panel--copy', f).filter(function (n) { return !n.classList.contains('sh-mode-hide') && !n.hasAttribute('data-sh'); })[0];
    if (!p) return; p.setAttribute('data-sh', '1'); p.replaceChildren(el('p', { class: 'sh-saved', role: 'status', text: f.__shMsg })); f.__shMsg = '';
  }
  function syncAmount(f, g) {
    if (!f || !g || !g.amount) return;
    var chips = qsa('input[name="donationAmt"]', f), other = qs('input[name="donationAmt"][value="Other"]', f), box = qs('input[name="donationAmt.other"]', f);
    var hit = chips.filter(function (r) { return r !== other && num(r.value) === g.amount; })[0];
    if (hit) { hit.checked = true; fire(hit, 'change'); if (box && box.value) { box.value = ''; fire(box, 'input'); } }
    else if (box) { chips.forEach(function (r) { r.checked = r === other; }); if (other) fire(other, 'change'); box.value = String(g.amount); fire(box, 'input'); fire(box, 'change'); }
  }
  function guardAmount(f, g) { // now, and again once EN has finished filling the form in, unless the donor has already chosen
    if (!f || !g) return; f.__shTouched = false; syncAmount(f, g);
    if (!f.__shWatch) { f.__shWatch = true; f.addEventListener('change', function (e) { if (e.isTrusted) f.__shTouched = true; }, true); f.addEventListener('input', function (e) { if (e.isTrusted) f.__shTouched = true; }, true); }
    setTimeout(function () { if (!f.__shTouched && document.contains(f)) syncAmount(f, g); }, 400);
  }
  var MODES = { amount: 'Change your monthly gift', card: 'Update your card', day: 'Change your payment day' };
  function setMode(f, what) {
    var o = en.overlay(), h = o && qs('.en__hubOverlay__header h2', o), dormant = f.classList.contains('en__hubPledge__state--dormantRecurring');
    Object.keys(MODES).forEach(function (k) { f.classList.toggle('sh-mode--' + k, k === what); });
    f.classList.toggle('sh-mode', !!MODES[what]);
    qsa('.sh-mode-intro', f).forEach(function (n) { n.remove(); });
    if (!MODES[what]) guardAmount(f, giftById(S.currentGiftId) || inactiveGift());
    if (h && !h.hasAttribute('data-sh-title')) h.setAttribute('data-sh-title', h.textContent);
    if (!MODES[what]) { if (h) h.textContent = h.getAttribute('data-sh-title'); return; }
    qsa('.en__hubPledge__panel--copy', f).forEach(function (n) { n.classList.add('sh-mode-hide'); }); // EN's success copy arrives later, so it still shows
    var g = giftById(S.currentGiftId), m = g ? money(g.amount) : '';
    moLabels(f); guardAmount(f, g || inactiveGift()); restoreDormant(f, g || inactiveGift()); if (what === 'card' && !dormant) currentAddress(f);
    if (h) h.textContent = dormant && what === 'amount' ? 'Restart your monthly gift' : MODES[what];
    var intro = !g ? '' : dormant ? (what === 'amount' ? 'Choose what to give each month.' : what === 'card' ? 'Add your new card to restart your ' + m + ' monthly gift.' : '') :
      what === 'amount' ? 'You give ' + m + ' a month today.' + (g.next ? ' Your next payment is on ' + fmtDate(g.next) + '.' : '') :
      what === 'card' ? 'Your ' + m + ' monthly gift will use this card from the next payment on.' : 'Choose the day of the month your ' + m + ' gift is charged.';
    var panel = qs('.en__hubPledge__panel--manage', f); if (panel && intro) panel.insertBefore(el('p', { class: 'sh-mode-intro', text: intro }), panel.firstChild);
    labelSubmit(f, dormant || f.classList.contains('en__hubPledge__state--activeRecurring'));
  }

  /* ---------- 5. Wrapper dialog (one component for every flow) ---------- */
  var dlg = {
    node: null, opener: null, busy: false,
    ensure: function () {
      if (dlg.node) return dlg.node;
      dlg.node = el('dialog', { class: 'sh-dialog', 'aria-labelledby': 'sh-dialog-title' });
      dlg.node.addEventListener('cancel', function (e) { if (dlg.busy) e.preventDefault(); });
      dlg.node.addEventListener('close', function () { var o = dlg.opener; dlg.opener = null; if (o && document.contains(o)) o.focus(); });
      var down = false;
      dlg.node.addEventListener('pointerdown', function (e) { down = e.target === dlg.node; });
      dlg.node.addEventListener('click', function (e) { if (e.target === dlg.node && down && !dlg.busy) dlg.close(); down = false; });
      document.body.appendChild(dlg.node);
      return dlg.node;
    },
    show: function (opts) {
      var d = dlg.ensure();
      if (!d.open) dlg.opener = document.activeElement;
      var title = el('h2', { id: 'sh-dialog-title', tabindex: '-1', text: opts.title });
      var head = el('div', { class: 'sh-dialog__head' }, [el('div', {}, [opts.step ? el('p', { class: 'sh-dialog__step', text: opts.step }) : null, title]),
        dlg.busy ? null : el('button', { class: 'sh-dialog__close', type: 'button', 'aria-label': 'Close', text: '×', onclick: dlg.close })]);
      d.replaceChildren(el('div', { class: 'sh-dialog__body' }, [head].concat(opts.body)));
      if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
      title.focus();
    },
    close: function () { if (dlg.node && dlg.node.open) dlg.node.close(); }
  };
  function intro(text) { return el('p', { class: 'sh-dialog__intro', text: text }); }
  function offer(title, sub, onclick) { return el('button', { class: 'sh-offer', type: 'button', onclick: onclick }, [title, el('span', { text: sub })]); }
  function btn(label, onclick, variant) { return el('button', { class: 'sh-btn' + (variant ? ' sh-btn--' + variant : ''), type: 'button', text: label, onclick: onclick }); }

  /* ---------- 6. Flows (each ends with one native EN action the donor confirmed) ---------- */
  function notice(msg, isError) {
    var box = qs('#sh-notice'); if (!box) return;
    box.replaceChildren(el('div', { class: 'sh-notice' + (isError ? ' sh-notice--error' : ''), tabindex: '-1' }, [msg]));
    box.firstChild.focus();
  }
  function failMsg() { return 'That change didn’t go through. Please try again, or contact ' + CFG.contact.name + ' at ' + CFG.contact.email + ' or ' + CFG.contact.phone + '.'; }
  function acted() { store.set('acted', '1'); }
  function runEN(giftId, action, successMsg) {
    dlg.busy = true;
    dlg.show({ title: 'Saving your change', body: [el('p', { role: 'status', text: 'Please keep this window open.' })] });
    return en.openGift(giftId).then(function () { var gg = giftById(giftId) || giftById(S.currentGiftId) || inactiveGift(); syncAmount(en.form(), gg); restoreDormant(en.form(), gg); }).then(action).then(function (r) {
      if (r !== 'success') throw new Error('failed');
      acted(); store.set('notice', JSON.stringify({ m: successMsg, at: Date.now() })); // EN may refresh the page just after; the message is shown again then
      return en.close().then(function () { dlg.busy = false; dlg.close(); return refresh(); }).then(function () { notice(successMsg); });
    }).catch(function (e) {
      dlg.busy = false; dlg.close(); en.close();
      notice(failMsg(), true);
    });
  }
  function lowerAmount(g) { dlg.close(); openFor(g, 'amount').catch(function () { notice(failMsg(), true); }); }

  function upgradeBtn(o) { // EN's "Yes, I will upgrade to a recurring gift": by data-action, else by its wording (never "single gift instead")
    var c = qsa('button, a, [role="button"], input[type="button"], input[type="submit"]', o).filter(function (n) { return visible(n) && !n.closest('.en__hubOverlay__header'); });
    return c.filter(function (n) { return /upgrade|recur/i.test(n.getAttribute('data-action') || ''); })[0] ||
      c.filter(function (n) { var t = (n.textContent || n.value || '').toLowerCase(); return /upgrade|recurring|monthly/.test(t) && !/single|one-time|once|instead/.test(t); })[0] || null;
  }
  function openFor(g, part, past) { S.currentGiftId = g.id; return en.openGift(past ? null : g.id).then(function () { en.focus(part); }); }
  var flows = {
    startMonthly: function () { // the donor already chose monthly on our card, so skip EN's "upgrade or give once?" question
      en.open().catch(function () { return null; }).then(function () {
        return waitFor(function () { var o = en.overlay(); return !o ? null : qs('.en__field', o) ? 'form' : upgradeBtn(o); }, 4000);
      }).then(function (b) { if (b !== 'form') { log('start monthly: pressed EN\'s upgrade step'); b.click(); } }).catch(function () {
        var o = en.overlay(); log('start monthly: EN\'s upgrade step not found, donor chooses' + (o ? ' (buttons: ' + qsa('button, a', o).map(function (n) { return (n.getAttribute('data-action') || '-') + ' "' + n.textContent.trim().slice(0, 40) + '"'; }).join('; ') + ')' : ''));
      });
    },
    upgrade: function (g, up) {
      dlg.show({ title: 'Increase your monthly gift?', body: [
        intro('Your gift will go from ' + money(g.amount) + ' to ' + money(up) + ' ' + g.currency + ' a month' + (g.next ? ', starting with your next payment on ' + fmtDate(g.next) : '') + '.'),
        el('div', { class: 'sh-row' }, [btn('Yes, update to ' + charge(up, g.currency, true), function () {
          runEN(g.id, function () { en.setAmount(up); return en.press('[data-action="update"]'); }, 'Thank you! Your monthly gift is now ' + money(up, g.currency) + '.');
        }), btn('Not now', dlg.close, 'secondary')])] });
    },
    cancel: function (g) {
      var reasons = el('fieldset', { class: 'sh-options' }, [el('legend', { class: 'sh-sr-only', text: 'Reason for cancelling' })].concat(REASONS.map(function (r) {
        return el('label', { class: 'sh-option' }, [el('input', { type: 'radio', name: 'sh-reason', value: r[0] }), r[1]]);
      })));
      var err = el('p', { class: 'sh-error sh-hidden', id: 'sh-reason-err', text: 'Choose a reason, or skip this step.' });
      dlg.show({
        title: 'Before you go, can you tell us why?', step: 'Step 1 of 2',
        body: [intro('Your answer helps us improve, and we may be able to help.'), reasons, err,
          el('div', { class: 'sh-row' }, [btn('Continue', function () {
            var r = qs('input[name="sh-reason"]:checked', dlg.node);
            if (!r) { err.classList.remove('sh-hidden'); reasons.setAttribute('aria-describedby', 'sh-reason-err'); qs('input', reasons).focus(); return; }
            flows.cancelOffers(g, r.value);
          }, 'dark'), el('button', { class: 'sh-link', type: 'button', text: 'Skip this and cancel my gift', onclick: function () { flows.cancelConfirm(g); } })])]
      });
    },
    cancelOffers: function (g, reason) {
      var offers = reason === 'card' && g.canUpdateCard
        ? [offer('Update my card', 'Keep your gift going with a new card', function () { dlg.close(); openFor(g, 'card'); })]
        : [offer('Choose a lower amount', 'Any amount keeps your support going', function () { lowerAmount(g); })];
      if (activeGifts().length > 1) offers.push(offer('Combine my gifts instead', 'One payment a month, same total', flows.combine));
      dlg.show({
        title: reason === 'card' ? 'Let’s fix your card instead' : 'Would a smaller gift help?', step: 'Step 2 of 2',
        body: [intro('Every month you stay keeps our campaigns going. You can change this again any time.'),
          el('div', { class: 'sh-options' }, offers), contactLine(), btn('No thanks, cancel my gift', function () { flows.cancelConfirm(g); }, 'secondary')]
      });
    },
    cancelConfirm: function (g) {
      dlg.show({
        title: 'Cancel your monthly gift?',
        body: [intro('Your ' + charge(g.amount, g.currency, true) + ' gift will stop. No more payments will be taken for it.'),
          el('div', { class: 'sh-row' }, [btn('Yes, cancel my gift', function () {
            runEN(g.id, function () { return en.press('a[data-action="cancel"]'); }, 'Your ' + charge(g.amount, g.currency, true) + ' gift is cancelled. Thank you for your support.');
          }), btn('Keep my gift', dlg.close, 'secondary')])]
      });
    },
    reactivate: function (g) {
      S.currentGiftId = g.id; runEN(null, function () { en.setStatus('ACTIVE'); return en.press('[data-action="update"]'); }, 'Your monthly gift of ' + money(g.amount, g.currency) + ' is active again.');
    },
    contact: function (g) {
      dlg.show({
        title: 'Change how you pay',
        body: [intro('Your ' + charge(g.amount, g.currency, true) + ' gift is paid with ' + paidWith(g) + '. To use a different PayPal account, sign in to PayPal.'),
          el('p', { class: 'sh-hint' }, ['Want to switch this gift to a card? ' + CFG.contact.name + ' can set that up for you, keeping the same amount and payment day: ',
            mailLink(), ' or ' + CFG.contact.phone + ' (' + CFG.contact.phoneDigits + '), ' + CFG.contact.hours + '.']),
          btn('Close', dlg.close, 'secondary')]
      });
    },
    combine: function () {
      var gifts = activeGifts(); if (gifts.length < 2) return;
      var keepDefault = gifts.slice().sort(function (a, b) { return b.amount - a.amount; })[0].id;
      var opts = el('fieldset', { class: 'sh-options' }, [el('legend', { text: 'Keep which payment day and card?' })].concat(gifts.map(function (g) {
        return el('label', { class: 'sh-option' }, [el('input', { type: 'radio', name: 'sh-keep', value: g.id, checked: g.id === keepDefault }),
          charge(g.amount, g.currency, true) + ' on the ' + ordinal(g.day || 1) + ', ' + paidWith(g)]);
      })));
      dlg.show({
        title: 'Combine your monthly gifts',
        body: [intro('Choose which gift to keep. You’ll confirm two steps: cancel the other gift, then add its amount to the one you keep.'), opts, contactLine(),
          btn('Continue to step 1', function () { var k = qs('input[name="sh-keep"]:checked', dlg.node).value; flows.combineStep1(giftById(k), gifts.filter(function (g) { return g.id !== k; })[0]); })]
      });
    },
    combineStep1: function (keep, other) {
      dlg.show({
        title: 'Cancel your ' + money(other.amount) + ' gift', step: 'Step 1 of 2',
        body: [intro('First, cancel your ' + charge(other.amount, other.currency, true) + ' gift. Next, you’ll add ' + money(other.amount) + ' to the gift you keep.'),
          el('div', { class: 'sh-row' }, [btn('Cancel my ' + charge(other.amount, other.currency, true) + ' gift', function () {
            dlg.busy = true; dlg.show({ title: 'Saving step 1', body: [el('p', { role: 'status', text: 'Please keep this window open.' })] });
            store.set('combine', JSON.stringify({ k: keep.id, o: other.id, t: cents(keep.amount + other.amount) })); // EN refreshes the page after a cancel; step 2 comes back
            en.openGift(other.id).then(function () { return en.press('a[data-action="cancel"]'); }).then(function (r) {
              if (r !== 'success') throw new Error('failed');
              log('combine: step 1 done (gift cancelled)'); acted(); return en.close();
            }).then(function () { dlg.busy = false; flows.combineStep2(keep, other); })
              .catch(function (e) { log('combine: step 1 failed (' + e.message + ')'); store.set('combine', ''); dlg.busy = false; dlg.close(); en.close(); notice(failMsg(), true); });
          }), btn('Keep both gifts', dlg.close, 'secondary')]), contactLine()]
      });
    },
    combineStep2: function (keep, other) {
      log('combine: step 2 shown');
      var total = cents(keep.amount + other.amount);
      dlg.show({
        title: 'Add ' + money(other.amount) + ' to your ' + money(keep.amount) + ' gift', step: 'Step 2 of 2',
        body: [intro('Your ' + money(other.amount) + ' gift is cancelled. Now raise your other gift so your total stays the same.'),
          el('div', { class: 'sh-row' }, [btn('Update to ' + charge(total, keep.currency, true), function () {
            runEN(keep.id, function () { en.setAmount(total); return en.press('[data-action="update"]'); }, 'Your gifts are combined. You now give ' + charge(total, keep.currency, true) + '.').then(function () { store.set('combine', ''); });
          }), btn('Not now', function () { store.set('combine', ''); dlg.close(); refresh().then(function () { notice('Your ' + money(other.amount) + ' gift is cancelled. Your ' + money(keep.amount) + ' gift is unchanged; you can raise it any time with Change amount.'); }); }, 'secondary')])]
      });
    }
  };

  /* ---------- 7. Dashboard: banners, gift cards, giving summary, history, account cards ---------- */
  function banner(kind, key, title, text, action) {
    if (store.get('hide:' + key)) return null;
    var node = el('section', { class: 'sh-banner sh-banner--' + kind, 'aria-label': title }, [
      el('div', { class: 'sh-banner__text' }, [el('h2', { text: title }), text ? el('p', { text: text }) : null]),
      action,
      el('button', { class: 'sh-banner__close', type: 'button', 'aria-label': 'Hide this message', text: '×', onclick: function () {
        store.set('hide:' + key, '1'); node.remove(); if (key === 'upgrade') qsa('.sh-ask').forEach(function (n) { n.hidden = false; }); var h = qs('#sh-dash'); if (h) h.focus();
      } })
    ]);
    return node;
  }
  function banners() {
    var out = [], gifts = activeGifts();
    var expiring = gifts.filter(function (g) { var d = daysToExpiry(g.exp); return g.canUpdateCard && d !== null && d <= CFG.expiryWarnDays; })[0];
    if (expiring) {
      var past = daysToExpiry(expiring.exp) < 0;
      out.push(banner('warning', 'expiry-' + expiring.id,
        past ? 'Your card ending ' + expiring.last4 + ' has expired' : 'Your card ending ' + expiring.last4 + ' expires at the end of ' + MONTHS_LONG[expiring.exp.m - 1],
        'Add your new card details so your ' + charge(expiring.amount, expiring.currency, true) + ' gift isn’t interrupted.',
        btn('Update card', function () { openFor(expiring, 'card'); }, 'dark')));
    }
    if (gifts.length > 1 && gifts.every(function (g) { return g.currency === gifts[0].currency; })) {
      var sum = gifts.reduce(function (s, g) { return s + g.amount; }, 0);
      out.push(banner('teal', 'multi', 'You have ' + gifts.length + ' monthly gifts', 'Together you give ' + money(sum, gifts[0].currency) + ' a month. Prefer one payment? You can combine them.', btn('Combine into one gift', flows.combine, 'light')));
    }
    var one = gifts.length === 1 && gifts[0], up = one && upgradeTo(one.amount);
    if (one) log('upgrade banner: ' + (expiring ? 'not shown (card-expiry banner shows instead)' : store.get('hide:upgrade') ? 'not shown (closed this visit)' : store.get('acted') ? 'not shown (a change was made this visit)' : 'shown'));
    S.upBanner = false; // read by the gift cards: the subtle ask waits while this banner is on screen
    if (one && !expiring && up > one.amount && !store.get('acted')) {
      out.push(S.upBanner = banner('teal', 'upgrade', 'Thank you for your monthly gift of ' + money(one.amount) + '.', 'Would you consider increasing it to ' + money(up) + ' a month?',
        btn('Yes, give ' + charge(up, one.currency, true), function () { flows.upgrade(one, up); }, 'light')));
      S.upBanner = !!S.upBanner;
    }
    return out.filter(Boolean);
  }
  function factList(g) {
    return el('dl', { class: 'sh-facts' }, [g.next ? fact('Next payment', fmtDate(g.next)) : null,
      fact('Paid with', g.last4 && g.exp ? ['Card ending ' + g.last4, el('br'), 'Expires ' + fmtExp(g.exp)] : paidWith(g)),
      g.day ? fact('Payment day', ordinal(g.day) + ' of the month') : null]);
  }
  function fact(label, value) { return el('div', {}, [el('dt', { text: label }), el('dd', {}, [].concat(value))]); }
  function askReason(g) { // the subtle ask: never after a change this visit, never on a card that has expired or expires soon
    var d = daysToExpiry(g.exp);
    return store.get('acted') ? 'a change was made this visit' : d !== null && d <= CFG.expiryWarnDays ? 'card expired or expires soon' : '';
  }
  function giftCard(g, i, n) {
    var id = uid('gift'), no = askReason(g);
    log('subtle ask: gift ' + (i + 1) + ' of ' + n + ' ' + (no ? 'not shown (' + no + ')' : S.upBanner ? 'waits (upgrade banner on screen)' : 'shown'));
    var payBtn = g.canUpdateCard ? btn('Update card', function () { openFor(g, 'card'); }, 'secondary')
      : btn('Change payment method', function () { flows.contact(g); }, 'secondary');
    return el('section', { class: 'sh-card', 'aria-labelledby': id }, [
      el('div', { class: 'sh-card__head' }, [el('h2', { id: id, text: n > 1 ? 'Monthly gift ' + (i + 1) + ' of ' + n : 'My monthly gift' }),
        el('span', { class: 'sh-status' }, [el('span', { class: 'sh-dot', 'aria-hidden': 'true' }), 'Active'])]),
      el('p', { class: 'sh-amount' }, [el('span', { class: 'sh-amount__value', text: money(g.amount) }), 'per month, ' + g.currency]),
      factList(g),
      el('div', { class: 'sh-row' }, [
        btn('Change amount', function () { openFor(g, 'amount'); }),
        payBtn,
        btn('Change payment day', function () { openFor(g, 'day'); }, 'secondary')]),
      el('div', { class: 'sh-row' }, [
        no ? null : el('button', { class: 'sh-link sh-ask', type: 'button', hidden: S.upBanner, text: 'Give a little more', onclick: function () { flows.upgrade(g, upgradeTo(g.amount)); } }),
        el('button', { class: 'sh-link', type: 'button', text: 'Cancel this gift', onclick: function () { flows.cancel(g); } })])
    ]);
  }
  function inactiveCard() {
    var g = inactiveGift(); if (!g) return null;
    var st = g.status, c = CFG.contact, heads = { PAUSED: 'Your monthly gift is paused', SUSPENDED: 'Your monthly gift stopped after failed payments' };
    var old = st !== 'SUSPENDED' && cardExpired(g); // EN can't restart a past gift with a new card (HTTP 500, 22 Oct), so: a new gift instead
    var actions = st === 'SUSPENDED' ? [btn('Update card', function () { openFor(g, 'card', true); })]
      : old ? [el('a', { class: 'sh-btn', href: CFG.newGiftUrl, target: '_blank', rel: 'noopener' }, ['Start a new monthly gift', srOnly('span', ' (opens in a new tab)')])]
      : [btn('Re-activate at ' + charge(g.amount, g.currency, true), function () { flows.reactivate(g); }),
         btn('Re-activate with a different amount', function () { openFor(g, 'amount', true); }, 'secondary')];
    return el('section', { class: 'sh-card', 'aria-labelledby': 'sh-inactive-h' }, [
      el('div', { class: 'sh-card__head' }, [el('h2', { id: 'sh-inactive-h', text: heads[st] || 'Restart your monthly gift' }),
        el('span', { class: 'sh-status' }, [el('span', { class: 'sh-dot ' + (st === 'SUSPENDED' ? 'sh-dot--bad' : 'sh-dot--paused'), 'aria-hidden': 'true' }), ({ PAUSED: 'Paused', SUSPENDED: 'On hold' })[st] || 'Cancelled'])]),
      el('p', { class: 'sh-amount' }, [el('span', { class: 'sh-amount__value', text: money(g.amount) }), 'per month, ' + g.currency]),
      old ? el('p', { class: 'sh-hint', text: 'The card ending ' + g.last4 + ' expired ' + fmtExp(g.exp) + ', so this gift can’t be restarted here. You can start a new monthly gift instead.' }) : null,
      el('div', { class: 'sh-row' }, actions),
      old ? el('p', { class: 'sh-hint', style: 'margin-top:12px', text: 'This opens our donation page in a new tab. To come back to the portal afterwards, you’ll need a new sign-in link.' }) : null,
      old || st === 'SUSPENDED' ? el('p', { class: 'sh-hint', style: 'margin-top:12px' }, [(old ? 'Or contact ' : 'Need help? Contact ') + c.name + ' at ', mailLink(), ' or ' + c.phone + '.']) : null
    ]);
  }
  function startCard(title, text, label, go) {
    return el('section', { class: 'sh-card', 'aria-labelledby': 'sh-start-h' }, [el('h2', { id: 'sh-start-h', text: title }), el('p', { text: text }),
      el('div', { class: 'sh-row', style: 'margin-top:16px' }, [btn(label, go || function () { en.open(); })])]);
  }
  function givingCard() {
    var h = S.history; if (!h) return null;
    var c = mainCurrency(h); if (!c) return null;
    var yrs = h.years[c] || {}, all = (h.summary && h.summary[c]) || sum(yrs), thisYear = new Date().getFullYear(), years = Object.keys(yrs).sort();
    if (!(all > 0)) return null;
    var max = Math.max.apply(null, years.map(function (y) { return yrs[y]; }).concat([1])), first = h.list.length ? h.list.reduce(function (a, r) { return r.k < a.k ? r : a; }).dt : null; // donor level, every currency
    function total(label, value) { return el('div', { class: 'sh-totals__group' }, [el('p', { class: 'sh-totals__label', text: label }), el('p', { class: 'sh-totals__value', text: value })]); }
    var chart = years.length > 1 ? el('figure', { class: 'sh-chart' }, [
      el('div', { class: 'sh-chart__bars', 'aria-hidden': 'true' }, years.map(function (y) {
        return el('div', { class: 'sh-chart__bar' + (+y === thisYear ? ' sh-chart__bar--now' : '') }, [
          el('span', { text: money(Math.round(yrs[y])) }), el('i', { style: 'height:' + Math.max(6, Math.round(140 * yrs[y] / max)) + 'px' })]);
      })),
      el('div', { class: 'sh-chart__years', 'aria-hidden': 'true' }, years.map(function (y) { return el('span', { text: y }); })),
      srOnly('figcaption', 'Giving by year in ' + c + ': ' + years.map(function (y) { return y + ', ' + money(yrs[y]); }).join('; ') + '.')]) : null;
    return el('section', { class: 'sh-card sh-card--outline', 'aria-labelledby': 'sh-giving-h' }, [el('h2', { id: 'sh-giving-h', text: 'Giving summary (' + c + ')' }),
      el('div', { class: 'sh-totals' }, [total('This year (' + thisYear + ')', money(yrs[thisYear] || 0)), total('All time', money(all)),
        first ? total('Giving since', MONTHS[first.m - 1] + ' ' + first.y) : null, h.list.length ? total('Total gifts', String(h.list.length)) : null]), chart]);
  }
  function historyCard() {
    var h = S.history; if (!h || !h.list.length) return null;
    var rows = h.list.slice().sort(function (a, b) { return b.k - a.k; });
    var years = rows.map(function (r) { return r.dt.y; }).filter(function (y, i, a) { return a.indexOf(y) === i; });
    var now = new Date().getFullYear(), yr = S.histYear || String(years.indexOf(now) > -1 ? now : years[0]), shown = rows.filter(function (r) { return r.dt.y === +yr; }), list = S.histAll ? shown : shown.slice(0, 3);
    var pick = el('select', { id: 'sh-hist-year', class: 'sh-select', 'aria-label': 'Select year', onchange: function () { S.histYear = this.value; S.histAll = false; updateHistory(S.history); } },
      years.map(function (y) { return el('option', { value: y, text: y, selected: String(y) === yr }); }));
    var head = el('tr', {}, ['Date', 'Gift', 'Paid with', 'Amount'].map(function (t, i) { return el('th', { scope: 'col', class: ['', '', 'sh-paid', 'sh-num'][i] || null, text: t }); })); // Paid with: its own column on wider screens, under the gift type on phones
    return el('section', { class: 'sh-card sh-card--outline', 'aria-labelledby': 'sh-hist-h' }, [
      el('div', { class: 'sh-card__head' }, [el('h2', { id: 'sh-hist-h', text: 'Giving history' }), el('div', { class: 'sh-row' }, [pick, statementBtn(h, +yr)])]),
      el('div', { class: 'sh-table', tabindex: '0', role: 'region', 'aria-labelledby': 'sh-hist-h' }, [el('table', {}, [srOnly('caption', 'Gifts, newest first'), el('thead', {}, [head]),
        el('tbody', {}, list.map(function (r) {
          return el('tr', {}, [el('td', {}, [el('time', { datetime: r.dt.y + '-' + pad2(r.dt.m) + '-' + pad2(r.dt.d), text: MONTHS[r.dt.m - 1] + ' ' + r.dt.d })]), el('td', {}, [r.type, r.paid ? el('span', { class: 'sh-sub', text: r.paid }) : null]), el('td', { class: 'sh-paid', text: r.paid }), el('td', { class: 'sh-num', text: r.c + ' ' + money(r.a).replace(/^\$(\d[\d,]*)$/, '$$$1.00') })]);
        }))])]),
      shown.length > 3 ? el('button', { id: 'sh-hist-toggle', class: 'sh-link', type: 'button', 'aria-expanded': String(!!S.histAll), text: S.histAll ? 'Show fewer gifts' : 'Show all ' + shown.length + ' gifts',
        onclick: function () { S.histAll = !S.histAll; updateHistory(S.history); } }) : null]);
  }
  function statementBtn(h, y) { // yearly statement for US donors: needs the team's text on the page (EN code block #sh-statement), USD as the main currency, and USD gifts that year
    var why = !qs('#sh-statement') ? 'no #sh-statement block on the page' : mainCurrency(h) !== 'USD' ? 'main currency is not USD' : !h.list.some(function (r) { return r.c === 'USD' && r.dt.y === y; }) ? 'no USD gifts in the selected year' : '';
    log('statement button: ' + (why ? 'not shown (' + why + ')' : 'shown'));
    return why ? null : btn('Print or save as PDF', function () { statement(y); }, 'secondary');
  }
  function statement(y) { // fills in the team's text and prints it with the browser's own print: no library, nothing leaves the page
    var tpl = qs('#sh-statement'), me = (S.data && S.data.me) || {}, now = new Date(); if (!tpl || !S.history) return;
    var rows = S.history.list.filter(function (r) { return r.c === 'USD' && r.dt.y === y; }).sort(function (a, b) { return b.k - a.k; }); // newest first, as in Giving history
    var total = cents(rows.reduce(function (s, r) { return s + r.a; }, 0));
    var words = { date: longDate(now.getFullYear(), now.getMonth() + 1, now.getDate()), year: String(y), first_name: me.first || 'friend', gift_count: rows.length + (rows.length === 1 ? ' gift' : ' gifts'), total: usd(total) };
    var blocks = { // a paragraph holding only one of these placeholders becomes the block
      donor_address: function () { return el('p', { class: 'sh-st-address' }, [me.name, me.line1, placeLine(me), me.country].filter(Boolean).reduce(function (a, v, i) { return a.concat(i ? [el('br'), v] : [v]); }, [])); },
      gifts: function () {
        return el('table', { class: 'sh-st-table' }, [el('thead', {}, [el('tr', {}, ['Date', 'Gift', 'Paid with', 'Amount'].map(function (t, i) { return el('th', { scope: 'col', class: i === 3 ? 'sh-num' : null, text: t }); }))]),
          el('tbody', {}, rows.map(function (r) { return el('tr', {}, [el('td', { text: longDate(r.dt.y, r.dt.m, r.dt.d) }), el('td', { text: r.type }), el('td', { text: r.paid || '' }), el('td', { class: 'sh-num', text: usd(r.a) })]); })
            .concat([el('tr', { class: 'sh-st-total' }, [el('th', { scope: 'row', colspan: '3', text: 'Total' }), el('td', { class: 'sh-num', text: usd(total) })])]))]); // a total row, not a tfoot, which would repeat on every page
      }
    };
    var box = el('div', { id: 'sh-print' }), walk, t;
    Array.prototype.forEach.call(tpl.childNodes, function (n) { box.appendChild(n.cloneNode(true)); });
    walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    while ((t = walk.nextNode())) t.nodeValue = t.nodeValue.replace(/\{(\w+)\}/g, function (m, k) { k = k.toLowerCase(); return k in words ? words[k] : m; }); // a misspelt placeholder stays visible
    qsa('p', box).forEach(function (p) { var k = ((p.textContent.trim().match(/^\{(\w+)\}$/) || [])[1] || '').toLowerCase(); if (blocks[k]) p.replaceWith(blocks[k]()); });
    var hrs = qsa('hr', box);
    if (hrs.length) { // above the first line: the header band, logo left, the rest right
      var head = el('div', { class: 'sh-st-head' }), title = el('div', { class: 'sh-st-title' });
      while (box.firstChild !== hrs[0]) { var n = box.firstChild; (n.nodeType === 1 && (n.tagName === 'IMG' || qs('img', n)) ? head : title).appendChild(n); }
      head.appendChild(title); box.insertBefore(head, hrs[0]);
    }
    if (hrs.length > 1) { var foot = el('div', { class: 'sh-st-foot' }), last = hrs[hrs.length - 1]; while (last.nextSibling) foot.appendChild(last.nextSibling); box.appendChild(foot); } // below the last line: the footer
    var old = qs('#sh-print'); if (old) old.remove(); document.body.appendChild(box);
    log('statement: ' + rows.length + ' gift(s) for ' + y);
    var img = qs('img', box), name = document.title, h = qs('h1, h2', box);
    (img && !img.complete ? new Promise(function (r) { img.onload = img.onerror = r; setTimeout(r, 3000); }) : Promise.resolve()).then(function () {
      document.title = (h && h.textContent.trim()) || 'Giving statement ' + y; // the browser's suggested PDF file name
      window.addEventListener('afterprint', function () { document.title = name; box.remove(); }, { once: true }); // a later Ctrl+P prints the page as usual
      window.print();
    });
  }
  function openTile(type) { var t = qs('.en__component--hubgadget[data-componenttype="' + type + '"]'); if (t) t.click(); }
  function accountCards() {
    var out = [], me = (S.data && S.data.me) || {}, det = qs('[data-componenttype="SUPPORTER_DETAILS"]'), subs = qs('[data-componenttype="SUPPORTER_SUBSCRIPTIONS"]');
    var place = placeLine(me);
    if (det || subs) out.push(el('section', { class: 'sh-card sh-card--outline', 'aria-labelledby': det ? 'sh-me-h' : 'sh-prefs-h' }, (det ? [el('h2', { id: 'sh-me-h', text: 'My details' }),
      el('div', { class: 'sh-lines' }, [me.name, me.email, me.phone, me.line1, place, me.country].filter(Boolean).map(function (v) { return el('p', { text: v }); })),
      btn('Update my details', function () { openTile('SUPPORTER_DETAILS'); }, 'secondary')] : []).concat(subs ? [
      el(det ? 'h3' : 'h2', { id: 'sh-prefs-h', class: 'sh-subhead', text: 'Communication preferences' }),
      el('p', { class: 'sh-lines', text: 'Choose which newsletters, alerts and messages you get.' }),
      btn('Manage communication preferences', function () { openTile('SUPPORTER_SUBSCRIPTIONS'); }, 'secondary')] : [])));
    var c = CFG.contact;
    out.push(el('section', { id: 'sh-help', class: 'sh-card sh-card--inverse', 'aria-labelledby': 'sh-help-h', tabindex: '-1' }, [el('h2', { id: 'sh-help-h', text: 'Questions about your gift?' }),
      el('p', { text: c.name + ' can help with anything about your giving, including skipping a payment or pausing for a set time, or any other changes you may wish to make.' }),
      el('p', { class: 'sh-strong' }, [mailLink()]),
      el('p', { class: 'sh-strong' }, [el('a', { href: 'tel:+' + c.phoneDigits, text: c.phone + ' (' + c.phoneDigits + ')' }), ',', el('br'), c.hours])]));
    return out;
  }
  function historyKids() { return [givingCard(), historyCard()].filter(Boolean); }
  function updateHistory(h) { // redraws only the giving cards, so focus and the rest of the page stay put
    S.history = h; var box = qs('#sh-giving'); if (!box) return;
    var a = document.activeElement, id = a && box.contains(a) ? a.id || (a.closest('.sh-card') && 'sh-hist-toggle') : null;
    box.replaceChildren.apply(box, historyKids());
    var back = id && (document.getElementById(id) || qs('#sh-hist-year')); if (back) back.focus();
  }
  function mainCards() {
    var st = S.data.state, gifts = activeGifts();
    if ((st === 'DONATION_RECURRING' || st === 'DONATION_UPSELL') && gifts.length) return gifts.map(function (g, i) { return giftCard(g, i, gifts.length); });
    if (st === 'DONATION_RECURRING_INACTIVE') return [inactiveCard()];
    if (st === 'DONATION_SINGLE') return [startCard('Become a monthly supporter', 'Give a smaller amount every month instead of once. You can change or stop it any time here.', 'Start monthly giving', flows.startMonthly)];
    if (st === 'DONATION_NONE') return [startCard('Make your first gift', 'Back the campaigns you’ve already joined with a one-time gift.', 'Give once')];
    return [];
  }
  function render() {
    var host = qs('#sh-dash'); if (!host || !S.data) return;
    var top = banners().filter(Boolean), cards = mainCards().filter(Boolean), side = accountCards(); // banners first: the subtle ask waits while the upgrade banner shows
    host.replaceChildren(
      el('div', { id: 'sh-notice', role: 'status' }),
      el('div', { class: 'sh-dash__body' }, top.concat([el('div', { class: 'sh-dash__grid' }, [
        el('div', { class: 'sh-dash__main' }, cards.concat([el('div', { id: 'sh-giving', class: 'sh-stack' }, historyKids())])), el('div', { class: 'sh-dash__side' }, side)])]))
    );
    host.removeAttribute('aria-busy');
    var empty = !top.length && !cards.length && !side.length;
    host.classList.toggle('sh-hidden', empty); if (empty) log('dashboard: nothing to show yet, keeping EN tiles');
    var tile = en.tile(); if (tile) tile.classList.toggle('sh-tile--replaced', cards.length > 0); // tile stays clickable by the driver
    var first = qs('.en__component--hubgadget');
    qsa('.en__component--copyblock').forEach(function (b) { if (first && first.compareDocumentPosition(b) & 4 && qs('a[href^="mailto:' + CFG.contact.email + '"]', b)) b.classList.toggle('sh-hidden', !empty); });
    ['SUPPORTER_DETAILS', 'SUPPORTER_SUBSCRIPTIONS', 'TXN_GIVING'].forEach(function (t) { var n = qs('.en__component--hubgadget[data-componenttype="' + t + '"]'); if (n) n.classList.toggle('sh-tile--replaced', !empty); });
  }
  function resumeCombine() { // EN refreshed the page between the two combine steps: offer step 2 again
    var p = null; try { p = JSON.parse(store.get('combine') || 'null'); } catch (e) { /* ignore */ }
    var keep = p && giftById(p.k), other = p && giftById(p.o);
    if (!p) return;
    if (keep && keep.status === 'ACTIVE' && other && other.status !== 'ACTIVE' && keep.amount < p.t - 0.004) { log('combine: resuming step 2 after a page refresh'); flows.combineStep2(keep, other); }
    else { log('combine: nothing to resume'); store.set('combine', ''); } // done already, or the gifts changed
  }
  function refresh() { return loadPledge().then(function (d) { if (S.meSaved) Object.assign(d.me, S.meSaved); S.data = d; render(); }).catch(function () { /* keep last view */ }); }
  function mountDashboard() {
    var first = qs('.en__component--hubgadget'); if (!first || qs('#sh-dash')) return;
    var row = first.closest('.en__component--row');
    var anchor = row && qsa('.en__component--column', row).length > 1 ? row : first; // one column: right after the welcome text
    anchor.parentNode.insertBefore(el('div', { id: 'sh-dash', class: 'sh-dash', 'aria-label': 'Your gifts and account', 'aria-busy': 'true', role: 'region', tabindex: '-1' }), anchor);
    var history = loadHistory().catch(function () { return null; }); // never blocks the gift cards
    loadDetails().then(useDetails);
    loadPledge().then(function (d) {
      if (!d.me.name && !d.me.email) return showSignedOut(); // EN's gift data has no supporter: nobody is signed in
      if (S.meSaved) Object.assign(d.me, S.meSaved);
      S.data = d; log('state ' + d.state + ', ' + d.gifts.length + ' gift record(s)' + (d.state === 'DONATION_RECURRING_INACTIVE' ? '; EN names the past gift it re-activates: ' + (d.target ? 'yes' : 'no') : '')); if (!d.gifts.length) log('pledge data fields: ' + d.fields);
      if (d.state === 'DONATION_UPSELL') log('upsell state: EN shows only the upgrade offer in the donation tile, so change and cancel cannot work. Keep EN\'s upsell off.');
      render(); var pn = null; try { pn = JSON.parse(store.get('notice') || 'null'); } catch (e) { /* ignore */ } store.set('notice', '');
      if (pn && Date.now() - pn.at < 15000) notice(pn.m); // a change saved just before EN refreshed the page
      resumeCombine(); return history;
    }).then(function (h) { if (S.data) updateHistory(h); })
      .catch(function (e) { log('dashboard: gift data request failed (' + e.message + '), showing EN tiles'); var d = qs('#sh-dash'); if (d) d.remove(); }); // fall back to EN's own tiles
  }

  /* ---------- 8. EN popups: accessibility, titles, layouts (give form, preferences), gift form fixes ---------- */
  function enhanceTiles() {
    qsa('.en__component--hubgadget').forEach(function (t) {
      if (t.hasAttribute('data-sh')) return; t.setAttribute('data-sh', '1');
      t.setAttribute('role', 'button'); t.setAttribute('tabindex', '0');
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); } });
    });
  }
  var openOverlays = [];
  function onOverlayOpen(o) {
    var pop = qs('.en__hubOverlay__popup', o) || o, h = qs('.en__hubOverlay__header h2', o);
    openOverlays.push(o); o.__shOpener = document.activeElement; // each popup remembers where focus returns
    var nb = qs('#sh-notice'); if (nb && !dlg.busy) nb.replaceChildren(); // a new action clears earlier messages
    if (h && !pop.contains(document.activeElement)) h.focus();
  }
  function onOverlayClose(o) {
    openOverlays = openOverlays.filter(function (x) { return x !== o; });
    var back = o.__shOpener; o.__shOpener = null;
    if (o.hasAttribute('data-sh-driver')) return; // the wrapper closed it and manages refresh and focus itself
    if (o.classList.contains('en__hubOverlay--pledge') && !dlg.busy) refresh(); // pick up changes the donor made in EN's own form
    if (openOverlays.some(visible)) return; // another popup is now open and owns focus
    if (back && !document.contains(back)) { var t = back.textContent; back = qsa('#sh-dash button').filter(function (b) { return b.textContent === t; })[0] || back; } // the dashboard was redrawn meanwhile
    if (back && document.contains(back) && visible(back)) back.focus();
    else { var d = qs('#sh-dash'); if (d) d.focus(); }
  }
  function enhanceOverlay(o) {
    var pop = qs('.en__hubOverlay__popup', o) || o, h = qs('.en__hubOverlay__header h2', o), close = qs('.en__hubOverlay__header a', o);
    if (!o.hasAttribute('data-sh')) {
      o.setAttribute('data-sh', '1');
      pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true');
      if (h) { if (!h.id) h.id = uid('ov'); pop.setAttribute('aria-labelledby', h.id); h.setAttribute('tabindex', '-1'); }
      if (close) { close.setAttribute('role', 'button'); close.setAttribute('aria-label', 'Close'); }
    }
    var st = S.data && S.data.state, t = ({ supportersubscriptions: 'Communication preferences', supporterdetails: 'Update my details', txngiving: 'Giving history', pledge: st === 'DONATION_SINGLE' ? 'Start a monthly gift' : st === 'DONATION_NONE' ? 'Make a gift' : '' })[(/en__hubOverlay--(\w+)/.exec(o.className) || [])[1]];
    if (t && h && h.textContent !== t) h.textContent = t;
    qsa('img', o).forEach(function (i) { if (!i.closest('.en__field, .en__hubUpdateCC')) i.classList.add('sh-hidden'); }); // the prototype's popups have no icons
    if (visible(o) && openOverlays.indexOf(o) < 0) onOverlayOpen(o);
    qsa('.en__hubPledge__state', o).forEach(enhanceForm);
    qsa('input[name="donationAmt.other"]', o).forEach(function (i) { if (!i.getAttribute('aria-label') && !(i.id && qs('label[for="' + i.id + '"]'))) i.setAttribute('aria-label', 'Other amount'); if (!i.placeholder) i.placeholder = 'Other amount'; i.setAttribute('inputmode', 'decimal'); });
  }
  function syncOverlays() {
    openOverlays.filter(function (o) { return !document.contains(o) || !visible(o); }).forEach(onOverlayClose); // closes first
    qsa('.en__hubOverlay').forEach(enhanceOverlay);
    qsa('.en__hubOverlay').filter(visible).forEach(function (o) { if (/--supportersubscriptions/.test(o.className)) subsLayout(o); if (/--pledge/.test(o.className)) { giveLayout(o); expiryLabels(o); pledgeSaved(o); } if (/--supporterdetails/.test(o.className)) detailsSaved(o); centerPopup(o); });
  }
  function giveLayout(o) {
    var f = qs('.en__hubPledge__state', o), cols = f && qs('.en__hubPledge__columns', f); if (!cols || cols.hasAttribute('data-sh')) return; cols.setAttribute('data-sh', '1');
    var amt = qs('.en__field--donationAmt', f), cur = qs('.en__field--paycurrency', f), pay = qs('.en__field--paymenttype', f);
    if (amt) { var sec = el('div', { class: 'sh-give-sec' }, [el('h2', { text: monthlyForm(f) ? 'Your monthly gift' : 'Your gift' })]); sec.appendChild(amt); if (cur) sec.appendChild(cur); cols.parentNode.insertBefore(sec, cols); } // no card iframes are moved
    var a1 = qs('.en__field--address1', f); if (a1 && !qs('.sh-give-h', f)) a1.parentNode.insertBefore(el('h3', { class: 'sh-give-h', text: 'Address' }), a1);
    var fn = qs('.en__field--firstName', f); if (fn) fn.parentNode.classList.add('sh-give-billing');
    var cc = pay && qs('input[value="Credit Card"]', pay); // card only: PayPal stays in EN's form, hidden
    if (cc) { if (!cc.checked) { cc.checked = true; fire(cc); } pay.classList.add('sh-hidden'); }
    var sel = cur && qs('select', cur), me = (S.data && S.data.me) || {}, h = S.history;
    var want = (h && mainCurrency(h)) || (S.data && S.data.gifts[0] && S.data.gifts[0].currency) || (/^(canada|ca)$/i.test(me.country || '') ? 'CAD' : me.country ? 'USD' : '');
    if (sel && !sel.value && want && qs('option[value="' + want + '"]', sel)) { sel.value = want; fire(sel); }
    moLabels(f); labelSubmit(f, monthlyForm(f));
  }
  function detailsSaved(o) { // EN confirmed new details: read them from EN's details gadget, as on page load
    var okMsg = qs('.en__hubgadget__response--success', o); if (!okMsg || okMsg.hasAttribute('data-sh')) return; okMsg.setAttribute('data-sh', '1');
    loadDetails().then(useDetails);
  }
  function centerPopup(o) {
    var p = qs('.en__hubOverlay__popup', o); if (!p || !visible(p)) return;
    var cur = parseFloat(getComputedStyle(p).marginTop) || 0, r = p.getBoundingClientRect(), base = r.top + (o.scrollTop || 0) - cur;
    var m = Math.max(0, Math.round(Math.max(16, (window.innerHeight - r.height) / 2) - base));
    if (Math.abs(m - cur) > 2) p.style.setProperty('margin-top', m + 'px', 'important');
  }
  var SUBS_MAIN = 'All communications';
  var SUBS = [['sh-subs-news', 'Newsletters', ['stand-newsletter-opt-in', 'srg-newsletter-opt-in']], ['sh-subs-more', 'Alerts and updates', ['advocacy-opt-in', 'fundraiser-opt-in', 'texting-opt-in']]];
  function subsLayout(o) { // same order and groups as Stand's Manage Subscriptions page (70490); EN's fields, values and Update stay as they are
    var form = qs('.en__component--formblock', o), main = form && qs('.en__field--primary-opt-in', form);
    if (!form || !main || form.hasAttribute('data-sh-subs')) return; form.setAttribute('data-sh-subs', '1');
    var intro = qs('.en__component--copyblock', o); if (intro) intro.classList.add('sh-subs-intro');
    var at = qs('.en__submit', form), put = function (n) { form.insertBefore(n, at); };
    put(el('h3', { class: 'sh-subs-h', id: 'sh-subs-main', text: SUBS_MAIN })); put(main);
    var used = [main], rest = qsa('.en__field--checkbox', form);
    SUBS.forEach(function (grp, i) {
      var fields = grp[2].map(function (c) { return qs('.en__field--' + c, form); }).filter(Boolean);
      if (i === SUBS.length - 1) fields = fields.concat(rest.filter(function (f) { return used.indexOf(f) < 0 && fields.indexOf(f) < 0; })); // anything new goes in the last group
      if (!fields.length) return;
      put(el('h3', { class: 'sh-subs-h', id: grp[0], text: grp[1] })); fields.forEach(function (f) { put(f); used.push(f); });
    });
    qsa('.en__field--checkbox label', form).forEach(function (l) {
      var ps = qsa('p', l).filter(function (n) { return n.textContent.trim(); });
      ps.forEach(function (n, i) { n.classList.add(i ? 'sh-opt__sub' : 'sh-opt__title'); n.removeAttribute('style'); }); // EN's inline sizes (10px, -10px margins, 250px width) go
    });
  }
  function placeholder(sel, text, preferred) {
    if (!sel || sel.hasAttribute('data-sh')) return; sel.setAttribute('data-sh', '1');
    var hasEmpty = qsa('option', sel).some(function (op) { return op.value === '' || op.value === 'Select'; });
    if (hasEmpty) return;
    var defaultFirst = !qsa('option', sel).some(function (op) { return op.defaultSelected; }) && sel.selectedIndex === 0;
    sel.insertBefore(el('option', { value: '', text: text }), sel.firstChild);
    if (defaultFirst && sel.options[1].value !== preferred) sel.value = ''; // EN had no saved value: don't silently pick Alabama
  }
  function monthlyForm(f) { return !!f && (f.classList.contains('en__hubPledge__state--activeRecurring') || f.classList.contains('en__hubPledge__state--dormantRecurring') || !!qs('input[name="recurrfreq"][value="MONTHLY"]', f)); }
  function moLabels(f) { // "$25/mo" so the chips read as monthly
    if (!monthlyForm(f)) return;
    qsa('.en__field--donationAmt .en__field__item label', f).forEach(function (l) { var t = l.textContent.trim(); if (/^\$[\d.,]+$/.test(t)) l.textContent = t + '/mo'; });
  }
  function enhanceForm(f) {
    var data = S.data || {}; moLabels(f);
    placeholder(qs('select[name="region"]', f), 'Choose a state or province', data.region);
    placeholder(qs('select[name="country"]', f), 'Choose a country', data.country);
    if (f.hasAttribute('data-sh')) return; f.setAttribute('data-sh', '1');
    var recurring = f.classList.contains('en__hubPledge__state--activeRecurring') || f.classList.contains('en__hubPledge__state--dormantRecurring');
    var otherBox = qs('input[name="donationAmt.other"]', f), otherRadio = qs('input[name="donationAmt"][value="Other"]', f);
    if (otherBox && otherRadio) {
      otherBox.addEventListener('input', function () { var v = otherBox.value.replace(/[^0-9.]/g, ''); if (v !== otherBox.value) otherBox.value = v; if (otherBox.value.trim() && !otherRadio.checked) { otherRadio.checked = true; fire(otherRadio); } });
      qsa('input[name="donationAmt"]', f).forEach(function (r) { if (r !== otherRadio) r.addEventListener('change', function () { if (r.checked && otherBox.value) otherBox.value = ''; }); });
    }
    var sync = function () { labelSubmit(f, recurring); };
    f.addEventListener('change', sync); f.addEventListener('input', sync); sync();
  }
  function chosenAmount(f) {
    var r = qs('input[name="donationAmt"]:checked', f); if (!r) return null;
    var v = r.value === 'Other' ? (qs('input[name="donationAmt.other"]', f) || {}).value : r.value;
    var n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isNaN(n) || n <= 0 ? null : n;
  }
  function labelSubmit(f, recurring) {
    var b = qs('[data-action="update"], [data-action="donate"]', f), a = chosenAmount(f); if (!b) return;
    if (!b.hasAttribute('data-sh-label')) b.setAttribute('data-sh-label', b.textContent.trim());
    if (f.classList.contains('sh-mode--card')) { b.textContent = 'Update card'; return; }
    if (f.classList.contains('sh-mode--day')) { b.textContent = 'Save payment day'; return; }
    var g = giftById(S.currentGiftId), curSel = qs('select[name="paycurrency"]', f);
    var cur = curSel ? curSel.value : (g ? g.currency : 'CAD');
    if (!a) { b.textContent = b.getAttribute('data-sh-label'); return; }
    if (b.getAttribute('data-action') === 'donate') b.textContent = 'Donate ' + (cur ? charge(a, cur, monthlyForm(f)) : money(a) + (monthlyForm(f) ? ' Monthly' : ''));
    else b.textContent = (recurring ? 'Update to ' : 'Donate ') + charge(a, cur, recurring);
  }
  function validate(f) {
    var errs = [];
    function need(field, msg) {
      var wrap = qs('.en__field--' + field, f), input = wrap && qs('select, input:not([type="hidden"])', wrap);
      if (!input || !visible(input)) return;
      var v = String(input.value || '').trim(); if (!v || v === 'Select') errs.push([input, msg]);
    }
    need('address1', 'Enter your street address.'); need('city', 'Enter your city.'); need('postcode', 'Enter your postal or ZIP code.');
    need('country', 'Choose your country.'); need('region', 'Choose your state or province.');
    var ex = qsa('.en__field--ccexpire select', f);
    if (ex.length === 2 && visible(ex[0])) {
      var m = +ex[0].value, y = +ex[1].value, now = new Date();
      if (!m || !y) errs.push([ex[0], 'Choose the card’s expiry month and year.']);
      else if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) errs.push([ex[0], 'This card has expired. Use a card with a later date.']);
    }
    var other = qs('input[name="donationAmt"][value="Other"]', f);
    if (other && other.checked && !chosenAmount(f)) errs.push([qs('input[name="donationAmt.other"]', f) || other, 'Enter an amount of $1 or more.']);
    return errs;
  }
  function showErrors(f, errs) {
    qsa('.sh-error', f).forEach(function (n) { n.remove(); });
    qsa('[aria-invalid="true"]', f).forEach(function (n) { n.removeAttribute('aria-invalid'); n.removeAttribute('aria-describedby'); });
    errs.forEach(function (e) {
      var id = uid('err'); e[0].setAttribute('aria-invalid', 'true'); e[0].setAttribute('aria-describedby', id);
      var wrap = e[0].closest('.en__field') || e[0].parentNode;
      wrap.appendChild(el('span', { class: 'sh-error', id: id, text: e[1] }));
      e[0].addEventListener('change', function clear() { e[0].removeAttribute('aria-invalid'); var m = document.getElementById(id); if (m) m.remove(); e[0].removeEventListener('change', clear); });
    });
    if (errs[0]) errs[0][0].focus();
  }

  /* ---------- 9. Global listeners (capture phase, so they run before EN's handlers) ---------- */
  function outside(t) { return !t || !t.closest || t.closest('.en__hubOverlay__popup, .sh-dialog') ? null : qsa('.en__hubOverlay').filter(visible)[0] || null; } // works whatever EN's backdrop is
  function onPointerDown(e) { S.downOutside = outside(e.target); }
  function onClickCapture(e) {
    var t = e.target; if (!t || !t.closest) return;
    var ov = outside(t);
    if (ov) { var x = qs('.en__hubOverlay__header a', ov); if (ov === S.downOutside && x && !dlg.busy && !ov.hasAttribute('data-sh-driver')) { e.preventDefault(); x.click(); } S.downOutside = null; return; }
    var item = t.closest('.en__hubPledge__list__item'); if (item) S.currentGiftId = item.getAttribute('data-recurringtxnid');
    var cancel = t.closest('.en__hubOverlay--pledge a[data-action="cancel"]');
    if (cancel && !S.bypass) {
      e.preventDefault(); e.stopImmediatePropagation();
      var g = giftById(S.currentGiftId) || activeGifts()[0];
      if (g) flows.cancel(g); return;
    }
    var submit = t.closest('.en__hubPledge [data-action="update"], .en__hubPledge [data-action="donate"]');
    if (submit) {
      var f = submit.closest('.en__hubPledge__state'), errs = f ? validate(f) : [];
      if (errs.length) { e.preventDefault(); e.stopImmediatePropagation(); showErrors(f, errs); }
      else if (!S.bypass) { acted(); f.__shMsg = savedMsg(f); }
    }
  }
  function onKeydown(e) {
    if (dlg.node && dlg.node.open) return; // the native dialog handles its own keys
    var o = qsa('.en__hubOverlay').filter(visible)[0]; if (!o) return;
    if (e.key === 'Escape') { var c = qs('.en__hubOverlay__header a', o); if (c) { e.preventDefault(); c.click(); } return; }
    if (e.key !== 'Tab') return;
    var pop = qs('.en__hubOverlay__popup', o) || o;
    var f = qsa('a[href], button, input:not([type="hidden"]), select, textarea, iframe, [tabindex]:not([tabindex="-1"])', pop).filter(visible);
    if (!f.length) return;
    if (!pop.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); return; }
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  function enhanceLogin() {
    var box = qs('.en__supporterHubLogin'); if (!box) return;
    var input = qs('.en__field--hublogin input', box), label = qs('.en__field--hublogin label', box), head = qs('.en__supporterHubLogin__header', box);
    if (head) { head.setAttribute('role', 'heading'); head.setAttribute('aria-level', '1'); }
    if (input) { input.id = input.id || 'sh-login-email'; input.setAttribute('autocomplete', 'email'); input.setAttribute('inputmode', 'email'); }
    if (label && input) label.setAttribute('for', input.id);
    qsa('.en__hubgadget__response--success, .en__hubgadget__response--loading', box).forEach(function (n) { n.setAttribute('role', 'status'); });
    qsa('.en__hubgadget__response--failure', box).forEach(function (n) { n.setAttribute('role', 'alert'); });
  }

  /* ---------- 10. Page frame: top bar, greeting (prototype) ---------- */
  function title(t) { document.title = t + ' · Stand.earth Donor Portal'; }
  function frame() {
    title(qs('.en__supporterHubLogin') ? 'Sign in' : qs('form[action*="/logout/"]') ? 'Signed out' : 'Your gifts and account');
    var bar = qs('.sh-topbar'), out = qs('#sh-logout'), help = qs('#sh-gethelp');
    if (bar) {
      var fit = function () { document.body.style.setProperty('--sh-topbar-h', bar.offsetHeight + 'px'); }; // the space under the fixed bar follows its real height
      fit(); if (window.ResizeObserver) new ResizeObserver(fit).observe(bar); else window.addEventListener('resize', fit);
    }
    var enOut = qs('.body-main a[href*="/logout/"]');
    if (enOut) { var blk = enOut.closest('.en__component--copyblock'); if (blk) blk.classList.add('sh-hidden'); } // one Log out, in the bar
    if (out && enOut) { out.href = enOut.href; out.hidden = false; var sep = qs('.sh-topbar__sep'); if (sep) sep.hidden = false; }
    if (help) help.addEventListener('click', function (e) { var c = qs('#sh-help'); if (!c) return; e.preventDefault(); c.scrollIntoView({ behavior: 'smooth', block: 'start' }); c.focus({ preventScroll: true }); });
  }
  function greeting() { // EN's welcome copy block: first line becomes the page heading, the rest the lede
    var first = qs('.en__component--hubgadget'), block = null;
    qsa('.body-main .en__component--copyblock').some(function (b) { if (first && first.compareDocumentPosition(b) & 2 && b.textContent.trim()) { block = b; return true; } return false; });
    if (!block || qs('h1', block) || block.hasAttribute('data-sh')) return; block.setAttribute('data-sh', '1');
    qsa('p, h2, h3, h4', block).filter(function (n) { return n.textContent.trim(); }).forEach(function (n, i) {
      if (i === 0) { n.classList.add('sh-hello'); n.setAttribute('role', 'heading'); n.setAttribute('aria-level', '1'); } else n.classList.add('sh-lede');
    });
  }

  /* ---------- 11. Boot ---------- */
  var scheduled = false;
  window.addEventListener('resize', function () { qsa('.en__hubOverlay').filter(visible).forEach(centerPopup); });
  function onMutations() {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(function () { scheduled = false; safe('overlays', syncOverlays); safe('tiles', enhanceTiles); });
  }
  function signedOut() { return qsa('.body-main .en__component--copyblock').some(function (b) { return /\{user_data~/.test(b.textContent); }); } // EN left its own name placeholder unfilled
  function showSignedOut() { // EN's session is half alive (another EN page was opened, or it timed out): EN's Logout ends it, then page 3 offers a new sign-in
    log('session: EN served the page with nobody signed in');
    var dash = qs('#sh-dash'); if (dash) dash.remove();
    if (qs('#sh-signedout')) return;
    var anchor = qs('.body-main .en__component--copyblock') || qs('.en__component--hubgadget'), c = CFG.contact, enOut = qs('.body-main a[href*="/logout/"]');
    ['#sh-logout', '.sh-topbar__sep'].forEach(function (x) { var n = qs(x); if (n) n.hidden = true; }); // EN's tiles and copy are hidden by a CSS rule (EN rewrites their classes)
    anchor.parentNode.insertBefore(el('section', { id: 'sh-signedout', class: 'sh-card', 'aria-labelledby': 'sh-signedout-h' }, [
      el('h1', { id: 'sh-signedout-h', text: 'Your session has ended' }),
      el('p', { text: 'For your security, the portal signs you out after a while, or when you open another Stand.earth page such as a donation form. To continue, finish signing out, then sign in again with a new link.' }),
      el('div', { class: 'sh-row', style: 'margin:16px 0' }, [el('a', { class: 'sh-btn', href: enOut ? enOut.href : location.origin + '/page/' + pageId() + '/' + CFG.signInPath, text: enOut ? 'Finish signing out' : 'Request a new sign-in link' })]),
      el('p', { class: 'sh-hint' }, ['Questions? Contact ' + c.name + ' at ', mailLink(), ' or ', el('a', { href: 'tel:+' + c.phoneDigits, text: c.phone }), '.'])]), anchor);
    title('Session ended');
  }
  function boot() {
    log('boot: page ' + (pageId() || 'not found') + ', ' + qsa('.en__component--hubgadget').length + ' gadget(s), jQuery ' + (window.jQuery ? window.jQuery.fn.jquery : 'not loaded'));
    safe('login', enhanceLogin); safe('frame', frame);
    if (!qs('.en__component--hubgadget')) return; // login and logout pages stop here
    document.addEventListener('click', onClickCapture, true); document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeydown);
    if (signedOut()) return safe('signed out', showSignedOut);
    safe('tiles', enhanceTiles); safe('greeting', greeting);
    safe('dashboard', mountDashboard);
    new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
