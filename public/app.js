'use strict';
(() => {
  const TZ = 'America/Argentina/Buenos_Aires', LOC = 'es-AR', DAY = 864e5;
  const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|gif|webp|mp4|webm|mov)$/;
  const EMOJIS = '😀 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😏 😅 😭 😡 🤯 😴 🤔 🙄 😬 🤗 🫠 🥲 😇 🤠 👍 👎 👏 🙌 🙏 💪 🤝 ✌️ 🤘 👀 💀 👻 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 🔥 ✨ ⭐ 🎉 🎂 🍕 🍔 🍺 🍷 🧉 ☕ 🎲 🎮 🎨 🖌️ 📸 🎵 ⚽ 🌙 ☀️ 🌈 🐶 🐱 🦊 🐸 🦄'.split(' ');
  const app = document.getElementById('app');
  const S = { me: null, users: {}, chat: [], posts: [], events: [], art: [], emojis: [], gifs: [], online: [], stats: { messages: 0 }, tab: 'posts', picker: null, typing: {}, dark: false };
  const R = {};
  let sock = null;
  try { S.dark = localStorage.getItem('upi_theme') === 'dark'; } catch (e) {}

  // ---------- tiny DOM helper (all user text goes in as text nodes, never HTML) ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const up = f => (FILE_RE.test(f || '') ? '/uploads/' + f : '');
  const isVideo = f => /\.(mp4|webm|mov)$/.test(f);
  const ini = n => (String(n || '?').trim().charAt(0) || '?').toUpperCase();
  const colorOf = id => `var(--n${(Number(id) || 0) % 6 + 1})`;
  const userOf = id => S.users[id] || { id, name: '?' };
  const clock = ts => new Date(ts).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  const todayAR = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const field = (label, el) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), el);
  const box = (title, body) => h('div', { class: 'box' }, h('div', { class: 'bar' }, title), body);
  function ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return 'recién';
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    return `hace ${Math.floor(s / 86400)} d`;
  }

  // ---------- API ----------
  async function api(path, body, isForm) {
    const opt = { method: body ? 'POST' : 'GET', headers: { 'X-Upi': '1' }, credentials: 'same-origin' };
    if (body) {
      if (isForm) opt.body = body;
      else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    }
    const r = await fetch(path, opt);
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (r.status === 401 && path !== '/api/status') setTimeout(boot, 0);
    if (!r.ok) { const e = new Error(j.error || 'server'); e.status = r.status; throw e; }
    return j;
  }
  const ERR = {
    rate: 'Vas muy rápido. Esperá unos segundos.',
    file: 'Ese archivo no se puede subir: tipo o tamaño no permitido (fotos JPG, PNG, GIF o WEBP hasta 12 MB; videos MP4, WEBM o MOV hasta 60 MB).',
    emoji_taken: 'Ese nombre de emoji ya lo usa otra persona.',
    empty: 'Escribí algo o agregá una foto.',
    name: 'El nombre debe tener entre 1 y 24 caracteres.',
    auth: 'Tu sesión terminó. Volvé a iniciar sesión.'
  };
  const errMsg = e => ERR[e.message] || 'Algo salió mal. Probá de nuevo.';
  const toast = msg => window.alert(msg);

  // ---------- theme ----------
  function applyTheme() {
    document.documentElement.className = S.dark ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-btn]').forEach(b => { b.textContent = S.dark ? '☀ Modo claro' : '☾ Modo oscuro'; });
  }
  function toggleTheme() {
    S.dark = !S.dark;
    try { localStorage.setItem('upi_theme', S.dark ? 'dark' : 'light'); } catch (e) {}
    applyTheme();
  }
  const themeBtn = () => h('button', { class: 'btn', type: 'button', 'data-theme-btn': '1', onclick: toggleTheme }, S.dark ? '☀ Modo claro' : '☾ Modo oscuro');

  // ---------- gate + auth ----------
  function screen(...kids) {
    app.replaceChildren(h('div', { class: 'corner' }, themeBtn()), h('div', { class: 'center-screen' }, h('div', { class: 'logo' }, 'Upipination'), ...kids));
  }
  function showGate() {
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', maxLength: 200, required: true });
    const err = h('div', { class: 'err' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Entrar »');
    screen(h('form', {
      class: 'box narrow',
      onsubmit: async e => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try { await api('/api/gate', { password: pw.value }); showAuth(); return; }
        catch (x) { err.textContent = x.status === 429 ? 'Demasiados intentos. Esperá 15 minutos.' : 'Esa no es. Preguntale a alguien del grupo.'; pw.value = ''; }
        btn.disabled = false;
      }
    },
    h('div', { class: 'bar' }, 'Acceso privado'),
    h('div', { class: 'pad' },
      h('div', { class: 'small' }, 'Este lugar es solo para nosotros. Ingresá la contraseña del grupo para entrar.'),
      field('Contraseña del grupo:', pw), err, h('div', { class: 'end' }, btn))));
    pw.focus();
  }
  const AUTH_ERR = {
    bad: 'El usuario o la contraseña no coinciden.',
    taken: 'Ese usuario ya existe. Probá iniciar sesión.',
    username: 'El usuario debe tener de 3 a 20 caracteres: letras minúsculas, números, punto o guion bajo.',
    password: 'La contraseña debe tener al menos 8 caracteres.',
    name: 'Elegí un nombre de 1 a 24 caracteres.',
    locked: 'Demasiados intentos. Esperá 15 minutos.',
    rate: 'Demasiados intentos. Esperá 15 minutos.'
  };
  function showAuth() {
    let mode = 'login';
    const user = h('input', { class: 'input', autocomplete: 'username', maxLength: 20, required: true, autocapitalize: 'none', spellcheck: 'false' });
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', maxLength: 200, required: true });
    const name = h('input', { class: 'input', maxLength: 24, placeholder: '¿Cómo te llamamos?' });
    const nameField = field('Tu nombre en el chat:', name);
    const err = h('div', { class: 'err' });
    const title = h('div', { class: 'bar' });
    const btn = h('button', { class: 'btn', type: 'submit' });
    const tLogin = h('button', { type: 'button', class: 'tab', onclick: () => set('login') }, 'Iniciar sesión');
    const tSign = h('button', { type: 'button', class: 'tab', onclick: () => set('signup') }, 'Registrarse');
    function set(m) {
      mode = m;
      tLogin.classList.toggle('on', m === 'login');
      tSign.classList.toggle('on', m === 'signup');
      nameField.classList.toggle('hidden', m !== 'signup');
      title.textContent = m === 'login' ? 'Hola de nuevo' : 'Unite al grupo';
      btn.textContent = (m === 'login' ? 'Iniciar sesión' : 'Crear cuenta') + ' »';
      pw.autocomplete = m === 'login' ? 'current-password' : 'new-password';
      err.textContent = '';
    }
    screen(h('form', {
      class: 'box narrow',
      onsubmit: async e => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try {
          await api(mode === 'login' ? '/api/login' : '/api/signup', { username: user.value, password: pw.value, name: name.value });
          await enter();
          return;
        } catch (x) {
          if (x.status === 403 && x.message === 'gate') { showGate(); return; }
          err.textContent = AUTH_ERR[x.message] || 'Algo salió mal. Probá de nuevo.';
        }
        btn.disabled = false;
      }
    }, title, h('div', { class: 'authtabs' }, tLogin, tSign),
    h('div', { class: 'pad' }, field('Usuario:', user), field('Contraseña:', pw), nameField, err, h('div', { class: 'end' }, btn))));
    set('login');
    user.focus();
  }

  // ---------- app ----------
  async function boot() {
    applyTheme();
    if (sock) { sock.disconnect(); sock = null; }
    clearInterval(R.clockTimer);
    try {
      const st = await api('/api/status');
      if (st.user) await enter();
      else if (st.gate) showAuth();
      else showGate();
    } catch (e) { showGate(); }
  }
  async function enter() { await loadState(); buildApp(); connect(); }
  async function loadState() {
    const st = await api('/api/state');
    S.me = st.me; S.users = {};
    st.users.forEach(u => { S.users[u.id] = u; });
    Object.assign(S, { chat: st.chat, posts: st.posts, events: st.events, art: st.art, emojis: st.emojis, gifs: st.gifs, stats: st.stats, online: st.online });
  }
  let reloadTimer;
  function reload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try { await loadState(); refreshAll(); renderChat(); } catch (e) {}
    }, 250);
  }

  function avatar(uid, size) {
    const u = userOf(uid), st = { width: size + 'px', height: size + 'px' };
    if (up(u.avatar)) return h('img', { class: 'av', src: up(u.avatar), alt: '', style: st });
    return h('span', { class: 'av av-i', style: { ...st, fontSize: Math.round(size * 0.45) + 'px' } }, ini(u.name));
  }

  function buildApp() {
    const cats = [[6, '50% 30%', -5, 4, 200], [1, '50% 35%', 3, -8, 180], [2, '50% 45%', -2, 12, 210], [8, '45% 60%', 4, -4, 185], [3, '50% 55%', -3, 8, 205], [4, '60% 50%', 2, -10, 180], [7, '50% 55%', -4, 6, 200], [5, '50% 35%', 5, -6, 190]];
    const collage = h('div', { class: 'collage-row' }, cats.map(([n, pos, rot, dy, ht], i) => h('img', {
      src: `/img/cat-${n}.png`, alt: '',
      style: { objectPosition: pos, height: ht + 'px', transform: `translateY(${dy}px) rotate(${rot}deg) scale(1.08)`, zIndex: String(i % 2 ? 2 : 1) }
    })));
    R.greet = h('b');
    R.clock = h('span', { class: 'muted' });
    const header = h('header', { class: 'box' },
      h('div', { class: 'collage' }, collage, h('div', { class: 'title-plate' }, 'Upipination')),
      h('div', { class: 'userbar' },
        h('span', null, 'Hola de nuevo, ', R.greet, ' · ', h('a', { href: '#', onclick: e => { e.preventDefault(); logout(); } }, 'Cerrar sesión')),
        h('div', { class: 'inline-form' }, R.clock, themeBtn())));

    const TABS = [['posts', 'POSTS'], ['event', 'PRÓXIMO EVENTO'], ['art', 'ARTE']];
    R.tabBtns = {};
    const nav = h('nav', { class: 'nav' }, TABS.map(([id, label]) => (R.tabBtns[id] = h('button', { type: 'button', onclick: () => setTab(id) }, label))));
    R.tickerText = h('span');
    const ticker = h('div', { class: 'ticker' }, R.tickerText);

    R.onlineCount = h('div', { class: 'small muted count' });
    R.onlineList = h('div');
    R.profile = h('div', { class: 'profile' });
    const left = h('aside', { class: 'side' },
      h('div', { class: 'box' }, h('div', { class: 'bar' }, 'Quién está conectado'), R.onlineCount, R.onlineList),
      box('Mi perfil', R.profile));

    R.chatCount = h('span', { class: 'small' });
    R.log = h('div', { class: 'log' });
    R.typing = h('div', { class: 'typing' });
    R.picker = h('div', { class: 'picker hidden' });
    R.chatInput = h('input', { class: 'input', autocomplete: 'off', maxLength: 1000, placeholder: 'Escribile algo al grupo', oninput: typingPing });
    R.meAv = h('span');
    R.meNick = h('b', { class: 'nick small' });
    const composer = h('form', { class: 'composer', onsubmit: sendChat }, R.meAv, R.meNick, R.chatInput,
      h('button', { type: 'button', class: 'btn', title: 'Emojis', onclick: () => togglePicker('emoji') }, '☺'),
      h('button', { type: 'button', class: 'btn', title: 'GIFs', onclick: () => togglePicker('gif') }, 'GIF'),
      h('button', { type: 'submit', class: 'btn' }, 'Enviar'));
    const chat = h('section', { class: 'box chat' }, h('div', { class: 'bar' }, h('span', null, 'Chat'), R.chatCount), R.log, R.typing, R.picker, composer);

    R.nextBox = h('div', { class: 'side-pad' });
    R.recentPosts = h('div');
    R.recentArt = h('div', { class: 'side-pad' });
    const right = h('aside', { class: 'side right' }, box('Próximo evento', R.nextBox), box('Últimos posts', R.recentPosts), box('Arte nuevo', R.recentArt));

    R.secTitle = h('div', { class: 'bar' });
    R.secBody = h('div', { class: 'section-body' });
    R.lightbox = h('div', { class: 'lightbox hidden', onclick: () => R.lightbox.classList.add('hidden') });

    app.replaceChildren(h('div', { class: 'wrap' }, header, nav, ticker, h('div', { class: 'cols' }, left, chat, right), h('section', { class: 'box' }, R.secTitle, R.secBody)), R.lightbox);
    R.builtTab = null; R.chatRendered = false; R.editingNick = false;
    refreshAll();
    renderChat();
    R.clockTimer = setInterval(tickClock, 1000);
    tickClock();
  }
  function tickClock() {
    R.clock.textContent = new Date().toLocaleString(LOC, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: TZ }) + ' ART';
  }
  function refreshAll() {
    updateMe(); updateOnline();
    if (!R.editingNick) updateProfile();
    updateTicker(); updateSide(); updateSection();
    if (S.picker === 'gif' || S.picker === 'custom') updatePicker();
  }
  function updateMe() {
    R.greet.textContent = S.me.name;
    R.greet.style.color = colorOf(S.me.id);
    R.meAv.replaceChildren(avatar(S.me.id, 24));
    R.meNick.textContent = S.me.name + ':';
    R.meNick.style.color = colorOf(S.me.id);
  }
  function updateOnline() {
    const ids = [S.me.id, ...S.online.filter(id => id !== S.me.id)];
    R.onlineCount.textContent = ids.length === 1 ? '1 usuario en línea' : `${ids.length} usuarios en línea`;
    R.chatCount.textContent = `${ids.length} conectados`;
    R.onlineList.replaceChildren(...ids.map(id => h('div', { class: 'row' },
      h('span', { class: 'dot' }), avatar(id, 18),
      h('b', { class: 'ellip', style: { color: colorOf(id) } }, userOf(id).name),
      h('span', { class: 'tiny muted' }, id === S.me.id ? 'vos' : 'en línea'))));
  }
  function updateProfile() {
    const hasPic = !!up(userOf(S.me.id).avatar);
    const picInput = () => h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', onchange: e => uploadAvatar(e.target) });
    const stat = (k, v) => h('div', null, h('span', { class: 'muted' }, k), h('b', null, String(v)));
    let nickArea;
    if (R.editingNick) {
      const nick = h('input', { class: 'input', maxLength: 24, value: S.me.name });
      nickArea = h('form', {
        class: 'inline-form',
        style: { width: '100%', flexWrap: 'nowrap' },
        onsubmit: async e => {
          e.preventDefault();
          try { await api('/api/nickname', { name: nick.value }); R.editingNick = false; await loadState(); refreshAll(); renderChat(); }
          catch (x) { toast(errMsg(x)); }
        }
      }, nick, h('button', { class: 'btn', type: 'submit' }, 'OK'), h('button', { class: 'btn', type: 'button', onclick: () => { R.editingNick = false; updateProfile(); } }, 'x'));
      setTimeout(() => nick.focus(), 0);
    } else {
      nickArea = h('div', { class: 'inline-form', style: { justifyContent: 'center' } },
        h('button', { class: 'btn', type: 'button', onclick: () => { R.editingNick = true; updateProfile(); } }, 'Cambiar apodo'),
        h('label', { class: 'btn' }, hasPic ? 'Cambiar foto' : 'Subir foto', picInput()));
    }
    R.profile.replaceChildren(
      h('label', { class: 'pic', title: 'Cambiar foto' }, avatar(S.me.id, 84), picInput()),
      h('b', { style: { fontSize: '13px', color: colorOf(S.me.id) } }, S.me.name),
      nickArea,
      h('div', { class: 'stats' },
        stat('Mensajes:', S.stats.messages),
        stat('Posts:', S.posts.filter(p => p.uid === S.me.id).length),
        stat('Arte:', S.art.filter(a => a.uid === S.me.id).length)));
  }

  function squareImage(file, size, type) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.naturalWidth - k) / 2, (img.naturalHeight - k) / 2, k, k, 0, 0, size, size);
        URL.revokeObjectURL(url);
        c.toBlob(b => (b ? resolve(b) : reject(new Error('file'))), type, 0.88);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('file')); };
      img.src = url;
    });
  }
  async function uploadAvatar(input) {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    try {
      const blob = f.type === 'image/gif' && f.size < 2.5e6 ? f : await squareImage(f, 256, 'image/jpeg');
      const fd = new FormData();
      fd.append('file', blob, 'avatar');
      await api('/api/avatar', fd, true);
    } catch (x) { toast(errMsg(x)); }
  }

  // ---------- events helpers ----------
  const upcoming = () => {
    const t = todayAR();
    return S.events.filter(e => e.date >= t).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  };
  function fmt(ev) {
    const dt = new Date(`${ev.date}T${ev.time || '00:00'}:00Z`);
    const days = Math.round((Date.parse(ev.date) - Date.parse(todayAR())) / DAY);
    const names = ev.going.map(id => userOf(id).name);
    return {
      ...ev,
      isGoing: ev.going.includes(S.me.id),
      dateText: dt.toLocaleDateString(LOC, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
      timeText: ev.time ? ev.time + ' h' : 'Hora a definir',
      countdown: days <= 0 ? 'Hoy' : days === 1 ? 'Mañana' : `En ${days} días`,
      goingText: names.length ? names.length + (names.length === 1 ? ' va' : ' van') : 'Nadie todavía',
      goingNames: names.length ? 'Van: ' + names.join(', ') : 'Nadie confirmó todavía'
    };
  }

  function updateTicker() {
    const nx = upcoming()[0];
    R.tickerText.textContent = [
      '★ Bienvenidos a Upipination',
      nx ? `★ Lo que viene: ${nx.title} · ${fmt(nx).dateText}` : '★ No hay eventos todavía, armá uno',
      `★ ${S.posts.length} posts en el muro`,
      '★ Subí tu arte a la galería',
      '★ Buena onda siempre'
    ].join('       ');
  }
  function updateSide() {
    const nx = upcoming()[0];
    const goEvent = h('button', { class: 'linkbtn', type: 'button', onclick: () => setTab('event') }, '» Ver eventos');
    if (nx) {
      const f = fmt(nx);
      R.nextBox.replaceChildren(h('span', { class: 'kicker' }, f.countdown), h('b', { style: { fontSize: '13px' } }, f.title), h('span', { class: 'small muted' }, `${f.dateText} · ${f.timeText}`), h('span', { class: 'small' }, f.goingText), goEvent);
    } else {
      R.nextBox.replaceChildren(h('span', { class: 'muted' }, 'Todavía no hay nada planeado.'), goEvent);
    }
    const recent = S.posts.slice(0, 3);
    R.recentPosts.replaceChildren(...(recent.length ? recent.map(p => h('div', { class: 'recent' },
      h('button', { class: 'linkbtn', type: 'button', onclick: () => setTab('posts') }, p.text || 'Compartió fotos o videos'),
      h('span', { class: 'tiny muted' }, `por ${userOf(p.uid).name} · ${ago(p.ts)}`))) : [h('div', { class: 'recent small muted' }, 'Todavía no hay posts.')]));
    const art = S.art.slice(0, 6);
    R.recentArt.replaceChildren(art.length
      ? h('div', { class: 'grid3' }, art.map(a => h('button', { class: 'thumb', type: 'button', onclick: () => openLightbox(up(a.file), `${userOf(a.uid).name} · ${ago(a.ts)}`) }, h('img', { src: up(a.file), alt: '', loading: 'lazy' }))))
      : h('button', { class: 'linkbtn', type: 'button', onclick: () => setTab('art') }, '» Subí el primero'));
  }
  function openLightbox(src, caption) {
    if (!src) return;
    R.lightbox.replaceChildren(h('figure', { class: 'box' }, h('div', { class: 'bar' }, caption), h('img', { src, alt: '' })));
    R.lightbox.classList.remove('hidden');
  }

  // ---------- section (posts / event / art) ----------
  const TITLES = { posts: 'Posts', event: 'Próximo evento', art: 'Arte' };
  function setTab(id) { S.tab = id; updateSection(); }
  function updateSection() {
    for (const id in R.tabBtns) R.tabBtns[id].classList.toggle('on', S.tab === id);
    if (R.builtTab !== S.tab) {
      R.builtTab = S.tab;
      R.secTitle.textContent = TITLES[S.tab];
      R.secList = h('div', { class: 'list' });
      const top = S.tab === 'posts' ? [postComposer()] : S.tab === 'event' ? eventControls() : artControls();
      R.secBody.replaceChildren(...top, R.secList);
    }
    const saved = {};
    let focusKey = null;
    R.secList.querySelectorAll('input[data-k]').forEach(i => { if (i.value) saved[i.dataset.k] = i.value; if (i === document.activeElement) focusKey = i.dataset.k; });
    R.secList.replaceChildren(...(S.tab === 'posts' ? postsList() : S.tab === 'event' ? eventsList() : artList()));
    R.secList.querySelectorAll('input[data-k]').forEach(i => { if (saved[i.dataset.k]) i.value = saved[i.dataset.k]; if (focusKey === i.dataset.k) i.focus(); });
  }

  function postComposer() {
    const text = h('textarea', { class: 'input', maxLength: 2000, placeholder: 'Compartí algo con el grupo' });
    let files = [];
    const prev = h('div', { class: 'pending' });
    const drawPrev = () => prev.replaceChildren(...files.map((x, i) => h('div', null,
      x.video ? h('video', { src: x.url, muted: true }) : h('img', { src: x.url, alt: '' }),
      h('button', { type: 'button', class: 'btn', title: 'Quitar', onclick: () => { URL.revokeObjectURL(x.url); files.splice(i, 1); drawPrev(); } }, 'x'))));
    const pick = h('input', {
      type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime', multiple: true,
      onchange: e => {
        for (const f of e.target.files) if (files.length < 6) files.push({ f, url: URL.createObjectURL(f), video: f.type.startsWith('video') });
        e.target.value = '';
        drawPrev();
      }
    });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Publicar');
    return h('form', {
      class: 'compose',
      onsubmit: async e => {
        e.preventDefault();
        if (!text.value.trim() && !files.length) return;
        const fd = new FormData();
        fd.append('text', text.value);
        files.forEach(x => fd.append('files', x.f));
        btn.disabled = true; btn.textContent = 'Subiendo...';
        try {
          await api('/api/posts', fd, true);
          text.value = '';
          files.forEach(x => URL.revokeObjectURL(x.url));
          files = [];
          drawPrev();
        } catch (x) { toast(errMsg(x)); }
        btn.disabled = false; btn.textContent = 'Publicar';
      }
    }, h('span', { class: 'label' }, 'Nuevo post:'), text, prev,
    h('div', { class: 'inline-form' }, h('label', { class: 'btn' }, 'Foto o video', pick), h('span', { class: 'tiny muted' }, 'Hasta 6 archivos'), h('span', { class: 'spacer' }), btn));
  }
  function postsList() {
    if (!S.posts.length) return [h('div', { class: 'empty' }, h('b', null, 'Todavía no hay posts.'), ' Sé el primero en compartir algo.')];
    const counts = {};
    S.posts.forEach(p => { counts[p.uid] = (counts[p.uid] || 0) + 1; });
    return S.posts.map(p => {
      const u = userOf(p.uid);
      const cin = h('input', { class: 'input', maxLength: 1000, placeholder: 'Escribí un comentario', autocomplete: 'off', 'data-k': 'c' + p.id });
      return h('article', { class: 'post' },
        h('div', { class: 'post-author' }, h('b', { style: { fontSize: '13px', color: colorOf(p.uid) } }, u.name), avatar(p.uid, 64), h('span', { class: 'tiny muted' }, 'Posts: ' + counts[p.uid])),
        h('div', { class: 'post-main' },
          h('div', { class: 'post-meta' }, 'Publicado ' + ago(p.ts)),
          h('div', { class: 'post-body' },
            p.text ? h('div', { class: 'post-text' }, p.text) : null,
            p.media.length ? h('div', { class: 'media' }, p.media.filter(up).map(f => h('div', null, isVideo(f)
              ? h('video', { src: up(f), controls: true, preload: 'metadata' })
              : h('img', { src: up(f), alt: '', loading: 'lazy', onclick: () => openLightbox(up(f), `${u.name} · ${ago(p.ts)}`) })))) : null),
          h('div', { class: 'comments' },
            p.comments.map(c => h('div', { class: 'comment' }, h('b', { style: { color: colorOf(c.uid) } }, userOf(c.uid).name + ':'), h('span', null, c.text), h('span', { class: 'when' }, ago(c.ts)))),
            h('form', {
              class: 'reply',
              onsubmit: async e => {
                e.preventDefault();
                const t = cin.value.trim();
                if (!t) return;
                try { await api(`/api/posts/${p.id}/comments`, { text: t }); cin.value = ''; } catch (x) { toast(errMsg(x)); }
              }
            }, cin, h('button', { class: 'btn', type: 'submit' }, 'Responder')))));
    });
  }

  function eventControls() {
    const title = h('input', { class: 'input', maxLength: 80, placeholder: 'Noche de juegos de mesa', required: true });
    const date = h('input', { class: 'input', type: 'date', min: todayAR(), required: true });
    const time = h('input', { class: 'input', type: 'time', value: '19:00' });
    const place = h('input', { class: 'input', maxLength: 80, placeholder: 'Casa de Leo' });
    const note = h('textarea', { class: 'input', maxLength: 1000, placeholder: 'Traigan algo para picar, la bebida la vemos.' });
    const toggleBtn = h('button', { class: 'btn', type: 'button' }, '+ Nuevo evento');
    const form = h('form', {
      class: 'compose hidden',
      onsubmit: async e => {
        e.preventDefault();
        try {
          await api('/api/events', { title: title.value, date: date.value, time: time.value, place: place.value, note: note.value });
          form.reset(); form.classList.add('hidden'); toggleBtn.textContent = '+ Nuevo evento';
        } catch (x) { toast(errMsg(x)); }
      }
    }, field('¿Qué pasa?', title), h('div', { class: 'grid3fields' }, field('Fecha:', date), field('Hora:', time), field('Dónde:', place)), field('Detalles:', note),
    h('div', { class: 'end' }, h('button', { class: 'btn', type: 'submit' }, 'Crear evento')));
    toggleBtn.addEventListener('click', () => {
      const hidden = form.classList.toggle('hidden');
      toggleBtn.textContent = hidden ? '+ Nuevo evento' : 'x Cancelar';
      if (!hidden) title.focus();
    });
    return [h('div', { class: 'end' }, toggleBtn), form];
  }
  function eventsList() {
    const list = upcoming();
    if (!list.length) return [h('div', { class: 'empty' }, h('b', null, 'Todavía no hay nada planeado.'), ' Elegí una fecha y juntemos a todos.')];
    const nx = fmt(list[0]);
    const out = [h('article', { class: 'announce' },
      h('div', { class: 'announce-bar' }, '★ Anuncio · ' + nx.countdown),
      h('div', { class: 'pad' },
        h('div', { class: 'event-title' }, nx.title),
        h('div', { class: 'facts' },
          h('span', null, h('b', null, 'Fecha: '), nx.dateText),
          h('span', null, h('b', null, 'Hora: '), nx.timeText),
          nx.place ? h('span', null, h('b', null, 'Dónde: '), nx.place) : null),
        nx.note ? h('div', { class: 'post-text' }, nx.note) : null,
        h('div', { class: 'inline-form' },
          h('button', { class: 'btn', type: 'button', onclick: () => api(`/api/events/${nx.id}/going`, {}).catch(x => toast(errMsg(x))) }, nx.isGoing ? '✔ Voy' : '+ Me sumo'),
          h('span', { class: 'small muted' }, nx.goingNames))))];
    if (list.length > 1) {
      out.push(h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Después'), h('th', null, 'Fecha'), h('th', null, 'Hora'), h('th', null, 'Van'))),
        h('tbody', null, list.slice(1).map(ev => {
          const f = fmt(ev);
          return h('tr', null, h('td', null, h('b', null, f.title)), h('td', null, f.dateText), h('td', null, f.timeText),
            h('td', null, h('button', { class: 'linkbtn', type: 'button', onclick: () => api(`/api/events/${f.id}/going`, {}).catch(x => toast(errMsg(x))) }, `${f.goingText} · ${f.isGoing ? 'no voy' : 'me sumo'}`)));
        }))));
    }
    return out;
  }

  function artControls() {
    const pick = h('input', {
      type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', multiple: true,
      onchange: async e => {
        const list = [...e.target.files].slice(0, 10);
        e.target.value = '';
        if (!list.length) return;
        const fd = new FormData();
        list.forEach(f => fd.append('files', f));
        try { await api('/api/art', fd, true); } catch (x) { toast(errMsg(x)); }
      }
    });
    return [h('div', { class: 'end' }, h('label', { class: 'btn' }, 'Subir arte', pick))];
  }
  function artList() {
    if (!S.art.length) return [h('div', { class: 'empty' }, h('b', null, 'Empezá la galería.'), ' Subí un boceto, un garabato, lo que hayas hecho.')];
    return [h('div', { class: 'gallery' }, S.art.map(a => {
      const cap = `${userOf(a.uid).name} · ${ago(a.ts)}`;
      return h('figure', null, h('button', { type: 'button', onclick: () => openLightbox(up(a.file), cap) }, h('img', { src: up(a.file), alt: '', loading: 'lazy' })), h('figcaption', null, cap));
    }))];
  }

  // ---------- chat ----------
  function parts(text) {
    if (!text) return [];
    const map = {};
    S.emojis.forEach(e => { map[e.name] = e.file; });
    return text.split(/(:[a-z0-9_]{2,24}:)/).filter(Boolean).map(t => {
      const k = t.slice(1, -1);
      return /^:[a-z0-9_]{2,24}:$/.test(t) && up(map[k]) ? h('img', { class: 'ce', src: up(map[k]), alt: t, title: t }) : t;
    });
  }
  function msgEl(m) {
    if (m.sys) return h('div', { class: 'msg sys' }, `[${clock(m.ts)}] *** ${m.text}`);
    const body = h('span', { class: 'msg-text' }, parts(m.text));
    if (up(m.gif)) body.append(h('img', { class: 'msg-gif', src: up(m.gif), alt: 'GIF', loading: 'lazy' }));
    return h('div', { class: 'msg' }, h('span', { class: 'time' }, `[${clock(m.ts)}]`), avatar(m.uid, 22), h('b', { class: 'nick', style: { color: colorOf(m.uid) } }, userOf(m.uid).name + ':'), body);
  }
  const nearBottom = () => R.log.scrollHeight - R.log.scrollTop - R.log.clientHeight < 80;
  function stick() { R.log.scrollTop = R.log.scrollHeight; setTimeout(() => { R.log.scrollTop = R.log.scrollHeight; }, 400); }
  function renderChat() {
    const wasNear = !R.chatRendered || nearBottom();
    const top = R.log.scrollTop;
    R.log.replaceChildren(...S.chat.map(msgEl));
    R.chatRendered = true;
    if (wasNear) stick(); else R.log.scrollTop = top;
  }
  function appendChat(m) {
    const wasNear = nearBottom();
    R.log.append(msgEl(m));
    if (wasNear || m.uid === S.me.id) stick();
  }
  function sendChat(e) {
    e.preventDefault();
    const text = R.chatInput.value.trim();
    if (!text || !sock) return;
    sock.emit('chat', { text }, ack => { if (ack && ack.error) toast(ack.error === 'rate' ? ERR.rate : 'No se pudo enviar el mensaje.'); });
    R.chatInput.value = '';
  }
  function typingPing() {
    if (!sock || Date.now() - (R.lastTyping || 0) < 2000) return;
    R.lastTyping = Date.now();
    sock.emit('typing');
  }
  function renderTyping() {
    const t = Date.now();
    const names = Object.keys(S.typing).filter(id => t - S.typing[id] < 3000 && Number(id) !== S.me.id).map(id => userOf(Number(id)).name);
    R.typing.textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'están' : 'está'} escribiendo...` : '';
  }
  function insert(s) { R.chatInput.value += s; R.chatInput.focus(); }

  function togglePicker(kind) {
    const open = S.picker === kind || (kind === 'emoji' && S.picker === 'custom');
    S.picker = open ? null : kind;
    updatePicker();
  }
  function updatePicker() {
    R.picker.classList.toggle('hidden', !S.picker);
    if (!S.picker) return;
    const tabs = [['emoji', 'Emojis'], ['custom', 'Mis emojis'], ['gif', 'GIFs']].map(([id, l]) =>
      h('button', { type: 'button', class: 'tab' + (S.picker === id ? ' on' : ''), onclick: () => { S.picker = id; updatePicker(); } }, l));
    let body;
    if (S.picker === 'emoji') {
      body = [h('div', { class: 'emoji-grid' }, EMOJIS.map(ch => h('button', { type: 'button', onclick: () => insert(ch) }, ch)))];
    } else if (S.picker === 'custom') {
      const nameIn = h('input', { class: 'input emoji-name', maxLength: 24, placeholder: 'nombre', value: R.emojiName || '', oninput: e => { R.emojiName = e.target.value; } });
      const fileIn = h('input', {
        type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp',
        onchange: e => {
          const f = e.target.files[0];
          if (!f) return;
          if (R.pendingEmoji) URL.revokeObjectURL(R.pendingEmoji.url);
          R.pendingEmoji = { file: f, url: URL.createObjectURL(f) };
          updatePicker();
        }
      });
      const form = h('form', {
        class: 'inline-form',
        onsubmit: async e => {
          e.preventDefault();
          const name = nameIn.value.trim().toLowerCase();
          if (!/^[a-z0-9_]{2,24}$/.test(name)) return toast('El nombre puede tener letras, números y guion bajo (de 2 a 24).');
          if (!R.pendingEmoji) return toast('Elegí una imagen o GIF.');
          const f = R.pendingEmoji.file;
          try {
            const blob = f.type === 'image/gif' || f.size < 1e6 ? f : await squareImage(f, 128, 'image/png');
            const fd = new FormData();
            fd.append('name', name);
            fd.append('file', blob, 'emoji');
            await api('/api/emojis', fd, true);
            URL.revokeObjectURL(R.pendingEmoji.url);
            R.pendingEmoji = null; R.emojiName = '';
            updatePicker();
          } catch (x) { toast(errMsg(x)); }
        }
      }, h('label', { class: 'btn' }, R.pendingEmoji ? h('img', { class: 'preview-img', src: R.pendingEmoji.url, alt: '' }) : null, 'Imagen o GIF', fileIn), nameIn, h('button', { class: 'btn', type: 'submit' }, 'Crear emoji'));
      body = [form, h('div', { class: 'small muted' }, 'Usalos en el chat escribiendo :nombre: o tocándolos acá.'),
        S.emojis.length ? h('div', { class: 'ce-grid' }, S.emojis.filter(x => up(x.file)).map(x => h('button', { type: 'button', title: `:${x.name}:`, onclick: () => insert(`:${x.name}: `) }, h('img', { src: up(x.file), alt: '' }), h('span', null, `:${x.name}:`)))) : null];
    } else {
      const fileIn = h('input', {
        type: 'file', accept: 'image/gif,image/webp', multiple: true,
        onchange: async e => {
          const list = [...e.target.files].slice(0, 6);
          e.target.value = '';
          if (!list.length) return;
          const fd = new FormData();
          list.forEach(f => fd.append('files', f));
          try { await api('/api/gifs', fd, true); } catch (x) { toast(errMsg(x)); }
        }
      });
      body = [h('div', { class: 'inline-form' }, h('label', { class: 'btn' }, 'Subir GIF', fileIn), h('span', { class: 'small muted' }, S.gifs.length ? 'Tocá un GIF para enviarlo' : 'Todavía no hay GIFs, subí el primero')),
        h('div', { class: 'thumbs' }, S.gifs.filter(g => up(g.file)).map(g => h('button', {
          class: 'thumb', type: 'button',
          onclick: () => { if (sock) sock.emit('chat', { gif: g.id }, ack => { if (ack && ack.error) toast(ERR.rate); }); S.picker = null; updatePicker(); }
        }, h('img', { src: up(g.file), alt: 'GIF', loading: 'lazy' }))))];
    }
    R.picker.replaceChildren(
      h('div', { class: 'picker-tabs' }, tabs, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'linkbtn', onclick: () => { S.picker = null; updatePicker(); } }, '[cerrar]')),
      h('div', { class: 'picker-body' }, body));
  }

  // ---------- realtime ----------
  function connect() {
    if (sock) sock.disconnect();
    let first = true;
    sock = window.io({ withCredentials: true });
    sock.on('connect', () => { if (!first) reload(); first = false; });
    sock.on('chat', m => {
      S.chat.push(m);
      if (S.chat.length > 500) { S.chat.shift(); if (R.log.firstChild) R.log.firstChild.remove(); }
      delete S.typing[m.uid];
      renderTyping();
      appendChat(m);
      if (!m.sys && m.uid === S.me.id) { S.stats.messages += 1; if (!R.editingNick) updateProfile(); }
    });
    sock.on('presence', ids => { S.online = ids; updateOnline(); });
    sock.on('typing', uid => { S.typing[uid] = Date.now(); renderTyping(); setTimeout(renderTyping, 3100); });
    sock.on('changed', reload);
    sock.on('logout', () => boot());
    sock.on('connect_error', err => { if (err && err.message === 'auth') boot(); });
  }
  async function logout() {
    try { await api('/api/logout', {}); } catch (e) {}
    boot();
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && R.lightbox) R.lightbox.classList.add('hidden'); });
  boot();
})();
