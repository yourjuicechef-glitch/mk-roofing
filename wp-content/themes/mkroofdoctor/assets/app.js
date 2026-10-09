/**
 * M&K | The Roof Doctor — the behaviour of the React + framer-motion source, without either.
 *
 *   motion        data-m carries each element's framer props (initial / animate / whileInView / exit)
 *   header, menu  scrolled state, mobile overlay
 *   wizards       the booking modal (every page) and the /book-inspection page share one controller
 *   photo drop    home page "Send us a few photos"
 *   filters       /projects and /insights category tabs
 *   contact       /contact form
 */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const wait = ms => new Promise(r => setTimeout(r, ms));
const tpl = name => $(`template[data-tpl="${name}"]`).content.firstElementChild.cloneNode(true);
const icon = (name, cls) => { const s = tpl('icon-' + name); s.setAttribute('class', `lucide lucide-${name} ${cls}`); return s; };
// Tailwind's conditional class pairs: `${on ? a : b}`
const swap = (el, on, a, b) => { el.classList.remove(...a.split(' '), ...b.split(' ')); el.classList.add(...(on ? a : b).split(' ')); };
const send = data => fetch(window.MK.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.ok, () => false);
const CALL_US = 'Sorry, that didn’t send. Please call 0800 474 8091.';

/* ------------------------------------------------------------------ motion */

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = { easeOut: 'ease-out', easeInOut: 'ease-in-out', easeIn: 'ease-in', linear: 'linear' };
const PROPS = ['opacity', 'translate', 'scale', 'width', 'height'];

// framer-motion's spring from 0 to 1 (mass 1, no initial velocity), sampled at 60fps.
// ponytail: closed form for underdamped springs only, which is every spring on this site;
// a critically/over-damped one is clamped to just-underdamped rather than solved properly.
function spring(stiffness = 100, damping = 10) {
  const w0 = Math.sqrt(stiffness), z = Math.min(damping / (2 * w0), 0.999), wd = w0 * Math.sqrt(1 - z * z), pts = [];
  let t = 0;
  for (; t < 3; t += 1 / 60) {
    const envelope = Math.exp(-z * w0 * t);
    pts.push(1 - envelope * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)));
    if (envelope < 0.002) break;
  }
  pts.push(1);
  return { duration: (t + 1 / 60) * 1000, pts };
}

// framer values ({opacity, x, y, scale, width, height}) -> CSS. x/y/scale use the individual
// transform properties so each can run on its own clock, as framer animates each value.
const px = v => typeof v === 'number' ? v + 'px' : v;
function cssOf(v) {
  const o = {};
  if ('opacity' in v) o.opacity = String(v.opacity);
  if ('x' in v || 'y' in v) o.translate = `${v.x || 0}px ${v.y || 0}px`;
  if ('scale' in v) o.scale = String(v.scale);
  if ('width' in v) o.width = px(v.width);
  if ('height' in v) o.height = px(v.height);
  return o;
}
const mix = (a, b, p) => Object.fromEntries(Object.keys(b).map(k => {
  const from = a[k] ?? b[k];
  return [k, typeof b[k] === 'number' && typeof from === 'number' ? from + (b[k] - from) * p : p < 1 ? from : b[k]];
}));

// How framer resolves a transition for one value.
function timing(prop, tr) {
  if (tr.type === 'spring') return spring(tr.stiffness, tr.damping);
  if (!Object.keys(tr).some(k => k !== 'delay')) // nothing but a delay: framer's per-value defaults
    return prop === 'translate' ? spring(500, 25) : prop === 'scale' ? spring(550, 30) : { duration: 300, easing: 'cubic-bezier(.25,.1,.35,1)' };
  return { duration: (tr.duration ?? 0.3) * 1000, easing: Array.isArray(tr.ease) ? `cubic-bezier(${tr.ease})` : EASE[tr.ease || 'easeOut'] };
}

const running = new WeakMap();
function settle(el) { // back to the stylesheet's own values, as framer leaves `transform: none`
  (running.get(el) || []).forEach(a => a.cancel());
  running.delete(el);
  PROPS.forEach(p => el.style.removeProperty(p));
}

