/*!
 * HomeFinder AI chat widget. Add to any page:
 *   <script src="https://your-server/widget.js" defer></script>
 * Options (data- attributes on the script tag):
 *   data-api="https://your-server"   API base (defaults to where this script is served from)
 *   data-title="HomeFinder AI"        Header title
 *   data-accent="#0f6b5c"             Accent colour
 *   data-open="true"                  Open on page load
 */
(function () {
  'use strict';
  if (window.HomeFinder) return;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var ds = (script && script.dataset) || {};
  var API = (ds.api || (script ? new URL(script.src, location.href).origin : '')).replace(/\/+$/, '');
  var TITLE = ds.title || 'HomeFinder AI';
  var ACCENT = ds.accent || '#0f6b5c';
  var STORE_KEY = 'homefinder-chat-v1';

  var state = { open: false, busy: false, messages: [], shownHomes: [], filters: null, focusHomeId: null, suggestions: [] };

  function load() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      if (saved && Array.isArray(saved.messages)) Object.assign(state, saved, { open: false, busy: false });
    } catch (e) { /* storage blocked: start fresh */ }
  }
  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ messages: state.messages.slice(-40), shownHomes: state.shownHomes, filters: state.filters, focusHomeId: state.focusHomeId, suggestions: state.suggestions }));
    } catch (e) { /* ignore */ }
  }

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u) ? u : '#'; }
  function money(n) { return n == null ? '' : '£' + Math.round(n).toLocaleString('en-GB'); }

  /** Tiny, safe markdown: escape first, then bold, italics, links, bullets, line breaks. */
  function md(text) {
    var lines = esc(text).split('\n');
    var html = '', inList = false;
    lines.forEach(function (line) {
      var bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
      if (bullet) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(bullet[1]) + '</li>'; return; }
      if (inList) { html += '</ul>'; inList = false; }
      if (/^#{1,4}\s/.test(line)) { html += '<p class="h">' + inline(line.replace(/^#+\s/, '')) + '</p>'; return; }
      html += line.trim() ? '<p>' + inline(line) + '</p>' : '';
    });
    if (inList) html += '</ul>';
    return html;
  }
  function inline(s) {
    return s
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (_, t, u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  var ICON = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-2.5-6.5z" fill="currentColor"/></svg>',
    bed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18v-7a2 2 0 0 1 2-2h6v5h10v4M3 14h18M7 12a1.5 1.5 0 1 0 0-3" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" stroke="currentColor" stroke-width="1.7" fill="none"/><circle cx="12" cy="11" r="2" fill="currentColor"/></svg>',
    ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.7" fill="none"/></svg>',
  };
  function svg(name) { var s = el('span', { class: 'ico' }); s.innerHTML = ICON[name]; return s; }

  // ---------- styles ----------
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.wrap{--accent:' + ACCENT + ';--ink:#1d2327;--muted:#5f6b70;--line:#e4e1da;--bg:#f7f5f1;--card:#fff;--soft:#eef4f2;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}',
    '.ico{display:inline-flex;width:18px;height:18px;flex:none}.ico svg{width:100%;height:100%}',
    '.launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:10px;height:56px;padding:0 20px 0 16px;border:0;border-radius:28px;background:var(--accent);color:#fff;font:600 15px/1 inherit;font-family:inherit;cursor:pointer;box-shadow:0 10px 30px rgba(15,40,35,.28);transition:transform .15s}',
    '.launcher:hover{transform:translateY(-2px)}.launcher .ico{width:22px;height:22px}',
    '.launcher[hidden]{display:none}',
    '.panel{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:410px;height:min(680px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--bg);border-radius:20px;overflow:hidden;box-shadow:0 24px 70px rgba(15,30,30,.32),0 0 0 1px rgba(0,0,0,.05);transform-origin:bottom right;animation:pop .18s ease-out}',
    '.panel[hidden]{display:none}',
    '@keyframes pop{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:none}}',
    '@media (max-width:520px){.panel{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}}',
    '.head{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 16px;background:var(--accent);color:#fff}',
    '.avatar{width:38px;height:38px;border-radius:12px;background:rgba(255,255,255,.16);display:grid;place-items:center}.avatar .ico{width:22px;height:22px}',
    '.head h2{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}.head p{margin:1px 0 0;font-size:12.5px;opacity:.85}',
    '.head .x{margin-left:auto;width:36px;height:36px;border:0;border-radius:10px;background:transparent;color:#fff;cursor:pointer;display:grid;place-items:center}.head .x:hover{background:rgba(255,255,255,.14)}',
    '.log{flex:1;overflow-y:auto;padding:16px 14px 8px;scroll-behavior:smooth}',
    '.msg{display:flex;margin:0 0 12px}.msg.user{justify-content:flex-end}',
    '.bubble{max-width:88%;padding:10px 13px;border-radius:16px;background:var(--card);box-shadow:0 1px 2px rgba(0,0,0,.05);font-size:14.5px;overflow-wrap:anywhere}',
    '.msg.user .bubble{background:var(--ink);color:#fff;border-bottom-right-radius:5px}.msg.bot .bubble{border-bottom-left-radius:5px}',
    '.bubble p{margin:0 0 7px}.bubble p:last-child{margin:0}.bubble p.h{font-weight:700;margin-top:6px}.bubble ul{margin:4px 0 8px;padding-left:18px}.bubble li{margin:2px 0}',
    '.bubble a{color:var(--accent);font-weight:600}.bubble code{font-size:13px;background:var(--soft);padding:1px 5px;border-radius:5px}',
    '.typing{display:inline-flex;gap:4px;padding:4px 2px}.typing i{width:7px;height:7px;border-radius:50%;background:#9aa5a8;animation:blink 1.2s infinite}.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}',
    '@keyframes blink{0%,80%,100%{opacity:.3}40%{opacity:1}}',
    '.meta{font-size:12px;color:var(--muted);margin:-4px 0 8px 4px}',
    '.cards{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 10px;margin:0 -14px 8px;padding-left:14px;padding-right:14px;scroll-snap-type:x mandatory}',
    '.card{flex:0 0 232px;scroll-snap-align:start;background:var(--card);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);display:flex;flex-direction:column}',
    '.pic{position:relative;aspect-ratio:16/10;background:linear-gradient(135deg,#dfe8e5,#efe9df)}.pic img{width:100%;height:100%;object-fit:cover;display:block}',
    '.price{position:absolute;left:8px;bottom:8px;background:rgba(20,26,28,.86);color:#fff;font-weight:700;font-size:13.5px;padding:4px 9px;border-radius:8px}',
    '.badge-top{position:absolute;left:8px;top:8px;background:#fff;color:var(--accent);font-weight:700;font-size:11px;padding:3px 7px;border-radius:6px;text-transform:uppercase;letter-spacing:.02em;max-width:85%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.cbody{padding:10px 12px 12px;display:flex;flex-direction:column;gap:5px;flex:1}',
    '.ctitle{font-weight:700;font-size:14.5px;line-height:1.3}',
    '.line{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12.5px}.line .ico{width:15px;height:15px}',
    '.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}.tag{font-size:11px;background:var(--soft);color:var(--accent);padding:2px 7px;border-radius:999px;font-weight:600}',
    '.actions{display:flex;gap:6px;margin-top:auto;padding-top:6px}',
    '.btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:34px;padding:0 10px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--ink);font:600 13px/1 inherit;font-family:inherit;cursor:pointer;text-decoration:none}',
    '.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn:hover{filter:brightness(.97)}.btn .ico{width:15px;height:15px}',
    '.detail{background:var(--card);border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);margin:0 0 12px}',
    '.gallery{display:grid;grid-template-columns:2fr 1fr;grid-template-rows:1fr 1fr;gap:3px;height:170px;background:#e9e6df}.gallery img{width:100%;height:100%;object-fit:cover;display:block}.gallery img:first-child{grid-row:1/3}',
    '.gallery.one{grid-template-columns:1fr}.gallery.one img{grid-row:auto}',
    '.dbody{padding:12px 14px 14px}',
    '.dprice{font-size:20px;font-weight:800;letter-spacing:-.01em}.dtitle{font-weight:700;margin-top:2px}',
    '.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}.fact{background:var(--bg);border-radius:10px;padding:7px 8px}.fact b{display:block;font-size:14px}.fact span{font-size:11.5px;color:var(--muted)}',
    'details{border-top:1px solid var(--line);padding:8px 0}details summary{cursor:pointer;font-weight:700;font-size:13.5px;list-style:none;display:flex;justify-content:space-between}details summary::after{content:"+";color:var(--muted)}details[open] summary::after{content:"–"}',
    'details ul{margin:6px 0 0;padding-left:18px;font-size:13.5px}details table{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}details td{padding:4px 0;border-bottom:1px dashed var(--line)}details td:last-child{text-align:right;color:var(--muted);white-space:nowrap;padding-left:8px}',
    '.chips{display:flex;gap:6px;overflow-x:auto;padding:6px 14px 2px}.chip{flex:none;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;padding:6px 11px;font:500 13px/1.2 inherit;font-family:inherit;cursor:pointer}.chip:hover{border-color:var(--accent);color:var(--accent)}',
    '.compose{display:flex;gap:8px;padding:10px 12px 8px;background:var(--bg)}',
    '.compose textarea{flex:1;resize:none;height:44px;max-height:110px;padding:11px 13px;border:1px solid var(--line);border-radius:14px;background:#fff;font:15px/1.4 inherit;font-family:inherit;color:var(--ink);outline:none}.compose textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(15,107,92,.12)}',
    '.compose button{width:44px;height:44px;border:0;border-radius:14px;background:var(--accent);color:#fff;cursor:pointer;display:grid;place-items:center}.compose button:disabled{opacity:.5;cursor:default}',
    '.foot{font-size:11px;color:var(--muted);text-align:center;padding:0 14px 10px;background:var(--bg)}',
    '.empty{text-align:center;color:var(--muted);padding:6px 10px 14px;font-size:13.5px}',
  ].join('\n');

  // ---------- DOM ----------
  var host = el('div', { id: 'homefinder-ai' });
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var wrap = el('div', { class: 'wrap' });
  root.appendChild(el('style', { text: CSS }));
  root.appendChild(wrap);

  var launcher = el('button', { class: 'launcher', 'aria-label': 'Open ' + TITLE, onclick: function () { open(); } }, [svg('home'), 'Find your new home']);
  var log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
  var chips = el('div', { class: 'chips' });
  var input = el('textarea', { rows: '1', placeholder: 'e.g. 3 bed house near Rugby under £350k', 'aria-label': 'Message' });
  var sendBtn = el('button', { type: 'submit', 'aria-label': 'Send' });
  sendBtn.innerHTML = ICON.send;
  var form = el('form', { class: 'compose', onsubmit: function (e) { e.preventDefault(); send(input.value); } }, [input, sendBtn]);
  var closeBtn = el('button', { class: 'x', 'aria-label': 'Close chat', onclick: function () { close(); } });
  closeBtn.innerHTML = ICON.close;
  var avatar = el('div', { class: 'avatar' }, [svg('home')]);
  var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': TITLE, hidden: '' }, [
    el('div', { class: 'head' }, [avatar, el('div', null, [el('h2', { text: TITLE }), el('p', { text: 'Live new-homes assistant' })]), closeBtn]),
    log,
    chips,
    form,
    el('div', { class: 'foot', text: 'Independent demo. Always confirm details with the builder.' }),
  ]);
  wrap.appendChild(launcher);
  wrap.appendChild(panel);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  input.addEventListener('input', function () { input.style.height = '44px'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) close(); });

  // ---------- rendering ----------
  function homeCard(h) {
    var img = h.image ? el('img', { src: h.image, alt: (h.houseType || 'Home') + ' at ' + (h.development || ''), loading: 'lazy', onerror: function () { this.remove(); } }) : null;
    var lead = (h.badges || [])[0];
    return el('article', { class: 'card' }, [
      el('div', { class: 'pic' }, [img, lead ? el('span', { class: 'badge-top', text: lead }) : null, el('span', { class: 'price', text: h.priceText || money(h.price) || 'Price on request' })]),
      el('div', { class: 'cbody' }, [
        el('div', { class: 'ctitle', text: (h.plotNo ? 'Plot ' + h.plotNo + ' · ' : '') + (h.title || 'New home') }),
        el('div', { class: 'line' }, [svg('pin'), el('span', { text: [h.development, h.town].filter(Boolean).join(', ') + (h.distanceMiles ? ' · ' + h.distanceMiles + ' mi' : '') })]),
        (h.badges || []).length > 1 ? el('div', { class: 'tags' }, h.badges.slice(1, 3).map(function (b) { return el('span', { class: 'tag', text: b }); })) : null,
        el('div', { class: 'actions' }, [
          el('button', { class: 'btn primary', type: 'button', onclick: function () { details(h); } }, ['Details']),
          el('a', { class: 'btn', href: safeUrl(h.url), target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open on the official website' }, ['View', svg('ext')]),
        ]),
      ]),
    ]);
  }

  function detailCard(d) {
    var imgs = (d.images || []).slice(0, 3);
    var gallery = imgs.length ? el('div', { class: 'gallery' + (imgs.length < 3 ? ' one' : '') }, imgs.slice(0, imgs.length < 3 ? 1 : 3).map(function (src, i) { return el('img', { src: src, alt: (d.houseType || 'Home') + ' photo ' + (i + 1), loading: 'lazy', onerror: function () { this.style.visibility = 'hidden'; } }); })) : null;
    var floors = {};
    (d.rooms || []).forEach(function (r) { (floors[r.floor || 'Rooms'] = floors[r.floor || 'Rooms'] || []).push(r); });
    var roomsBlock = d.rooms && d.rooms.length ? el('details', null, [el('summary', { text: 'Room sizes (' + d.rooms.length + ')' }), el('table', null, Object.keys(floors).reduce(function (rows, f) {
      rows.push(el('tr', null, [el('td', { colspan: '2' }, [el('strong', { text: f })])]));
      floors[f].forEach(function (r) { rows.push(el('tr', null, [el('td', { text: r.room }), el('td', { text: (r.imperial || '') + (r.metric ? '  ·  ' + r.metric.replace(/(\d{4})mm/g, function (_, mm) { return (mm / 1000).toFixed(2) + 'm'; }) : '') })])); });
      return rows;
    }, []))]) : null;
    var feats = (d.keyFeatures || []).length ? el('details', { open: '' }, [el('summary', { text: 'Key features' }), el('ul', null, d.keyFeatures.slice(0, 10).map(function (f) { return el('li', { text: f }); }))]) : null;
    var energy = (d.energyFeatures || []).length ? el('details', null, [el('summary', { text: 'Energy efficiency' }), el('ul', null, d.energyFeatures.map(function (f) { return el('li', { text: f }); }))]) : null;
    var show = d.nearestShowHome ? el('details', null, [el('summary', { text: 'Nearest show home' }), el('ul', null, [el('li', { text: d.nearestShowHome })])]) : null;
    return el('article', { class: 'detail' }, [
      gallery,
      el('div', { class: 'dbody' }, [
        el('div', { class: 'dprice', text: d.priceText || money(d.price) || 'Price on request' }),
        el('div', { class: 'dtitle', text: (d.plotNo ? 'Plot ' + d.plotNo + ' · ' : '') + (d.title || '') }),
        el('div', { class: 'line' }, [svg('pin'), el('span', { text: d.address || d.development || '' })]),
        (d.badges || []).length ? el('div', { class: 'tags' }, d.badges.map(function (b) { return el('span', { class: 'tag', text: b }); })) : null,
        el('div', { class: 'facts' }, [
          el('div', { class: 'fact' }, [el('b', { text: d.beds != null ? String(d.beds) : '–' }), el('span', { text: 'bedrooms' })]),
          el('div', { class: 'fact' }, [el('b', { text: d.rooms && d.rooms.length ? String(d.rooms.length) : '–' }), el('span', { text: 'rooms listed' })]),
          el('div', { class: 'fact' }, [el('b', { text: d.floorPlans && d.floorPlans.length ? String(d.floorPlans.length) : '–' }), el('span', { text: 'floors' })]),
        ]),
        feats, roomsBlock, energy, show,
        el('div', { class: 'actions' }, [
          el('a', { class: 'btn primary', href: safeUrl(d.url), target: '_blank', rel: 'noopener noreferrer' }, ['Book a viewing', svg('ext')]),
          d.salesPhone ? el('a', { class: 'btn', href: 'tel:' + d.salesPhone }, [svg('phone'), 'Call']) : null,
        ]),
      ]),
    ]);
  }

  function renderMessage(m) {
    var row = el('div', { class: 'msg ' + (m.role === 'user' ? 'user' : 'bot') });
    var bubble = el('div', { class: 'bubble' });
    if (m.role === 'user') bubble.textContent = m.content;
    else bubble.innerHTML = md(m.content);
    row.appendChild(bubble);
    log.appendChild(row);
    if (m.home) log.appendChild(detailCard(m.home));
    if (m.homes && m.homes.length) {
      if (m.total > m.homes.length) log.appendChild(el('div', { class: 'meta', text: 'Showing ' + m.homes.length + ' of ' + m.total + ' homes' }));
      log.appendChild(el('div', { class: 'cards' }, m.homes.map(homeCard)));
    }
  }

  function renderChips() {
    chips.innerHTML = '';
    (state.suggestions || []).forEach(function (s) { chips.appendChild(el('button', { class: 'chip', type: 'button', text: s, onclick: function () { send(s); } })); });
  }

  function renderAll() {
    log.innerHTML = '';
    if (!state.messages.length) {
      renderMessage({ role: 'assistant', content: "Hi! I'm **" + TITLE + "**. I read every new home for sale on the website and can filter them for you, then tell you everything about any home: rooms, offers, energy features, the area and how to book a viewing.\n\nWhat are you looking for?" });
      if (!state.suggestions.length) state.suggestions = ['3 bed homes under £350k', 'Homes ready to move into', 'Where do you have homes?', 'What is Part Exchange?'];
    }
    state.messages.forEach(renderMessage);
    renderChips();
    scrollDown();
  }

  function scrollDown() { requestAnimationFrame(function () { log.scrollTop = log.scrollHeight; }); }

  // ---------- behaviour ----------
  function open() {
    state.open = true;
    panel.hidden = false;
    launcher.hidden = true;
    renderAll();
    setTimeout(function () { input.focus(); }, 50);
  }
  function close() {
    state.open = false;
    panel.hidden = true;
    launcher.hidden = false;
    launcher.focus();
  }

  function details(h) {
    var label = 'Tell me about Plot ' + (h.plotNo || '') + (h.houseType ? ', the ' + h.houseType : '') + (h.development ? ' at ' + h.development : '');
    send(label.replace(/\s+/g, ' ').trim(), { type: 'details', homeId: h.id });
  }

  function send(text, action) {
    text = (text || '').trim();
    if (!text || state.busy) return;
    input.value = '';
    input.style.height = '44px';
    var history = state.messages.map(function (m) { return { role: m.role, content: m.content }; });
    var userMsg = { role: 'user', content: text };
    state.messages.push(userMsg);
    renderMessage(userMsg);
    state.suggestions = [];
    renderChips();
    var typing = el('div', { class: 'msg bot' }, [el('div', { class: 'bubble' }, [el('span', { class: 'typing', 'aria-label': 'Thinking' }, [el('i'), el('i'), el('i')])])]);
    log.appendChild(typing);
    scrollDown();
    state.busy = true;
    sendBtn.disabled = true;

    fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: history.slice(-12),
        context: { shownHomes: state.shownHomes.slice(0, 12), filters: state.filters || undefined, focusHomeId: state.focusHomeId || undefined },
        action: action,
      }),
    })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Request failed'); return j; }); })
      .then(function (res) {
        var botMsg = { role: 'assistant', content: res.reply || '…', homes: res.homes, home: res.home, total: res.total };
        typing.remove();
        state.messages.push(botMsg);
        renderMessage(botMsg);
        if (res.homes && res.homes.length) {
          state.shownHomes = res.homes.map(function (h) { return { id: h.id, title: h.title, development: h.development, town: h.town, priceText: h.priceText, price: h.price, plotNo: h.plotNo, houseType: h.houseType }; });
        }
        if (res.filters) state.filters = res.filters;
        state.focusHomeId = res.focusHomeId || state.focusHomeId;
        state.suggestions = res.suggestions || [];
        renderChips();
        save();
      })
      .catch(function (err) {
        typing.remove();
        renderMessage({ role: 'assistant', content: "Sorry, I couldn't reach the server (" + err.message + '). Please try again.' });
      })
      .then(function () {
        state.busy = false;
        sendBtn.disabled = false;
        scrollDown();
      });
  }

  function mount() {
    document.body.appendChild(host);
    load();
    if (ds.open === 'true') open();
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  window.HomeFinder = {
    open: open,
    close: close,
    ask: function (text) { if (!state.open) open(); send(text); },
    reset: function () { state.messages = []; state.shownHomes = []; state.filters = null; state.focusHomeId = null; state.suggestions = []; save(); renderAll(); },
  };
})();