function run(el, from, to, tr = {}) {
  if (to.height === 'auto') { // measure the natural height the element is growing to
    const held = el.style.height; el.style.height = ''; to = { ...to, height: el.offsetHeight }; el.style.height = held;
  }
  (running.get(el) || []).forEach(a => a.cancel()); // a newer animation replaces one still in flight
  const anims = Object.keys(cssOf(to)).map(prop => {
    const t = timing(prop, tr);
    const frames = (t.pts || [0, 1]).map(p => ({ [prop]: cssOf(mix(from, to, p))[prop] }));
    return el.animate(frames, { duration: still ? 0 : t.duration, delay: still ? 0 : (tr.delay || 0) * 1000, easing: t.easing || 'linear', fill: 'both' });
  });
  running.set(el, anims);
  return Promise.all(anims.map(a => a.finished)).then(() => true, () => false); // false: cancelled by a newer animation
}

const props = el => JSON.parse(el.dataset.m);
const enter = el => { const m = props(el); return run(el, m.initial, m.whileInView || m.animate, m.transition).then(done => done && settle(el)); };
const leave = el => { const m = props(el); return run(el, m.animate, m.exit, m.transition); };

const observers = new Map(); // one per rootMargin
function whenInView(el, margin = '0px') {
  if (!observers.has(margin)) observers.set(margin, new IntersectionObserver((entries, ob) => entries.forEach(e => {
    if (e.isIntersecting) { ob.unobserve(e.target); enter(e.target); }
  }), { rootMargin: margin }));
  observers.get(margin).observe(el);
}

// Start every framer element in `root`: put it in its initial state, then animate now or on scroll.
function mount(root) {
  for (const el of [root, ...$$('[data-m]', root)]) {
    if (!el.dataset || !el.dataset.m || el.closest('[hidden]')) continue;
    const m = props(el);
    settle(el);
    Object.assign(el.style, cssOf(m.initial));
    m.whileInView ? whenInView(el, m.viewport?.margin) : enter(el);
  }
}

/* ------------------------------------------------------------------ header + mobile menu */

const header = $('header'), menu = $('#mk-menu');
const closeMenu = () => leave(menu).then(() => { menu.hidden = true; });
if (header) {
  const onScroll = () => swap(header, scrollY > 24, 'bg-obsidian/60 backdrop-blur-md border-b border-white/10', 'bg-transparent');
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  $('[aria-label="Open menu"]').addEventListener('click', () => { menu.hidden = false; mount(menu); });
  $('[aria-label="Close menu"]').addEventListener('click', closeMenu);
}

/* ------------------------------------------------------------------ photo drop zones */

// Up to 8 files, appended. `files` is the caller's array and is changed in place.
function dropzone(zone, files, changed, hover = () => {}) {
  const input = $('input[type=file]', zone);
  const add = list => { files.push(...list); files.splice(8); changed(); };
  zone.addEventListener('click', () => input.click());
  input.addEventListener('click', e => e.stopPropagation()); // it sits inside the zone
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); hover(true); });
  zone.addEventListener('dragleave', () => hover(false));
  zone.addEventListener('drop', e => { e.preventDefault(); hover(false); add(e.dataTransfer.files); });
}

// The thumbnail grid under a drop zone.
function thumbs(zone, files, cls, changed) {
  if (zone.nextElementSibling?.hasAttribute('data-thumbs')) zone.nextElementSibling.remove();
  if (!files.length) return;
  const grid = document.createElement('div');
  grid.className = cls.grid; grid.dataset.thumbs = '';
  files.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = cls.item;
    if (file.type.startsWith('image/')) {
      const img = new Image(); img.src = URL.createObjectURL(file); img.alt = ''; img.className = 'w-full h-full object-cover';
      item.append(img);
    } else item.innerHTML = '<div class="w-full h-full grid place-items-center text-white/40 text-[9px]">VID</div>';
    const remove = document.createElement('button');
    remove.className = cls.remove; remove.append(icon('x', 'w-3 h-3'));
    remove.addEventListener('click', e => { e.stopPropagation(); files.splice(i, 1); changed(); });
    item.append(remove); grid.append(item);
  });
  zone.after(grid);
}
const HOVER_REMOVE = 'absolute top-1 right-1 grid place-items-center w-5 h-5 bg-obsidian/80 opacity-0 group-hover:opacity-100 transition-opacity';
const SQUARE = 'relative aspect-square overflow-hidden border border-white/10 group';

/* ------------------------------------------------------------------ booking wizards */

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, EMAIL = /\S+@\S+\.\S+/;
const LABEL = { commercial: 'Commercial', residential: 'Residential', heritage: 'Heritage', active_leak: 'Active Leak', 'full_re-roof': 'Full Re-Roof', survey: 'Survey', emergency: 'Emergency' };
const ERROR = {
  postcode: v => POSTCODE.test(v) ? '' : 'Invalid postcode', name: v => v.trim() ? '' : 'Required',
  phone: v => v.trim() ? '' : 'Required', email: v => EMAIL.test(v) ? '' : 'Invalid email',
};
const blank = () => ({ structure: '', issue: '', files: [], postcode: '', name: '', phone: '', email: '', notes: '', consent: false });
const pick = set => set[Math.floor(Math.random() * set.length)];

/**
 * One four-step wizard. `modal` picks between the two designs the source ships:
 *   modal  property -> issue -> photos -> details, with a summary column, field errors, emergency banner
 *   page   issue -> property -> photos -> details, plain
 */
function wizard(box, modal) {
  const choice = modal ? ['structure', 'issue'] : ['issue', 'structure'], T = modal ? 'step-' : 'book-step-';
  const wrap = $('[data-step-wrap]', box), back = $('[data-back]', box), next = $('[data-next]', box);
  const bars = $$('[data-bar]', box), labels = $$('[data-label]', box);
  const form = modal ? [$('[data-body]', box)] : [...box.children], host = modal ? form[0].parentElement : box;
  const pageRef = 'RD-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const THUMBS = modal
    ? { grid: 'mt-4 grid grid-cols-4 sm:grid-cols-6 gap-2', item: SQUARE, remove: HOVER_REMOVE }
    : { grid: 'mt-4 grid grid-cols-4 sm:grid-cols-6 gap-2', item: 'relative aspect-square overflow-hidden rounded-card-sm border border-white/10', remove: 'absolute top-1 right-1 grid place-items-center w-5 h-5 bg-obsidian/80' };
  let step = 0, d = blank(), touched = {}, swapping = false, banner = null, staged = null;
  if (modal) bars.forEach(b => { b.style.transition = 'width .5s ease-out'; });

  const valid = () => step < 2 ? !!d[choice[step]] : step === 2 || !!(POSTCODE.test(d.postcode) && d.name.trim() && d.phone.trim() && EMAIL.test(d.email) && d.consent);

  // Everything around the step panel: progress, summary, Back / Continue.
  function chrome() {
    bars.forEach((b, i) => modal ? (b.style.width = i <= step ? '100%' : '0%') : swap(b, i <= step, 'bg-ivory', 'bg-white/10'));
    labels.forEach((l, i) => swap(l, i <= step, 'text-surgical', modal ? 'text-white/30' : 'text-white/25'));
    back.disabled = step === 0;
    next.disabled = !valid();
    next.firstChild.textContent = (step === 3 ? 'Submit Request' : 'Continue') + (modal ? '' : ' ');
    $('[data-fail]', box)?.remove();
    if (!modal) return;
    const sum = (key, value, hot) => {
      const el = $(`[data-sum="${key}"]`, box);
      el.textContent = value || '—';
      el.className = 'text-sm ' + (hot ? 'text-red-400 font-semibold' : value ? 'text-white' : 'text-white/30');
    };
    sum('structure', LABEL[d.structure]); sum('issue', LABEL[d.issue], d.issue === 'emergency');
    sum('files', d.files.length ? `${d.files.length} file(s)` : ''); sum('postcode', d.postcode); sum('name', d.name);
  }

  // The selected state of the option cards in the current panel.
  function options() {
    const key = choice[step];
    $$('[data-opt]', wrap).forEach(btn => {
      const on = d[key] === btn.dataset.opt, red = modal && on && btn.dataset.opt === 'emergency';
      btn.classList.remove('border-copper', 'bg-copper/5', 'border-red-800/60', 'bg-red-800/10', 'border-white/10', 'hover:border-white/30');
      btn.classList.add(...(red ? ['border-red-800/60', 'bg-red-800/10'] : on ? ['border-copper', 'bg-copper/5'] : ['border-white/10', 'hover:border-white/30']));
      $('.lucide-check', btn)?.remove();
      if (on) btn.append(icon('check', key === 'issue' ? 'w-4 h-4 text-surgical' : modal ? 'absolute top-3 right-3 w-4 h-4 text-surgical' : 'w-4 h-4 text-surgical mt-2'));
      if (modal && key === 'structure') $$('svg [stroke]', btn).forEach(shape => { // the little building drawings
        shape.setAttribute('stroke', on ? '#1E3A5F' : 'rgba(255,255,255,0.4)');
        if (shape.hasAttribute('fill')) shape.setAttribute('fill', on ? 'rgba(30,58,95,0.12)' : 'transparent');
      });
      if (modal && key === 'issue') swap($('svg', btn), on, 'text-surgical', 'text-white/60');
    });
    if (modal && key === 'issue') {
      const hot = d.issue === 'emergency';
      if (hot && !banner) { banner = tpl('emergency'); $('.grid', wrap).before(banner); mount(banner); }
      if (!hot && banner) { banner.remove(); banner = null; }
    }
  }

  function fieldError(input) {
    if (!modal) return;
    const key = input.dataset.f, frame = input.parentElement.parentElement, msg = touched[key] && ERROR[key] ? ERROR[key](d[key]) : '';
    swap(frame, !!msg, 'border-red-500/50', 'border-white/10');
    $('[data-err]', frame)?.remove();
    if (msg) frame.insertAdjacentHTML('beforeend', `<div class="mt-1 text-[11px] text-red-400" data-err>${msg}</div>`);
  }

  function consentBox() {
    const tick = $('label > span', wrap);
    swap(tick, d.consent, 'bg-ivory border-ivory', modal ? 'border-white/30 group-hover:border-copper/60' : 'border-white/30');
    tick.replaceChildren(...(d.consent ? [icon('check', 'w-3.5 h-3.5 text-obsidian')] : []));
  }

  function panel() { // build the current step from its template and wire it
    banner = null;
    wrap.replaceChildren(tpl(T + step));
    if (step === 2) {
      const zone = $('[data-drop]', wrap), draw = () => { thumbs(zone, d.files, THUMBS, draw); chrome(); };
      dropzone(zone, d.files, draw);
      thumbs(zone, d.files, THUMBS, draw);
    }
    if (step === 3) {
      $$('[data-f]', wrap).forEach(input => {
        const key = input.dataset.f;
        if (key === 'consent') {
          input.checked = d.consent;
          input.addEventListener('change', () => { d.consent = input.checked; consentBox(); chrome(); });
          return;
        }
        input.value = d[key];
        input.addEventListener('input', () => { d[key] = input.value; fieldError(input); chrome(); });
        input.addEventListener('blur', () => { touched[key] = true; fieldError(input); });
        fieldError(input);
      });
      consentBox();
    }
    options();
    mount(wrap);
  }

  // AnimatePresence mode="wait": the old panel slides out, then the new one slides in.
  async function show(n) {
    const had = wrap.firstChild;
    step = n; chrome();
    if (had) { swapping = true; await leave(wrap); swapping = false; }
    if (step === n) panel();
  }

  // Swap the form for the "submitting" / "received" screen (null brings the form back).
  function stage(el) {
    staged?.remove(); staged = el;
    form.forEach(f => { f.hidden = !!el; });
    if (el) { host.append(el); mount(el); }
  }

  function reset() { d = blank(); touched = {}; step = 0; stage(null); wrap.replaceChildren(); }

  async function submit() {
    const ref = modal ? `RD-${pick('0123456789')}${pick('0123456789')}${pick('ABCDEFGHJKLMNPQRSTUVWXYZ')}${pick('0123456789')}${pick('ABCDEFGHJKLMNPQRSTUVWXYZ')}` : pageRef;
    stage(tpl(modal ? 'loading' : 'book-loading'));
    const [ok] = await Promise.all([send({ type: 'inspection', ref, ...d, files: d.files.map(f => f.name).join(', ') }), wait(modal ? 2200 : 2000)]);
    if (!ok) { // the source never sends anything, so it has no failure state: keep the form and say so
      stage(null);
      next.insertAdjacentHTML('beforebegin', `<span class="text-[11px] text-red-400" data-fail>${CALL_US}</span>`);
      return;
    }
    const done = tpl(modal ? 'success' : 'book-success');
    $('[data-ref]', done).textContent = ref;
    if (modal) {
      $('[data-name]', done).textContent = d.name || 'you';
      $('[data-reset]', done).addEventListener('click', () => { reset(); show(0); });
    }
    stage(done);
  }

  back.addEventListener('click', () => show(Math.max(0, step - 1)));
  next.addEventListener('click', () => step < 3 ? show(step + 1) : submit());
  wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-opt]');
    if (!btn || swapping) return;
    d[choice[step]] = btn.dataset.opt; chrome(); options();
  });

  if (!modal) { show(0); return; }

  // ---- modal only: opening and closing ----
  const sheet = $('[data-m]', box);
  const close = async () => {
    if (box.hidden) return;
    await Promise.all([leave(box), leave(sheet)]);
    box.hidden = true; reset();
  };
  box.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('roofdoctor:open-diagnostic', e => {
    const preset = e.detail || {};
    reset();
    d = { ...d, structure: preset.structure || '', issue: preset.issue || '', files: preset.files ? [...preset.files] : [] };
    box.hidden = false;
    mount(box);
    show(preset.structure && preset.issue ? 3 : preset.structure ? 1 : 0);
  });
}

const modalBox = $('#mk-modal'), pageBox = $('[data-wizard]');
if (modalBox) wizard(modalBox, true);
if (pageBox) wizard(pageBox, false);

/* ------------------------------------------------------------------ home: "Send us a few photos" */

const dropped = [], homeZone = $('main > section [data-drop]');
if (homeZone) {
  const cls = { grid: 'mt-4 grid grid-cols-4 sm:grid-cols-8 gap-2 max-w-lg mx-auto', item: SQUARE, remove: HOVER_REMOVE };
  const draw = () => thumbs(homeZone, dropped, cls, draw);
  dropzone(homeZone, dropped, draw, on => swap(homeZone, on, 'border-copper bg-copper/5', 'border-white/15 hover:border-white/30'));
}

// Every "Book an inspection" button, wherever it is.
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-book]');
  if (!btn) return;
  if (menu && !menu.hidden) closeMenu();
  const detail = btn.dataset.book === 'commercial' ? { structure: 'commercial' } : btn.dataset.book === 'files' ? { files: dropped } : {};
  document.dispatchEvent(new CustomEvent('roofdoctor:open-diagnostic', { detail }));
});

/* ------------------------------------------------------------------ /projects + /insights filters */

$$('main .no-scrollbar.pb-4.mb-8').forEach(bar => {
  const cards = [...bar.nextElementSibling.children];
  bar.addEventListener('click', e => {
    const tab = e.target.closest('button');
    if (!tab) return;
    [...bar.children].forEach(b => swap(b, b === tab, 'bg-ivory border-ivory text-obsidian', 'border-white/15 text-white/60 hover:text-white hover:border-white/30'));
    cards.forEach(card => { card.hidden = tab.textContent !== 'All' && $('.uppercase.text-surgical', card).textContent !== tab.textContent; });
  });
});

/* ------------------------------------------------------------------ /contact */

const contact = $('form[data-contact]');
if (contact) contact.addEventListener('submit', async e => {
  e.preventDefault();
  const [name, email, phone, message] = $$('input, textarea', contact).map(f => f.value), button = $('button', contact);
  button.disabled = true;
  $('[data-fail]', contact)?.remove();
  if (await send({ type: 'message', name, email, phone, message })) {
    contact.outerHTML = '<div class="border border-surgical/30 bg-surgical/5 rounded-card p-8 text-center"><div class="text-surgical font-heading text-lg font-semibold">Message received</div><p class="mt-2 text-sm text-white/55">We\'ll get back to you shortly.</p></div>';
  } else {
    button.disabled = false;
    button.insertAdjacentHTML('afterend', `<p class="text-[11px] text-red-400" data-fail>${CALL_US}</p>`);
  }
});

mount(document.body);
})();
