'use strict';
(() => {
  const TZ = 'America/Argentina/Buenos_Aires', LOC = 'es-AR', DAY = 864e5;
  const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|gif|webp|mp4|webm|mov)$/;
  const app = document.getElementById('app');
  const S = { me: null, users: {}, chat: [], posts: [], events: [], art: [], emojis: [], notifs: [], online: [], stats: { messages: 0 }, live: { vid: null }, ticker: null, banner: [], music: [], radio: { id: null }, tab: 'posts', pid: null, prof: null, picker: null, typing: {}, dark: false };
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
    emoji_taken: 'Ese nombre de emote ya lo usa otra persona.',
    empty: 'Escribí algo o agregá una foto.',
    name: 'El nombre debe tener entre 1 y 24 caracteres.',
    music_link: 'Ese link no parece de YouTube.',
    music_blocked: 'Ese video no existe o YouTube no deja reproducirlo fuera de su página.',
    music_full: 'La lista de música está llena (300 canciones). Sacá alguna primero.',
    banner_full: 'El banner ya tiene 60 fotos. Sacá alguna antes de agregar más.',
    profile: 'No se pudo guardar el perfil. Revisá que la frase tenga hasta 80 caracteres y el texto hasta 1000.',
    ticker: 'El banner admite hasta 8 frases de 100 caracteres cada una.',
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
    if (S.tab === 'profile') paintProfile(); // a profile's look is built on top of light or dark
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
    clearTheme();
    if (sock) { sock.disconnect(); sock = null; }
    clearInterval(R.clockTimer);
    try {
      const st = await api('/api/status');
      if (st.user) await enter();
      else if (st.gate) showAuth();
      else showGate();
    } catch (e) { showGate(); }
  }
  async function enter() { await loadState(); buildApp(); connect(); routeHash(); }
  async function loadState() {
    const st = await api('/api/state');
    S.me = st.me; S.users = {};
    st.users.forEach(u => { S.users[u.id] = u; });
    S.live = st.live; liveClock(st.live);
    Object.assign(S, { chat: st.chat, posts: st.posts, events: st.events, art: st.art, emojis: st.emojis, notifs: st.notifs, stats: st.stats, online: st.online, ticker: st.ticker, banner: st.banner, music: st.music, radio: st.radio });
    buildMentionRe();
  }
  let reloadTimer;
  function reload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try { await loadState(); refreshAll(); renderChat(); if (S.tab === 'profile') loadProfile(); } catch (e) {}
    }, 250);
  }

  function avatar(uid, size) {
    const u = userOf(uid), st = { width: size + 'px', height: size + 'px' };
    if (up(u.avatar)) return h('img', { class: 'av', src: up(u.avatar), alt: '', style: st });
    return h('span', { class: 'av av-i', style: { ...st, fontSize: Math.round(size * 0.45) + 'px' } }, ini(u.name));
  }

  function buildApp() {
    if (S.tab === 'profile') S.tab = 'posts';
    S.pid = null; S.prof = null; R.pf = null; R.draft = null; R.dirty = false;
    R.collage = h('div', { class: 'collage-row' });
    const collage = h('div', null, R.collage,
      h('button', { type: 'button', class: 'btn collage-edit', title: 'Cambiar las fotos de arriba', onclick: editBanner }, '✎ Fotos'));
    R.greet = h('b');
    R.clock = h('span', { class: 'muted' });
    const header = h('header', { class: 'box' },
      h('div', { class: 'collage' }, collage, h('div', { class: 'title-plate' }, 'Upipination')),
      (R.bannerPanel = h('div', { class: 'banner-panel hidden' })),
      h('div', { class: 'userbar' },
        h('span', null, 'Hola de nuevo, ', R.greet, ' · ', h('a', { href: '#', onclick: e => { e.preventDefault(); logout(); } }, 'Cerrar sesión')),
        h('div', { class: 'inline-form' }, R.clock, themeBtn())));

    const TABS = [['posts', 'POSTS'], ['event', 'PRÓXIMO EVENTO'], ['art', 'ARTE'], ['living', 'LIVING'], ['profile', 'PERFIL'], ['notifs', 'NOTIFICACIONES']];
    R.tabBtns = {};
    R.badge = h('span', { class: 'badge hidden' });
    const nav = h('nav', { class: 'nav' }, TABS.map(([id, label]) => (R.tabBtns[id] = h('button', { type: 'button', onclick: () => (id === 'profile' ? openProfile(S.me.id) : goTab(id)) }, label, id === 'notifs' ? R.badge : null))));
    R.tickerText = h('span');
    const ticker = h('div', { class: 'ticker-wrap' },
      h('div', { class: 'ticker' }, R.tickerText),
      h('button', { type: 'button', class: 'btn ticker-edit', title: 'Editar el banner', onclick: () => editTicker(ticker) }, '✎ Editar'));

    R.onlineCount = h('div', { class: 'small muted count' });
    R.onlineList = h('div');
    R.profile = h('div', { class: 'profile' });
    const left = h('aside', { class: 'side' },
      h('div', { class: 'box' }, h('div', { class: 'bar' }, 'Quién está conectado'), R.onlineCount, R.onlineList),
      box('Mi perfil', R.profile),
      musicBox());

    R.chatCount = h('span', { class: 'small' });
    R.log = h('div', { class: 'log' });
    R.typing = h('div', { class: 'typing' });
    R.picker = h('div', { class: 'picker hidden' });
    R.chatInput = h('input', { class: 'input', autocomplete: 'off', maxLength: 1000, placeholder: 'Escribile algo al grupo (usá @ para etiquetar)', oninput: typingPing });
    withMentions(R.chatInput);
    R.meAv = h('span');
    R.meNick = h('b', { class: 'nick small' });
    const composer = h('form', { class: 'composer', onsubmit: sendChat }, R.meAv, R.meNick, R.chatInput,
      h('button', { type: 'button', class: 'btn', title: 'Emotes', onclick: togglePicker }, '☺'),
      R.chatSend = h('button', { type: 'submit', class: 'btn' }, 'Enviar'));
    R.chatAttach = h('div', { class: 'attach hidden' });
    R.chatInput.addEventListener('paste', e => {
      const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); attachImage(f); }
    });
    const chat = h('section', {
      class: 'box chat',
      ondragover: e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); chat.classList.add('drop'); } },
      ondragleave: e => { if (!chat.contains(e.relatedTarget)) chat.classList.remove('drop'); },
      ondrop: e => {
        chat.classList.remove('drop');
        const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
        if (f) { e.preventDefault(); attachImage(f); }
      }
    }, h('div', { class: 'bar' }, h('span', null, 'Chat'), R.chatCount), R.log, R.typing, R.picker, R.chatAttach, composer);

    R.nextBox = h('div', { class: 'side-pad' });
    R.recentPosts = h('div');
    R.recentArt = h('div', { class: 'side-pad' });
    const right = h('aside', { class: 'side right' }, box('Próximo evento', R.nextBox), box('Últimos posts', R.recentPosts), box('Arte nuevo', R.recentArt));

    R.liveStage = h('div', { class: 'live-stage' });
    R.liveInfo = h('span', { class: 'small' });
    R.liveUrl = h('input', { class: 'input', type: 'url', maxLength: 300, placeholder: 'Pegá un link de YouTube' });
    R.liveStop = h('button', { type: 'button', class: 'btn', onclick: () => { if (confirm('¿Sacar el video para todos?')) sock.emit('live:stop'); } }, 'Sacar video');
    const liveForm = h('form', {
      class: 'live-bar',
      onsubmit: e => { e.preventDefault(); const v = R.liveUrl.value.trim(); if (!v) return; sock.emit('live:set', v); R.liveUrl.value = ''; }
    }, R.liveUrl, h('button', { type: 'submit', class: 'btn' }, 'Poner'), R.liveStop);
    R.liveBox = h('section', { class: 'box live' }, h('div', { class: 'bar' }, h('span', null, 'Living'), R.liveInfo), R.liveStage, liveForm);

    R.secTitle = h('div', { class: 'bar' });
    R.secBody = h('div', { class: 'section-body' });
    R.lightbox = h('div', { class: 'lightbox hidden', onclick: () => R.lightbox.classList.add('hidden') });

    app.replaceChildren(R.wrap = h('div', { class: 'wrap' }, header, nav, ticker, h('div', { class: 'cols' }, left, R.liveBox, chat, right), (R.pview = h('div', { class: 'pview' })), (R.section = h('section', { class: 'box section' }, R.secTitle, R.secBody))), R.lightbox);
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
    updateTicker(); updateCollage(); updateMusic(); updateSide(); updateBadge(); updateSection();
    if (S.picker) updatePicker();
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
      h('b', { class: 'ellip go', style: { color: colorOf(id) }, title: 'Ver su perfil', onclick: () => openProfile(id) }, userOf(id).name),
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
        h('label', { class: 'btn' }, hasPic ? 'Cambiar foto' : 'Subir foto', picInput()),
        h('button', { class: 'btn', type: 'button', onclick: () => openProfile(S.me.id) }, 'Ver mi perfil'));
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

  // ---------- music: shared queue played as a radio, in sync for everyone online ----------
  // The server says which song, where it is and whether it's playing (like Living).
  // Each browser starts muted (browsers only allow sound after a click) until the person taps "Escuchar".
  const MU = { vid: null, player: null, ready: false, listening: false, fails: 0, stuck: 0 };
  let muWant = false; // listening preference, remembered per browser
  try { muWant = localStorage.getItem('upi_radio') === '1'; } catch (e) {}
  function radioTarget() {
    const r = S.radio;
    return r.playing ? r.pos + (serverNow() - r.at) / 1000 : r.pos;
  }
  function musicBox() {
    R.musicGif = h('img', { class: 'pirate', src: '/img/pirate-radio.gif', alt: 'Pirata bailando con una radio' });
    R.musicNow = h('div', { class: 'music-now small' });
    R.musicPlay = h('button', { type: 'button', class: 'btn', title: 'Reproducir / pausar para todos', onclick: radioToggle }, '▶');
    R.musicEar = h('button', { type: 'button', class: 'btn music-ear', onclick: radioListen });
    // the video stays loaded (that's what plays the sound) but is tucked away unless someone wants to see it
    R.musicStage = h('div', { class: 'music-stage tucked' });
    R.musicVid = h('button', { type: 'button', class: 'btn', title: 'Mostrar / ocultar el video', hidden: true, onclick: () => { R.musicStage.classList.toggle('tucked'); R.musicVid.classList.toggle('on'); } }, '📺');
    R.musicList = h('ol', { class: 'music-list' });
    R.musicCount = h('span', { class: 'small' });
    const url = h('input', { class: 'input', type: 'url', maxLength: 300, placeholder: 'Link de YouTube' });
    const add = h('button', { type: 'submit', class: 'btn' }, 'Agregar');
    const form = h('form', {
      class: 'music-add',
      onsubmit: async e => {
        e.preventDefault();
        const v = url.value.trim();
        if (!v) return;
        add.disabled = true;
        try { await api('/api/music', { url: v }); url.value = ''; } catch (x) { toast(errMsg(x)); }
        add.disabled = false;
      }
    }, url, add);
    setInterval(radioSync, 1000);
    return h('div', { class: 'box music' },
      h('div', { class: 'bar' }, h('span', null, 'Radio'), R.musicCount),
      h('div', { class: 'music-deck' }, R.musicGif, R.musicNow,
        h('div', { class: 'music-ctl' },
          h('button', { type: 'button', class: 'btn', title: 'Anterior (para todos)', onclick: () => radioSend('radio:prev') }, '⏮'),
          R.musicPlay,
          h('button', { type: 'button', class: 'btn', title: 'Siguiente (para todos)', onclick: () => radioSend('radio:next') }, '⏭'),
          R.musicVid),
        R.musicEar),
      R.musicStage, R.musicList, form);
  }
  const radioSend = ev => { if (sock && S.radio.id) sock.emit(ev, S.radio.id); };
  function radioToggle() {
    if (!sock) return;
    if (!S.radio.id) { if (S.music.length) sock.emit('radio:play', S.music[0].id); return; }
    sock.emit('radio:ctl', { id: S.radio.id, playing: !S.radio.playing });
    if (!S.radio.playing && !MU.listening) radioListen(); // pressing play means you want to hear it
  }
  // the click that lets this browser make sound
  function radioListen() {
    MU.listening = !MU.listening;
    muWant = MU.listening;
    try { localStorage.setItem('upi_radio', muWant ? '1' : '0'); } catch (e) {}
    if (MU.player && MU.ready) {
      if (radioAudible()) { MU.player.unMute(); MU.player.setVolume(100); if (S.radio.playing) MU.player.playVideo(); }
      else MU.player.mute();
    }
    updateMusic();
  }
  // Living has its own video; don't play both at once for the same person
  const radioAudible = () => MU.listening && !(S.tab === 'living' && S.live.vid);
  function updateMusic() {
    if (!R.musicList) return;
    const list = S.music, r = S.radio;
    R.musicCount.textContent = list.length === 1 ? '1 canción' : `${list.length} canciones`;
    R.musicList.replaceChildren(...(list.length ? list.map(m => h('li', { class: m.id === r.id ? 'on' : '' },
      h('button', { type: 'button', class: 'linkbtn music-title', title: 'Poner para todos: ' + m.title, onclick: () => { if (sock) sock.emit('radio:play', m.id); if (!MU.listening) radioListen(); } }, m.title),
      h('span', { class: 'tiny muted' }, userOf(m.uid).name),
      h('button', {
        type: 'button', class: 'btn music-x', title: 'Sacar de la lista',
        onclick: async () => {
          if (!confirm(`¿Sacar "${m.title}" de la lista?`)) return;
          try { await api(`/api/music/${m.id}/delete`, {}); } catch (x) { toast(errMsg(x)); }
        }
      }, 'x'))) : [h('li', { class: 'muted small empty-li' }, 'Todavía no hay música. Pegá un link de YouTube abajo.')]));
    R.musicNow.replaceChildren(r.id ? h('b', { title: r.title }, (r.playing ? '' : '(en pausa) ') + r.title) : h('span', { class: 'muted' }, 'La radio está apagada'));
    R.musicPlay.textContent = r.playing ? '⏸' : '▶';
    R.musicGif.classList.toggle('still', !(r.playing && MU.listening));
    R.musicEar.hidden = !r.id;
    R.musicEar.classList.toggle('call', !MU.listening);
    R.musicEar.textContent = MU.listening ? '🔇 Silenciar para mí' : '🔊 Escuchar';
    R.musicEar.title = MU.listening ? 'Deja de sonar solo en tu compu; la radio sigue para los demás' : 'Empezar a escuchar la radio del grupo';
    radioSync();
  }
  // bring this browser's player in line with the radio
  async function radioSync() {
    const r = S.radio;
    if (!R.musicStage) return;
    if (!r.id) {
      if (MU.player && MU.ready) MU.player.pauseVideo();
      return;
    }
    if (!MU.player) {
      if (!r.playing) return; // nothing to hear yet
      MU.listening = muWant; // may still be blocked until a click; the button stays visible either way
      MU.vid = r.vid;
      const iframe = h('iframe', {
        title: 'Radio', allow: 'autoplay; encrypted-media', referrerpolicy: 'strict-origin-when-cross-origin', // YouTube refuses to play embeds without it
        src: `https://www.youtube-nocookie.com/embed/${r.vid}?enablejsapi=1&playsinline=1&rel=0&autoplay=1&mute=1&start=${Math.floor(radioTarget())}&origin=${encodeURIComponent(location.origin)}`
      });
      R.musicStage.replaceChildren(iframe);
      R.musicVid.hidden = false;
      MU.player = 'loading';
      try { await loadYT(); } catch (e) { MU.player = null; return; }
      MU.player = new window.YT.Player(iframe, {
        events: {
          onReady: () => { MU.ready = true; if (radioAudible()) MU.player.unMute(); radioSync(); updateMusic(); },
          onStateChange: e => {
            if (e.data === 1) MU.fails = 0;
            if (e.data === 0 && sock) sock.emit('radio:ended', S.radio.id);
          },
          // can't play here: let the radio move on once it's had a fair chance (the server ignores it if too early)
          onError: () => { MU.fails++; setTimeout(() => { if (sock && S.radio.vid === MU.vid) sock.emit('radio:ended', S.radio.id); }, 8000); }
        }
      });
      return;
    }
    if (!MU.ready) return;
    const p = MU.player, want = radioTarget();
    if (radioAudible()) { if (p.isMuted()) p.unMute(); } else if (!p.isMuted()) p.mute();
    if (r.vid !== MU.vid) {
      MU.vid = r.vid;
      if (r.playing) p.loadVideoById(r.vid, want); else p.cueVideoById(r.vid, want);
      return;
    }
    const st = p.getPlayerState(), cur = p.getCurrentTime();
    if (r.playing) {
      if (st === 0) return; // ended here; waiting for the radio to move on
      if (Math.abs(cur - want) > 3) p.seekTo(want, true);
      if (st === 1 || st === 3) MU.stuck = 0;
      else {
        p.playVideo();
        // the browser won't play with sound until this person clicks: go back to muted and show "Escuchar"
        if (MU.listening && !MU.fails && ++MU.stuck > 3) { MU.stuck = 0; MU.listening = false; p.mute(); p.playVideo(); updateMusic(); }
      }
    } else {
      if (st === 1 || st === 3) p.pauseVideo();
      if (Math.abs(cur - want) > 1) p.seekTo(want, true);
    }
  }

  // ---------- header photo collage ----------
  // 12 tilted frames: [tilt, vertical offset, height]
  const SLOTS = [[-5, 4, 200], [3, -8, 180], [-2, 12, 210], [4, -4, 185], [-3, 8, 205], [2, -10, 180], [-4, 6, 200], [5, -6, 190], [-2, 10, 195], [3, -6, 185], [-5, 2, 205], [4, -8, 190]];
  // the built-in cats look best framed on their faces
  const CAT_POS = { 1: '50% 35%', 2: '50% 45%', 3: '50% 55%', 4: '60% 50%', 5: '50% 35%', 6: '50% 30%', 7: '50% 55%', 8: '45% 60%' };
  const bannerSrc = f => (/^cat-[1-8]\.png$/.test(f) ? '/img/' + f : up(f));
  const bannerPos = f => CAT_POS[(f.match(/^cat-([1-8])\.png$/) || [])[1]] || '50% 40%';
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function setFrame(img, b) {
    img.dataset.id = b.id;
    img.src = bannerSrc(b.file);
    img.style.objectPosition = bannerPos(b.file);
  }
  function updateCollage() {
    const pool = S.banner.filter(b => bannerSrc(b.file));
    const key = pool.map(b => b.id).join(',');
    if (key !== R.collageKey) {
      R.collageKey = key;
      const shown = shuffle(pool.slice()).slice(0, SLOTS.length);
      R.collage.replaceChildren(...shown.map((b, i) => {
        const [rot, dy, ht] = SLOTS[i];
        const img = h('img', { alt: '', style: { height: ht + 'px', transform: `translateY(${dy}px) rotate(${rot}deg) scale(1.08)`, zIndex: String(i % 2 ? 2 : 1) } });
        setFrame(img, b);
        return img;
      }));
    }
    if (R.bannerPanel && !R.bannerPanel.classList.contains('hidden')) drawBannerPanel();
  }
  // with more photos than frames, swap one frame for an unseen photo every few seconds
  setInterval(() => {
    if (!R.collage || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const frames = [...R.collage.children];
    const on = new Set(frames.map(f => f.dataset.id));
    const rest = S.banner.filter(b => bannerSrc(b.file) && !on.has(String(b.id)));
    if (!frames.length || !rest.length) return;
    const img = frames[Math.floor(Math.random() * frames.length)];
    const next = rest[Math.floor(Math.random() * rest.length)];
    const pre = new Image();
    pre.onload = () => {
      img.classList.add('fade');
      setTimeout(() => { setFrame(img, next); img.classList.remove('fade'); }, 400);
    };
    pre.src = bannerSrc(next.file);
  }, 5000);
  function editBanner() {
    const p = R.bannerPanel;
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) drawBannerPanel();
  }
  function drawBannerPanel() {
    const pick = h('input', {
      type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', multiple: true,
      onchange: async e => {
        const list = [...e.target.files].slice(0, 6);
        e.target.value = '';
        if (!list.length) return;
        const fd = new FormData();
        for (const f of list) fd.append('files', await fitImage(f, 1200));
        try { await api('/api/banner', fd, true); } catch (x) { toast(errMsg(x)); }
      }
    });
    R.bannerPanel.replaceChildren(
      h('div', { class: 'inline-form' },
        h('b', null, `Fotos del banner (${S.banner.length})`),
        h('span', { class: 'small muted' }, 'Se muestran 12 a la vez y van rotando. Cualquiera puede agregar o sacar.'),
        h('span', { class: 'spacer' }),
        h('label', { class: 'btn' }, 'Agregar fotos', pick),
        h('button', { type: 'button', class: 'btn', onclick: editBanner }, 'Cerrar')),
      h('div', { class: 'banner-grid' }, S.banner.filter(b => bannerSrc(b.file)).map(b => h('div', { class: 'thumb' },
        h('img', { src: bannerSrc(b.file), alt: '', loading: 'lazy' }),
        h('button', {
          type: 'button', class: 'btn', title: 'Sacar del banner',
          onclick: async () => {
            if (!confirm('¿Sacar esta foto del banner?')) return;
            try { await api(`/api/banner/${b.id}/delete`, {}); } catch (x) { toast(errMsg(x)); }
          }
        }, 'x')))));
  }

  const TICKER_DEFAULT = ['Bienvenidos a Upipination', 'Subí tu arte a la galería', 'Buena onda siempre'];
  function updateTicker() {
    const nx = upcoming()[0];
    const mine = S.ticker || TICKER_DEFAULT;
    R.tickerText.textContent = [
      ...mine.slice(0, 1),
      nx ? `Lo que viene: ${nx.title} · ${fmt(nx).dateText}` : 'No hay eventos todavía, armá uno',
      `${S.posts.length} posts en el muro`,
      ...mine.slice(1)
    ].map(t => '★ ' + t).join('       ');
  }
  // Swap the banner for a small form; one phrase per line.
  function editTicker(wrap) {
    if (wrap.querySelector('form')) return;
    const text = h('textarea', { class: 'input', rows: 4, placeholder: 'Una frase por línea' });
    text.value = (S.ticker || TICKER_DEFAULT).join('\n');
    const save = h('button', { class: 'btn', type: 'submit' }, 'Guardar');
    const close = () => { form.remove(); wrap.classList.remove('editing'); };
    const form = h('form', {
      class: 'ticker-form box',
      onsubmit: async e => {
        e.preventDefault();
        save.disabled = true;
        try {
          await api('/api/ticker', { lines: text.value.split('\n') });
          close();
        } catch (x) { toast(errMsg(x)); save.disabled = false; }
      }
    },
      h('span', { class: 'small muted' }, 'Frases del banner, una por línea (hasta 8). El próximo evento y la cantidad de posts se agregan solos. Todos ven el cambio.'),
      text,
      h('div', { class: 'inline-form' }, save, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
    wrap.classList.add('editing');
    wrap.append(form);
    text.focus();
  }
  function updateSide() {
    const nx = upcoming()[0];
    const goEvent = h('button', { class: 'linkbtn', type: 'button', onclick: () => goTab('event') }, '» Ver eventos');
    if (nx) {
      const f = fmt(nx);
      R.nextBox.replaceChildren(h('span', { class: 'kicker' }, f.countdown), h('b', { style: { fontSize: '13px' } }, f.title), h('span', { class: 'small muted' }, `${f.dateText} · ${f.timeText}`), h('span', { class: 'small' }, f.goingText), goEvent);
    } else {
      R.nextBox.replaceChildren(h('span', { class: 'muted' }, 'Todavía no hay nada planeado.'), goEvent);
    }
    const recent = S.posts.slice(0, 3);
    R.recentPosts.replaceChildren(...(recent.length ? recent.map(p => h('div', { class: 'recent' },
      h('button', { class: 'linkbtn', type: 'button', onclick: () => goTab('posts') }, p.text || 'Compartió fotos o videos'),
      h('span', { class: 'tiny muted' }, `por ${userOf(p.uid).name} · ${ago(p.ts)}`))) : [h('div', { class: 'recent small muted' }, 'Todavía no hay posts.')]));
    const art = S.art.slice(0, 6);
    R.recentArt.replaceChildren(art.length
      ? h('div', { class: 'grid3' }, art.map(a => h('button', { class: 'thumb', type: 'button', onclick: () => openLightbox(up(a.file), `${userOf(a.uid).name} · ${ago(a.ts)}`) }, h('img', { src: up(a.file), alt: '', loading: 'lazy' }))))
      : h('button', { class: 'linkbtn', type: 'button', onclick: () => goTab('art') }, '» Subí el primero'));
  }
  function openLightbox(src, caption) {
    if (!src) return;
    R.lightbox.replaceChildren(h('figure', { class: 'box' }, h('div', { class: 'bar' }, caption), h('img', { src, alt: '' })));
    R.lightbox.classList.remove('hidden');
  }

  // ---------- section (posts / event / art) ----------
  const TITLES = { posts: 'Posts', event: 'Próximo evento', art: 'Arte', notifs: 'Notificaciones' };
  // Switch tab and move the view down to the section, so nobody has to scroll.
  function goTab(id) {
    setTab(id);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    (id === 'living' ? R.liveBox : R.section).scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  }
  function setTab(id) {
    if (S.tab === 'profile' && R.dirty && !confirm('¿Salir sin guardar los cambios de tu perfil?')) return false;
    if (id !== 'profile') { S.pid = null; S.prof = null; setHash(''); }
    R.draft = null; R.dirty = false;
    S.tab = id; if (id !== 'notifs') R.fresh = null; updateBadge(); updateSection();
    return true;
  }
  // re-drawing a list throws away its comment boxes; carry over what was typed and the focus
  function swapKeeping(el, nodes) {
    const saved = {};
    let focusKey = null;
    el.querySelectorAll('input[data-k]').forEach(i => { if (i.value) saved[i.dataset.k] = i.value; if (i === document.activeElement) focusKey = i.dataset.k; });
    el.replaceChildren(...nodes);
    el.querySelectorAll('input[data-k]').forEach(i => { if (saved[i.dataset.k]) i.value = saved[i.dataset.k]; if (focusKey === i.dataset.k) i.focus(); });
  }
  function updateSection() {
    for (const id in R.tabBtns) R.tabBtns[id].classList.toggle('on', S.tab === id);
    const living = S.tab === 'living';
    if (living !== R.wrap.classList.contains('living')) {
      R.wrap.classList.toggle('living', living);
      if (nearBottom()) stick(); // the chat changes size; stay on the latest message
    }
    const prof = S.tab === 'profile';
    R.wrap.classList.toggle('profiling', prof);
    if (!prof) { clearTheme(); R.pf = null; R.pview.replaceChildren(); }
    if (living) return showLive();
    hideLive();
    if (prof) return;
    if (R.builtTab !== S.tab) {
      R.builtTab = S.tab;
      R.secTitle.textContent = TITLES[S.tab];
      R.secList = h('div', { class: 'list' });
      const top = S.tab === 'posts' ? [postComposer()] : S.tab === 'event' ? eventControls() : S.tab === 'art' ? artControls() : [];
      R.secBody.replaceChildren(...top, R.secList);
    }
    swapKeeping(R.secList, S.tab === 'posts' ? postsList() : S.tab === 'event' ? eventsList() : S.tab === 'art' ? artList() : notifsList());
  }

  function postComposer() {
    const text = h('textarea', { class: 'input', maxLength: 2000, placeholder: 'Compartí algo con el grupo (usá @ para etiquetar)' });
    withMentions(text);
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
    h('div', { class: 'inline-form' }, h('label', { class: 'btn' }, 'Foto o video', pick), emojiBtn(text), h('span', { class: 'tiny muted' }, 'Hasta 6 archivos'), h('span', { class: 'spacer' }), btn));
  }
  function postsList() {
    if (!S.posts.length) return [h('div', { class: 'empty' }, h('b', null, 'Todavía no hay posts.'), ' Sé el primero en compartir algo.')];
    const counts = {};
    S.posts.forEach(p => { counts[p.uid] = (counts[p.uid] || 0) + 1; });
    return S.posts.map(p => postEl(p, counts[p.uid], 'c'));
  }
  // one post with its comments; `key` keeps the comment boxes of the feed and of a profile apart
  function postEl(p, count, key) {
    {
      const u = userOf(p.uid);
      const cin = h('input', { class: 'input', maxLength: 1000, placeholder: 'Escribí un comentario', autocomplete: 'off', 'data-k': key + p.id });
      withMentions(cin);
      return h('article', { class: 'post', 'data-post': p.id },
        h('div', { class: 'post-author go', title: 'Ver su perfil', onclick: () => openProfile(p.uid) }, h('b', { style: { fontSize: '13px', color: colorOf(p.uid) } }, u.name), avatar(p.uid, 64), h('span', { class: 'tiny muted' }, 'Posts: ' + count)),
        h('div', { class: 'post-main' },
          h('div', { class: 'post-meta' }, 'Publicado ' + ago(p.ts)),
          h('div', { class: 'post-body' },
            p.text ? h('div', { class: 'post-text' }, rich(p.text)) : null,
            p.media.length ? h('div', { class: 'media' }, p.media.filter(up).map(f => h('div', null, isVideo(f)
              ? h('video', { src: up(f), controls: true, preload: 'metadata' })
              : h('img', { src: up(f), alt: '', loading: 'lazy', onclick: () => openLightbox(up(f), `${u.name} · ${ago(p.ts)}`) })))) : null),
          yeahBar(p),
          h('div', { class: 'comments' },
            p.comments.map(c => h('div', { class: 'comment' }, h('b', { class: 'go', style: { color: colorOf(c.uid) }, onclick: () => openProfile(c.uid) }, userOf(c.uid).name + ':'), h('span', { class: 'comment-text' }, rich(c.text)), h('span', { class: 'when' }, ago(c.ts)))),
            h('form', {
              class: 'reply',
              onsubmit: async e => {
                e.preventDefault();
                const t = cin.value.trim();
                if (!t) return;
                try { await api(`/api/posts/${p.id}/comments`, { text: t }); cin.value = ''; } catch (x) { toast(errMsg(x)); }
              }
            }, cin, emojiBtn(cin), h('button', { class: 'btn', type: 'submit' }, 'Responder')))));
    }
  }

  // "Yeah..." reaction: a little head with a plus, like a thumbs-up
  function yeahIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 20');
    svg.setAttribute('class', 'yeah-ico');
    svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.append(e); };
    add('circle', { cx: 8, cy: 8, r: 6.5, fill: 'currentColor' });
    add('path', { d: 'M1 20c0-4 3-6 7-6s7 2 7 6z', fill: 'currentColor' });
    add('circle', { cx: 6, cy: 7.5, r: 1, class: 'yeah-eye' });
    add('circle', { cx: 10, cy: 7.5, r: 1, class: 'yeah-eye' });
    add('path', { d: 'M19 9v8M15 13h8', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round' });
    return svg;
  }
  function yeahBar(p) {
    const mine = p.yeahs.includes(S.me.id);
    const n = p.yeahs.length;
    const btn = h('button', {
      type: 'button', class: 'btn yeah-btn' + (mine ? ' on' : ''), 'aria-pressed': String(mine),
      title: mine ? 'Sacar tu Yeah' : 'Dar un Yeah',
      onclick: () => { btn.disabled = true; api(`/api/posts/${p.id}/yeah`, {}).catch(x => { btn.disabled = false; toast(errMsg(x)); }); }
    }, yeahIcon(), 'Yeah...');
    return h('div', { class: 'yeah' },
      btn,
      n ? h('div', { class: 'yeah-who' },
        h('div', { class: 'small' }, n === 1 ? '1 persona le dio un Yeah.' : `${n} personas le dieron un Yeah.`),
        h('div', { class: 'yeah-avs' }, p.yeahs.map(id => h('span', { class: 'go', title: userOf(id).name, onclick: () => openProfile(id) }, avatar(id, 36))))) : null);
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

  // ---------- rich text: custom emojis (:name:) and @mentions ----------
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function buildMentionRe() {
    const names = [...new Set(Object.values(S.users).map(u => u.name))].sort((a, b) => b.length - a.length);
    S.byName = {};
    Object.values(S.users).forEach(u => { S.byName[u.name.toLowerCase()] = u.id; });
    S.mentionRe = new RegExp(`((?<![\\p{L}\\p{N}_])@(?:${['all', ...names.map(escRe)].join('|')})(?![\\p{L}\\p{N}_]))`, 'iu');
  }
  function mentionParts(text) {
    if (!S.mentionRe || !text.includes('@')) return [text];
    return text.split(S.mentionRe).filter(Boolean).map(t => {
      if (/^@all$/i.test(t)) return h('span', { class: 'mention me' }, t);
      const id = t.startsWith('@') ? S.byName[t.slice(1).toLowerCase()] : null;
      if (id == null) return t;
      return h('span', { class: 'mention' + (id === S.me.id ? ' me' : ''), style: { color: id === S.me.id ? null : colorOf(id) } }, t);
    });
  }
  function rich(text) {
    if (!text) return [];
    const map = {};
    S.emojis.forEach(e => { map[e.name] = e.file; });
    return text.split(/(:[a-z0-9_]{2,24}:)/).filter(Boolean).flatMap(t => {
      const k = t.slice(1, -1);
      return /^:[a-z0-9_]{2,24}:$/.test(t) && up(map[k]) ? [h('img', { class: 'ce', src: up(map[k]), alt: t, title: t })] : mentionParts(t);
    });
  }
  const mentionsMe = text => !!text && mentionParts(text).some(n => n instanceof Node && n.classList.contains('me'));

  // ---------- chat ----------
  function msgEl(m) {
    if (m.sys) return h('div', { class: 'msg sys', 'data-chat': m.id }, `[${clock(m.ts)}] *** ${m.text}`);
    const body = h('span', { class: 'msg-text' }, rich(m.text));
    if (up(m.gif)) body.append(h('img', { class: 'msg-gif', src: up(m.gif), alt: 'Imagen', loading: 'lazy', onclick: () => openLightbox(up(m.gif), `${userOf(m.uid).name} · ${clock(m.ts)}`), onload: () => { if (nearBottom(300)) stick(); } }));
    return h('div', { class: 'msg' + (m.uid !== S.me.id && mentionsMe(m.text) ? ' tagged' : ''), 'data-chat': m.id }, h('span', { class: 'time' }, `[${clock(m.ts)}]`), avatar(m.uid, 22), h('b', { class: 'nick go', style: { color: colorOf(m.uid) }, title: 'Ver su perfil', onclick: () => openProfile(m.uid) }, userOf(m.uid).name + ':'), body);
  }
  const nearBottom = (gap = 80) => R.log.scrollHeight - R.log.scrollTop - R.log.clientHeight < gap;
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
  // pasted or dropped image waiting to be sent with the next message
  function attachImage(f) {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) return toast('Solo se pueden mandar fotos JPG, PNG, GIF o WEBP.');
    clearAttach();
    R.pending = f;
    const url = URL.createObjectURL(f);
    R.chatAttach.replaceChildren(h('img', { src: url, alt: '', onload: () => URL.revokeObjectURL(url) }),
      h('span', { class: 'small muted' }, 'Imagen lista. Escribí algo si querés y tocá Enviar.'),
      h('button', { type: 'button', class: 'linkbtn', onclick: clearAttach }, '[quitar]'));
    R.chatAttach.classList.remove('hidden');
    R.chatInput.focus();
  }
  function clearAttach() { R.pending = null; R.chatAttach.replaceChildren(); R.chatAttach.classList.add('hidden'); }
  // big photos and screenshots get shrunk before uploading (GIFs stay as they are so they keep moving)
  function fitImage(f, max) {
    if (f.type === 'image/gif' || f.size < 1.5e6) return Promise.resolve(f);
    return new Promise(resolve => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => resolve(b && b.size < f.size ? b : f), 'image/jpeg', 0.88);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(f); };
      img.src = url;
    });
  }
  async function sendImage(text) {
    if (R.sending) return;
    R.sending = true;
    R.chatSend.disabled = true;
    try {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('file', await fitImage(R.pending, 2000), 'imagen');
      await api('/api/chat/image', fd, true);
      clearAttach();
      R.chatInput.value = '';
    } catch (x) { toast(errMsg(x)); }
    R.sending = false;
    R.chatSend.disabled = false;
  }
  function sendChat(e) {
    e.preventDefault();
    const text = R.chatInput.value.trim();
    if (R.pending) return sendImage(text);
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
  function insertAt(el, s) {
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    el.value = el.value.slice(0, a) + s + el.value.slice(b);
    el.focus();
    el.setSelectionRange(a + s.length, a + s.length);
  }
  const insert = s => insertAt(R.chatInput, s);
  // comment boxes get rebuilt when data changes; find the current copy of the same box
  const live = el => (el.isConnected ? el : (el.dataset.k && document.querySelector(`[data-k="${el.dataset.k}"]`)) || null);

  // ---------- @mention autocomplete ----------
  function floating(cls) {
    const el = h('div', { class: 'pop box hidden ' + cls });
    document.body.append(el);
    return el;
  }
  function place(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4)) + 'px';
    if (r.bottom + pop.offsetHeight + 8 > window.innerHeight && r.top > pop.offsetHeight + 8) { pop.style.top = ''; pop.style.bottom = (window.innerHeight - r.top + 2) + 'px'; }
    else { pop.style.bottom = ''; pop.style.top = (r.bottom + 2) + 'px'; }
  }
  const M = { el: null, target: null, list: [], idx: 0, start: 0 };
  const ALL = { name: 'all' }; // "@all" entry in the autocomplete list
  function closeMentions() { if (M.el) M.el.classList.add('hidden'); M.target = null; }
  function checkMentions(el) {
    const caret = el.selectionStart;
    const m = caret == null ? null : /(?:^|[^\p{L}\p{N}_])@([^\s@]{0,24})$/u.exec(el.value.slice(0, caret));
    if (!m) return closeMentions();
    const qy = m[1].toLowerCase();
    const users = Object.values(S.users).filter(u => u.id !== S.me.id);
    const list = users.filter(u => u.name.toLowerCase().startsWith(qy))
      .concat(users.filter(u => !u.name.toLowerCase().startsWith(qy) && u.name.toLowerCase().includes(qy))).slice(0, 6);
    if ('all'.startsWith(qy)) list.unshift(ALL);
    if (!list.length) return closeMentions();
    M.el = M.el || floating('mention-pop');
    Object.assign(M, { target: el, list, idx: 0, start: caret - m[1].length - 1 });
    drawMentions();
  }
  function drawMentions() {
    M.el.replaceChildren(...M.list.map((u, i) => h('button', {
      type: 'button', class: 'row' + (i === M.idx ? ' on' : ''),
      onmousedown: e => { e.preventDefault(); pickMention(u); }
    }, ...(u === ALL
      ? [h('span', { class: 'av av-i', style: { width: '18px', height: '18px', fontSize: '10px' } }, '@'), h('b', null, 'all'), h('span', { class: 'tiny muted' }, ' avisar a todos')]
      : [avatar(u.id, 18), h('b', { style: { color: colorOf(u.id) } }, u.name)]))));
    M.el.classList.remove('hidden');
    place(M.el, M.target);
  }
  function pickMention(u) {
    const el = M.target;
    closeMentions();
    if (!el) return;
    el.setSelectionRange(M.start, el.selectionStart); // select the typed "@query" so it gets replaced
    insertAt(el, '@' + u.name + ' ');
  }
  function withMentions(el) {
    const check = () => checkMentions(el);
    el.addEventListener('input', check);
    el.addEventListener('click', check);
    el.addEventListener('blur', () => setTimeout(() => { if (M.target === el) closeMentions(); }, 100));
    el.addEventListener('keydown', e => {
      if (M.target !== el || M.el.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        M.idx = (M.idx + (e.key === 'ArrowDown' ? 1 : M.list.length - 1)) % M.list.length;
        drawMentions();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(M.list[M.idx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMentions();
      }
    });
    return el;
  }

  // ---------- emote popover for posts and comments ----------
  const E = { el: null, target: null };
  function closeEmojis() { if (E.el) E.el.classList.add('hidden'); E.target = null; }
  function emojiBtn(target) {
    const btn = h('button', {
      type: 'button', class: 'btn', title: 'Emotes',
      onclick: () => {
        if (E.target === target && !E.el.classList.contains('hidden')) return closeEmojis();
        E.el = E.el || floating('emoji-pop');
        E.target = target; E.anchor = btn;
        drawEmojis();
      }
    }, '☺');
    return btn;
  }
  function drawEmojis() {
    const add = s => { const el = live(E.target); if (el) { E.target = el; insertAt(el, s); } };
    const custom = S.emojis.filter(x => up(x.file));
    const body = custom.length
      ? h('div', { class: 'ce-grid' }, custom.map(x => h('button', { type: 'button', title: `:${x.name}:`, onclick: () => add(`:${x.name}: `) }, h('img', { src: up(x.file), alt: '' }), h('span', null, `:${x.name}:`))))
      : h('div', { class: 'small muted' }, 'Todavía no hay emotes. Creálos desde el chat con el botón ☺.');
    E.el.replaceChildren(
      h('div', { class: 'picker-tabs' }, h('span', { class: 'tab on static' }, 'Emotes'), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'linkbtn', onclick: closeEmojis }, '[cerrar]')),
      h('div', { class: 'picker-body' }, body));
    E.el.classList.remove('hidden');
    place(E.el, E.anchor.isConnected ? E.anchor : live(E.target) || E.anchor);
  }
  document.addEventListener('mousedown', e => {
    if (E.el && !E.el.classList.contains('hidden') && !E.el.contains(e.target) && !(E.anchor && E.anchor.contains(e.target))) closeEmojis();
  });
  window.addEventListener('resize', () => { closeEmojis(); closeMentions(); });

  // ---------- notifications ----------
  const NOTIF_TEXT = {
    chat: 'te etiquetó en el chat',
    post: 'te etiquetó en un post',
    comment_mention: 'te etiquetó en un comentario',
    comment: 'comentó tu post',
    yeah: 'le dio un Yeah a tu post',
    wall: 'firmó tu libro de visitas',
    wall_mention: 'te etiquetó en un libro de visitas'
  };
  const unread = () => S.notifs.filter(n => !n.seen).length;
  function updateBadge() {
    let n = unread();
    if (S.tab === 'notifs' && n) {
      // looking at the list counts as reading it; keep the new ones highlighted while here
      R.fresh = new Set([...(R.fresh || []), ...S.notifs.filter(x => !x.seen).map(x => x.id)]);
      S.notifs.forEach(x => { x.seen = true; });
      api('/api/notifs/seen', {}).catch(() => {});
      n = 0;
    }
    R.badge.textContent = n > 99 ? '99+' : String(n);
    R.badge.classList.toggle('hidden', !n);
    document.title = n ? `(${n}) Upipination` : 'Upipination';
  }
  function notifsList() {
    if (!S.notifs.length) return [h('div', { class: 'empty' }, h('b', null, 'No tenés notificaciones.'), ' Cuando alguien te etiquete con @, comente tus posts o les dé un Yeah, aparece acá.')];
    return [h('div', { class: 'notifs' }, S.notifs.map(n => h('button', {
      type: 'button', class: 'notif' + (R.fresh && R.fresh.has(n.id) ? ' new' : ''), onclick: () => openNotif(n)
    },
    avatar(n.actor, 32),
    h('div', { class: 'notif-main' },
      h('div', null, h('b', { style: { color: colorOf(n.actor) } }, userOf(n.actor).name), ' ', NOTIF_TEXT[n.kind] || 'te mencionó', h('span', { class: 'when' }, ' · ' + ago(n.ts))),
      n.text ? h('div', { class: 'notif-text' }, rich(n.text)) : null))))];
  }
  function flash(el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  async function openNotif(n) {
    if (n.wall) {
      if (!n.profile) return toast('Esa firma ya no está.');
      await openProfile(n.profile);
      const el = R.pview.querySelector(`[data-wall="${n.wall}"]`);
      return el ? flash(el) : toast('Esa firma ya no está.');
    }
    if (n.chat) {
      const el = R.log.querySelector(`[data-chat="${n.chat}"]`);
      return el ? flash(el) : toast('Ese mensaje ya es muy viejo para mostrarlo en el chat.');
    }
    if (!setTab('posts')) return;
    const el = R.secList.querySelector(`[data-post="${n.post}"]`);
    return el ? flash(el) : toast('Ese post ya no está.');
  }

  function togglePicker() {
    S.picker = !S.picker;
    updatePicker();
  }
  function updatePicker() {
    R.picker.classList.toggle('hidden', !S.picker);
    if (!S.picker) return;
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
    }, h('label', { class: 'btn' }, R.pendingEmoji ? h('img', { class: 'preview-img', src: R.pendingEmoji.url, alt: '' }) : null, 'Imagen o GIF', fileIn), nameIn, h('button', { class: 'btn', type: 'submit' }, 'Crear emote'));
    const body = [form, h('div', { class: 'small muted' }, 'Usalos en el chat y en los posts escribiendo :nombre: o tocándolos acá.'),
      S.emojis.length ? h('div', { class: 'ce-grid' }, S.emojis.filter(x => up(x.file)).map(x => h('button', { type: 'button', title: `:${x.name}:`, onclick: () => insert(`:${x.name}: `) }, h('img', { src: up(x.file), alt: '' }), h('span', null, `:${x.name}:`)))) : null];
    R.picker.replaceChildren(
      h('div', { class: 'picker-tabs' }, h('span', { class: 'tab on static' }, 'Emotes'), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'linkbtn', onclick: () => { S.picker = null; updatePicker(); } }, '[cerrar]')),
      h('div', { class: 'picker-body' }, body));
  }

  // ---------- Living: watch a YouTube video together, in sync ----------
  // The server says where the video was (pos) at server time `at` and whether it's playing.
  // Each player follows that; when someone plays, pauses or skips, it goes to everyone.
  const L = { vid: null, iframe: null, player: null, ready: false, joined: false, quiet: 0, prev: null, timer: null, api: null, offset: 0 };
  const VID_RE = /^[\w-]{11}$/;
  function liveClock(st) { if (st && st.now) L.offset = Date.now() - st.now; }
  const serverNow = () => Date.now() - L.offset;
  function liveTarget() {
    const s = S.live;
    return s.playing ? s.pos + (serverNow() - s.at) / 1000 : s.pos;
  }
  const hush = () => { L.quiet = Date.now() + 1500; L.prev = null; }; // ignore the player's events caused by us
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (!L.api) L.api = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = resolve;
      const s = h('script', { src: 'https://www.youtube.com/iframe_api' });
      s.onerror = () => { L.api = null; s.remove(); reject(new Error('yt')); };
      document.head.append(s);
    });
    return L.api;
  }
  function showLive() {
    const s = S.live;
    const who = s.vid && s.by ? userOf(s.by) : null;
    R.liveInfo.replaceChildren(...(who ? ['puesto por ', h('b', { style: { color: colorOf(who.id) } }, who.name)] : []));
    R.liveStop.hidden = !s.vid;
    if (!s.vid || !VID_RE.test(s.vid)) {
      hideLive();
      R.liveStage.replaceChildren(h('div', { class: 'live-empty' }, h('b', null, 'No hay nada puesto.'), h('span', null, 'Pegá un link de YouTube abajo y lo miramos todos juntos.')));
      return;
    }
    if (L.vid === s.vid) return liveSync();
    hideLive();
    L.vid = s.vid;
    const iframe = L.iframe = h('iframe', {
      referrerpolicy: 'strict-origin-when-cross-origin', // YouTube refuses to play embeds without it
      title: 'Video de Living',
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true,
      src: `https://www.youtube-nocookie.com/embed/${s.vid}?enablejsapi=1&playsinline=1&rel=0&autoplay=${s.playing ? 1 : 0}&start=${Math.floor(liveTarget())}&origin=${encodeURIComponent(location.origin)}`
    });
    R.liveStage.replaceChildren(iframe);
    loadYT().then(() => {
      if (L.iframe !== iframe) return;
      L.player = new window.YT.Player(iframe, { events: { onReady: () => { L.ready = true; liveSync(); }, onStateChange: e => liveEvent(e.data) } });
      L.timer = setInterval(liveTick, 1000);
    }).catch(() => toast('No se pudo cargar YouTube. Probá recargar la página.'));
  }
  function hideLive() {
    clearInterval(L.timer);
    if (L.iframe) R.liveStage.replaceChildren();
    Object.assign(L, { vid: null, iframe: null, player: null, ready: false, joined: false, prev: null, timer: null });
  }
  // move my player to where the group is
  function liveSync() {
    const p = L.player;
    if (!L.ready || !p || S.live.vid !== L.vid) return;
    const want = liveTarget(), cur = p.getCurrentTime(), st = p.getPlayerState();
    if (S.live.playing) {
      if (Math.abs(cur - want) > 2.5) { hush(); p.seekTo(want, true); }
      if (st !== 1 && st !== 3) { hush(); p.playVideo(); }
    } else {
      if (st === 1 || st === 3) { hush(); p.pauseVideo(); }
      if (Math.abs(cur - want) > 1) { hush(); p.seekTo(want, true); }
    }
  }
  function liveSend(playing) {
    const pos = Math.max(0, L.player.getCurrentTime());
    S.live = { ...S.live, playing, pos, at: serverNow() };
    sock.emit('live:ctl', { vid: L.vid, playing, pos });
  }
  // the player changed state: if it wasn't us, it was this person pressing play or pause
  function liveEvent(st) {
    if (!L.ready || S.live.vid !== L.vid) return;
    if (st === 1 && !L.joined) { L.joined = true; if (S.live.playing) return liveSync(); } // just arrived: catch up
    if (Date.now() < L.quiet) return;
    if (st === 1 && !S.live.playing) liveSend(true);
    else if (st === 2 && S.live.playing && L.joined) liveSend(false); // not before it ever played (blocked autoplay)
  }
  // every second: notice skips (the time jumps) and fix drift (slow internet, ads)
  function liveTick() {
    const p = L.player;
    if (!L.ready || !p || S.live.vid !== L.vid) return;
    const t = Date.now(), st = p.getPlayerState(), cur = p.getCurrentTime();
    const prev = L.prev;
    L.prev = { t, st, cur };
    if (t < L.quiet || !prev || prev.st !== st) return;
    const rate = st === 1 ? p.getPlaybackRate() || 1 : 0;
    if ((st === 1 || st === 2) && Math.abs(cur - (prev.cur + rate * (t - prev.t) / 1000)) > 2) return liveSend(st === 1); // skipped
    if (st === 1 && S.live.playing && Math.abs(cur - liveTarget()) > 3) liveSync(); // fell behind or ahead
  }

  // ---------- profiles: everyone decorates their own page ----------
  // While you look at someone's profile, the whole site wears their colours, fonts and background.
  const FONTS = {
    default: ['Clásica', "Verdana, Tahoma, Geneva, sans-serif"],
    georgia: ['Georgia', "Georgia, 'Times New Roman', serif"],
    courier: ['Courier', "'Courier New', Courier, monospace"],
    trebuchet: ['Trebuchet', "'Trebuchet MS', Verdana, sans-serif"],
    'comic-neue': ['Comic Neue', "'Comic Neue', 'Comic Sans MS', cursive"],
    'special-elite': ['Special Elite', "'Special Elite', 'Courier New', monospace"],
    pacifico: ['Pacifico', "'Pacifico', cursive"],
    lobster: ['Lobster', "'Lobster', cursive"],
    bangers: ['Bangers', "'Bangers', Impact, sans-serif"],
    creepster: ['Creepster', "'Creepster', fantasy"],
    'permanent-marker': ['Permanent Marker', "'Permanent Marker', cursive"],
    'press-start-2p': ['Press Start', "'Press Start 2P', monospace"],
    vt323: ['VT323', "'VT323', monospace"],
    orbitron: ['Orbitron', "'Orbitron', sans-serif"],
    unifrakturcook: ['Unifraktur', "'UnifrakturCook', serif"],
    cinzel: ['Cinzel', "'Cinzel', Georgia, serif"]
  };
  const THEME_DEF = { colors: null, font: 'default', hfont: 'default', bgMode: 'cover', glass: 0, avatar: 'square', border: 'solid', radius: 0, bannerH: 'medium', bannerY: 50, nameFx: 'none' };
  const COLOR_LABELS = [['bg', 'Fondo de la página'], ['panel', 'Cajas'], ['text', 'Texto'], ['accent', 'Links y detalles'], ['bar', 'Barras de título']];
  const col = (bg, panel, text, accent, bar) => ({ bg, panel, text, accent, bar });
  const PRESETS = [
    ['Clásico', {}],
    ['Medianoche', { colors: col('#0b1020', '#151c33', '#dfe6ff', '#7aa2ff', '#2b3f7a'), hfont: 'orbitron' }],
    ['Chicle', { colors: col('#ffc1e3', '#fff0f8', '#5a1846', '#d81b7f', '#ff5fb0'), font: 'comic-neue', hfont: 'pacifico', radius: 12, avatar: 'round' }],
    ['Matrix', { colors: col('#000000', '#03160a', '#39ff6a', '#b6ff00', '#0b5a1c'), font: 'vt323', hfont: 'press-start-2p', nameFx: 'glow' }],
    ['Vaporwave', { colors: col('#2b1055', '#3a1c71', '#ffd6ff', '#00f0ff', '#ff5fa2'), hfont: 'bangers', nameFx: 'rainbow', radius: 6 }],
    ['Terror', { colors: col('#0d0000', '#1a0505', '#e8d5d5', '#ff3b3b', '#5c0a0a'), hfont: 'creepster', nameFx: 'shadow' }],
    ['Máquina de escribir', { colors: col('#d9d0bb', '#fbf7ec', '#2a2520', '#8a2f12', '#4a4038'), font: 'special-elite', hfont: 'special-elite', border: 'dashed' }],
    ['Medieval', { colors: col('#2a2118', '#e9dcc0', '#2b1d0e', '#7a1f1f', '#5a3c1f'), font: 'georgia', hfont: 'unifrakturcook', border: 'double' }]
  ];
  const THEME_VARS = ['--page', '--panel', '--row', '--row2', '--border', '--bar1', '--bar2', '--bartext', '--text', '--muted', '--link', '--accent', '--tab', '--tab-on', '--btn', '--input', '--ticker', '--tickertext', '--font', '--hfont', '--radius', '--bstyle', '--bwidth', '--bgimg', '--bgsize', '--bgrep', '--n1', '--n2', '--n3', '--n4', '--n5', '--n6', '--sys'];
  const rootVar = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  // black or white, whichever reads better on that colour
  function contrast(hex) {
    const n = parseInt(hex.slice(1), 16);
    return 0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255) > 150 ? '#1a1a1a' : '#ffffff';
  }
  function clearTheme() {
    if (!R.themed) return;
    const b = document.body;
    THEME_VARS.forEach(v => b.style.removeProperty(v));
    b.style.backgroundImage = b.style.backgroundSize = b.style.backgroundRepeat = '';
    b.classList.remove('themed', 'bgfix');
    R.themed = false;
  }
  function wearTheme(t, bg) {
    clearTheme();
    R.themed = true;
    const b = document.body, set = (k, v) => b.style.setProperty(k, v);
    b.classList.add('themed');
    const mix = (a, pct, c) => `color-mix(in srgb, ${a} ${pct}%, ${c})`;
    const glass = v => (t.glass ? mix(v, 100 - t.glass, 'transparent') : v); // see-through boxes, so the background shows
    const c = t.colors;
    if (c) {
      // the five chosen colours; every other shade is worked out from them
      set('--page', c.bg); set('--text', c.text); set('--link', c.accent); set('--accent', mix(c.accent, 70, c.text));
      set('--panel', glass(c.panel)); set('--row', glass(mix(c.panel, 90, c.text))); set('--row2', glass(mix(c.panel, 96, c.text)));
      set('--input', mix(c.panel, 94, c.bg));
      set('--border', mix(c.text, 45, c.panel)); set('--muted', mix(c.text, 65, c.panel));
      set('--bar1', c.bar); set('--bar2', mix(c.bar, 70, '#000')); set('--bartext', contrast(c.bar));
      const face = `linear-gradient(${mix(c.panel, 92, '#fff')}, ${mix(c.panel, 86, c.text)})`;
      set('--tab', face); set('--btn', face);
      set('--tab-on', `linear-gradient(${mix(c.panel, 80, c.accent)}, ${mix(c.panel, 62, c.accent)})`);
      set('--ticker', mix(c.panel, 78, c.accent)); set('--tickertext', c.text);
      // people's name colours, pulled towards the text colour so they stay readable on any background
      for (const k of ['--n1', '--n2', '--n3', '--n4', '--n5', '--n6', '--sys']) set(k, mix(rootVar(k), 45, c.text));
    } else if (t.glass) {
      for (const k of ['--panel', '--row', '--row2']) set(k, glass(rootVar(k)));
    }
    if (t.font !== 'default' && FONTS[t.font]) set('--font', FONTS[t.font][1]);
    if (t.hfont !== 'default' && FONTS[t.hfont]) set('--hfont', FONTS[t.hfont][1]);
    set('--bstyle', t.border); set('--bwidth', t.border === 'double' ? '3px' : '1px'); set('--radius', t.radius + 'px');
    const src = up(bg);
    if (!src) return;
    if (t.bgMode === 'tile') { // repeats and scrolls with the page
      b.style.backgroundImage = `url("${src}")`; b.style.backgroundRepeat = 'repeat'; b.style.backgroundSize = 'auto';
    } else { // stays still behind the page
      set('--bgimg', `url("${src}")`);
      set('--bgsize', t.bgMode === 'cover' ? 'cover' : 'auto');
      set('--bgrep', t.bgMode === 'cover' ? 'no-repeat' : 'repeat');
      b.classList.add('bgfix');
    }
  }

  // the address bar remembers which profile is open, so links and the back button work
  function setHash(v) {
    const want = v ? '#' + v : '';
    if (location.hash !== want) history.pushState(null, '', want || location.pathname + location.search);
  }
  function routeHash() {
    if (!S.me || !R.wrap || !R.wrap.isConnected) return;
    const m = /^#perfil\/(\d{1,12})$/.exec(location.hash);
    if (m && S.users[m[1]]) openProfile(Number(m[1]));
    else if (S.tab === 'profile') setTab('posts');
  }
  window.addEventListener('popstate', routeHash);

  function scrollToProfile() {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    R.pview.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  }
  async function openProfile(uid) {
    uid = Number(uid);
    if (!S.users[uid]) return;
    if (S.tab === 'profile' && S.pid === uid) return scrollToProfile();
    if (!setTab('profile')) return;
    S.pid = uid; S.prof = null; R.pf = null;
    setHash('perfil/' + uid);
    drawProfile();
    scrollToProfile();
    await loadProfile();
  }
  async function loadProfile() {
    const id = S.pid;
    if (!id) return;
    let p;
    try { p = await api('/api/profile/' + id); }
    catch (e) {
      if (S.pid === id && !S.prof && R.pf) R.pf.posts.replaceChildren(h('div', { class: 'empty' }, 'No se pudo cargar este perfil. Probá de nuevo en un rato.'));
      return;
    }
    if (S.pid !== id || S.tab !== 'profile') return;
    S.prof = p;
    drawProfile();
  }
  // the frame is built once per visit; after that only its contents are redrawn
  function drawProfile() {
    const id = S.pid, mine = id === S.me.id;
    if (!R.pf || R.pf.id !== id) {
      const f = R.pf = { id };
      f.people = h('div', { class: 'box pf-people' });
      f.banner = h('div', { class: 'pf-banner' });
      f.head = h('div', { class: 'pf-head' });
      f.editSlot = h('div');
      f.bio = h('div', { class: 'pf-bio' });
      f.stats = h('div', { class: 'stats' });
      f.art = h('div', { class: 'side-pad' });
      f.wallTitle = h('span', { class: 'pf-title' });
      f.wallCount = h('span', { class: 'small' });
      f.wall = h('div', { class: 'pf-wall' });
      const sign = withMentions(h('input', { class: 'input', maxLength: 500, autocomplete: 'off', 'data-k': 'w' + id, placeholder: mine ? 'Escribí algo en tu propio libro' : `Dejale un mensaje a ${userOf(id).name}` }));
      const signBtn = h('button', { class: 'btn', type: 'submit' }, 'Firmar');
      const signForm = h('form', {
        class: 'reply',
        onsubmit: async e => {
          e.preventDefault();
          const text = sign.value.trim();
          if (!text) return;
          signBtn.disabled = true;
          try { await api(`/api/profile/${id}/wall`, { text }); sign.value = ''; } catch (x) { toast(errMsg(x)); }
          signBtn.disabled = false;
        }
      }, sign, emojiBtn(sign), signBtn);
      f.postsTitle = h('span', { class: 'pf-title' });
      f.posts = h('div', { class: 'list' });
      R.pview.replaceChildren(
        f.people,
        h('section', { class: 'box' }, f.banner, f.head),
        f.editSlot,
        h('div', { class: 'pf-cols' },
          h('aside', { class: 'pf-side' }, box('Sobre mí', f.bio), box('Números', f.stats), box('Arte', f.art)),
          h('div', { class: 'pf-main' },
            h('section', { class: 'box' }, h('div', { class: 'bar' }, f.wallTitle, f.wallCount), signForm, f.wall),
            h('section', { class: 'box' }, h('div', { class: 'bar' }, f.postsTitle),
              h('div', { class: 'section-body' }, mine ? postComposer() : null, f.posts)))));
    }
    paintProfile();
    paintProfilePosts();
  }
  function paintProfile() {
    const f = R.pf, id = S.pid;
    if (!f || S.tab !== 'profile') return;
    const u = userOf(id), p = S.prof, d = R.draft, mine = id === S.me.id;
    const t = { ...THEME_DEF, ...(d ? d.theme : p ? p.theme : {}) };
    const tagline = d ? d.tagline : p ? p.tagline : '';
    const bio = d ? d.bio : p ? p.bio : '';
    wearTheme(t, p && p.bg);

    const everyone = Object.values(S.users).sort((a, b) => a.name.localeCompare(b.name, LOC));
    f.people.replaceChildren(h('b', { class: 'small' }, 'Perfiles:'), ...everyone.map(x =>
      h('button', { type: 'button', class: x.id === id ? 'on' : '', title: x.name, onclick: () => openProfile(x.id) }, avatar(x.id, 28))));

    f.banner.className = 'pf-banner ' + t.bannerH;
    if (p && up(p.banner)) {
      let img = f.banner.firstChild;
      if (!img || img.dataset.f !== p.banner) { // same picture: keep it, so it doesn't blink
        img = h('img', { src: up(p.banner), alt: '' });
        img.dataset.f = p.banner;
        f.banner.replaceChildren(img);
      }
      img.style.objectPosition = `50% ${t.bannerY}%`;
    } else f.banner.replaceChildren();

    const on = mine || S.online.includes(id);
    const editBtn = mine && p && !d ? h('button', { class: 'btn', type: 'button', onclick: editProfile }, '✎ Editar mi perfil') : '';
    f.head.replaceChildren(
      h('div', { class: 'pf-av ' + t.avatar }, avatar(id, 112)),
      h('div', { class: 'pf-id' },
        h('div', { class: 'pf-name fx-' + t.nameFx, style: { color: t.colors ? 'var(--link)' : colorOf(id) } }, u.name),
        tagline ? h('div', { class: 'pf-tagline' }, rich(tagline)) : null,
        h('div', { class: 'small muted inline-form' },
          on ? [h('span', { class: 'dot' }), 'En línea'] : 'Desconectado',
          p ? ' · En el grupo desde ' + new Date(p.joined).toLocaleDateString(LOC, { month: 'long', year: 'numeric', timeZone: TZ }) : null)),
      editBtn);

    f.bio.replaceChildren(...(bio ? rich(bio) : [h('span', { class: 'muted' }, mine ? 'Todavía no escribiste nada sobre vos. Tocá «Editar mi perfil».' : 'Todavía no escribió nada.')]));
    const stat = (k, v) => h('div', null, h('span', { class: 'muted' }, k), h('b', null, String(v)));
    const n = p ? p.stats : {};
    f.stats.replaceChildren(stat('Mensajes en el chat:', n.messages ?? '…'), stat('Posts:', n.posts ?? '…'), stat('Arte:', n.art ?? '…'), stat('Yeahs recibidos:', n.yeahs ?? '…'));
    const art = p ? p.art.filter(a => up(a.file)) : [];
    f.art.replaceChildren(art.length
      ? h('div', { class: 'grid3' }, art.map(a => h('button', { class: 'thumb', type: 'button', onclick: () => openLightbox(up(a.file), `${u.name} · ${ago(a.ts)}`) }, h('img', { src: up(a.file), alt: '', loading: 'lazy' }))))
      : h('span', { class: 'muted' }, p ? 'Todavía no subió arte.' : '…'));
  }
  function paintProfilePosts() {
    const f = R.pf, p = S.prof;
    if (!f) return;
    const u = userOf(S.pid), mine = S.pid === S.me.id;
    f.postsTitle.textContent = mine ? 'Mis posts' : 'Posts de ' + u.name;
    // guestbook: newest first; the writer and the profile's owner can delete a message
    const wall = p ? p.wall : [];
    f.wallTitle.textContent = mine ? 'Mi libro de visitas' : 'Libro de visitas de ' + u.name;
    f.wallCount.textContent = wall.length === 1 ? '1 firma' : wall.length ? `${wall.length} firmas` : '';
    f.wall.replaceChildren(...(wall.length ? wall.map(w => h('div', { class: 'pf-sign', 'data-wall': w.id },
      h('span', { class: 'go', title: 'Ver su perfil', onclick: () => openProfile(w.uid) }, avatar(w.uid, 32)),
      h('div', { class: 'pf-sign-main' },
        h('div', null, h('b', { class: 'go', style: { color: colorOf(w.uid) }, onclick: () => openProfile(w.uid) }, userOf(w.uid).name), h('span', { class: 'tiny muted' }, ' · ' + ago(w.ts))),
        h('div', { class: 'pf-sign-text' }, rich(w.text))),
      mine || w.uid === S.me.id ? h('button', {
        type: 'button', class: 'btn music-x', title: 'Borrar esta firma',
        onclick: async () => {
          if (!confirm('¿Borrar esta firma?')) return;
          try { await api(`/api/wall/${w.id}/delete`, {}); } catch (x) { toast(errMsg(x)); }
        }
      }, 'x') : null))
      : [h('div', { class: 'pf-sign muted small' }, !p ? 'Cargando…' : mine ? 'Todavía nadie firmó tu libro de visitas.' : `Nadie firmó todavía. Sé el primero en dejarle un mensaje a ${u.name}.`)]));
    swapKeeping(f.posts, !p ? [h('div', { class: 'empty' }, 'Cargando…')]
      : p.posts.length ? p.posts.map(x => postEl(x, p.stats.posts, 'pc'))
      : [h('div', { class: 'empty' }, mine ? 'Todavía no publicaste nada. Lo que publiques aparece acá y en el muro.' : `${u.name} todavía no publicó nada.`)]);
  }

  // --- the editor: every change shows right away on the page, and nothing is saved until "Guardar" ---
  function editProfile() {
    const p = S.prof;
    if (!p || S.pid !== S.me.id) return;
    R.draft = { tagline: p.tagline, bio: p.bio, theme: { ...THEME_DEF, ...p.theme, colors: p.theme.colors ? { ...p.theme.colors } : null } };
    R.dirty = false;
    drawEditor();
    paintProfile();
  }
  let paintQueued = false;
  function touch() {
    R.dirty = true;
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; paintProfile(); });
  }
  function closeEditor() {
    R.draft = null; R.dirty = false;
    if (R.pf) R.pf.editSlot.replaceChildren();
    paintProfile();
  }
  function drawEditor() {
    const d = R.draft, f = R.pf, p = S.prof;
    if (!d || !f || !p) return;
    const t = d.theme;
    const redraw = () => { drawEditor(); touch(); };
    const group = (title, ...kids) => h('fieldset', null, h('legend', null, title), ...kids);
    const sel = (key, opts) => {
      const s = h('select', { class: 'input', onchange: () => { t[key] = s.value; touch(); } }, opts.map(([v, l]) => h('option', { value: v }, l)));
      s.value = t[key];
      return s;
    };
    const range = (key, min, max) => h('input', { type: 'range', min: String(min), max: String(max), value: String(t[key]), oninput: e => { t[key] = Number(e.target.value); touch(); } });
    const fontRow = key => h('div', { class: 'pf-fonts' }, Object.keys(FONTS).map(k =>
      h('button', { type: 'button', class: t[key] === k ? 'on' : '', 'aria-pressed': String(t[key] === k), style: { fontFamily: FONTS[k][1] }, onclick: () => { t[key] = k; redraw(); } }, FONTS[k][0])));
    // banner and background are uploaded straight away (like the profile photo)
    const picture = (kind, label, max) => {
      const busy = h('span', { class: 'small muted' });
      const pick = h('input', {
        type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp',
        onchange: async e => {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file) return;
          busy.textContent = 'Subiendo…';
          try {
            const fd = new FormData();
            fd.append('file', await fitImage(file, max), kind);
            await api('/api/profile/' + kind, fd, true);
            await loadProfile();
          } catch (x) { toast(errMsg(x)); }
          if (R.draft) drawEditor();
        }
      });
      const has = !!up(S.prof[kind]);
      return h('div', { class: 'inline-form' },
        h('label', { class: 'btn' }, has ? 'Cambiar ' + label : 'Subir ' + label, pick),
        has ? h('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            try { await api(`/api/profile/${kind}/delete`, {}); await loadProfile(); } catch (x) { toast(errMsg(x)); }
            if (R.draft) drawEditor();
          }
        }, 'Quitar') : null,
        busy);
    };

    const tagline = h('input', { class: 'input', maxLength: 80, placeholder: 'Una frase, tu estado, lo que quieras', value: d.tagline, oninput: e => { d.tagline = e.target.value; touch(); } });
    const bio = h('textarea', { class: 'input', maxLength: 1000, rows: 5, placeholder: 'Contá algo sobre vos. Podés usar emotes con :nombre:', oninput: e => { d.bio = e.target.value; touch(); } });
    bio.value = d.bio;

    const own = !!t.colors;
    const colors = h('div', { class: 'pf-colors' }, own ? COLOR_LABELS.map(([k, label]) =>
      h('label', null, h('input', { type: 'color', value: t.colors[k], oninput: e => { t.colors[k] = e.target.value; touch(); } }), label)) : null);
    const ownBox = h('input', {
      type: 'checkbox', checked: own,
      onchange: e => {
        // start from the colours on screen right now, so nothing jumps
        t.colors = e.target.checked ? col(rootVar('--page'), rootVar('--panel'), rootVar('--text'), rootVar('--link'), rootVar('--bar1')) : null;
        redraw();
      }
    });

    const save = h('button', { class: 'btn', type: 'submit' }, 'Guardar');
    const form = h('form', {
      class: 'pf-edit',
      onsubmit: async e => {
        e.preventDefault();
        save.disabled = true;
        try {
          await api('/api/profile', { tagline: d.tagline, bio: d.bio, theme: t });
          R.draft = null; R.dirty = false;
          f.editSlot.replaceChildren();
          await loadProfile();
          paintProfile();
        } catch (x) { toast(errMsg(x)); save.disabled = false; }
      }
    },
      group('Temas listos (después podés cambiarles lo que quieras)', h('div', { class: 'inline-form' }, PRESETS.map(([name, preset]) =>
        h('button', {
          type: 'button', class: 'btn',
          onclick: () => { d.theme = { ...THEME_DEF, bgMode: t.bgMode, bannerH: t.bannerH, bannerY: t.bannerY, glass: t.glass, ...preset, colors: preset.colors ? { ...preset.colors } : null }; redraw(); }
        }, preset.colors ? [h('span', { class: 'pf-swatch', style: { background: preset.colors.bg } }), h('span', { class: 'pf-swatch', style: { background: preset.colors.accent } })] : null, name)))),
      group('Sobre vos', field('Frase debajo de tu nombre:', tagline), field('Sobre mí:', bio)),
      group('Banner (la foto ancha de arriba)', picture('banner', 'banner', 2000),
        h('div', { class: 'inline-form' },
          field('Alto:', sel('bannerH', [['short', 'Bajo'], ['medium', 'Medio'], ['tall', 'Alto']])),
          field('Encuadre (qué parte de la foto se ve):', range('bannerY', 0, 100)))),
      group('Fondo de la página', picture('bg', 'fondo', 2400),
        h('div', { class: 'inline-form' },
          field('Cómo se muestra:', sel('bgMode', [['cover', 'Llena la pantalla'], ['tile', 'Mosaico (se repite)'], ['tilefix', 'Mosaico fijo']])),
          field('Transparencia de las cajas (para que se vea el fondo):', range('glass', 0, 70)))),
      group('Colores', h('label', { class: 'inline-form small' }, ownBox, 'Usar mis propios colores'), colors),
      group('Letra de los títulos y de tu nombre', fontRow('hfont')),
      group('Letra del texto', fontRow('font')),
      group('Detalles',
        h('div', { class: 'inline-form' },
          field('Efecto del nombre:', sel('nameFx', [['none', 'Ninguno'], ['shadow', 'Sombra'], ['glow', 'Neón'], ['rainbow', 'Arcoíris']])),
          field('Foto de perfil:', sel('avatar', [['square', 'Cuadrada'], ['round', 'Redonda']])),
          field('Bordes:', sel('border', [['solid', 'Lisos'], ['dashed', 'Rayitas'], ['dotted', 'Puntitos'], ['double', 'Dobles'], ['none', 'Sin bordes']])),
          field('Esquinas redondeadas:', range('radius', 0, 16)))),
      h('div', { class: 'inline-form pf-save' },
        save,
        h('button', { class: 'btn', type: 'button', onclick: () => { if (!R.dirty || confirm('¿Descartar los cambios?')) closeEditor(); } }, 'Cancelar'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'small muted' }, 'Los cambios se ven al instante, pero solo se guardan con «Guardar».')));
    f.editSlot.replaceChildren(h('section', { class: 'box pf-edit-box' }, h('div', { class: 'bar' }, 'Editar mi perfil'), form));
  }

  // ---------- maintenance pop-up ----------
  let offTimer = null;
  function offline(on) {
    clearTimeout(offTimer);
    if (!on) { if (R.offline) R.offline.remove(); R.offline = null; return; }
    offTimer = setTimeout(() => { // short blips (like an update restarting the site) don't show it
      if (R.offline || (sock && sock.connected)) return;
      R.offline = h('div', { class: 'offline', role: 'alertdialog', 'aria-live': 'assertive' },
        h('div', { class: 'box offline-card' },
          h('div', { class: 'bar' }, 'Upipination en mantenimiento'),
          h('div', { class: 'offline-body' },
            h('b', null, '🔧 La página está en mantenimiento.'),
            h('span', null, 'Se cortó la conexión con el servidor. Puede estar apagado un rato.'),
            h('span', { class: 'small muted' }, 'No hace falta que hagas nada: la página se reconecta sola apenas vuelva.'),
            h('span', { class: 'small offline-retry' }, 'Reintentando…'),
            h('button', { type: 'button', class: 'btn', onclick: () => R.offline && R.offline.classList.add('hidden') }, 'Cerrar'))));
      document.body.append(R.offline);
    }, 6000);
  }

  // ---------- realtime ----------
  function connect() {
    if (sock) sock.disconnect();
    let first = true;
    sock = window.io({ withCredentials: true });
    sock.on('connect', () => { if (!first) reload(); first = false; offline(false); });
    // lost the server (PC off, or restarting): after a few seconds, tell people instead of failing silently
    sock.on('disconnect', reason => { if (reason !== 'io client disconnect') offline(true); });
    sock.on('chat', m => {
      S.chat.push(m);
      if (S.chat.length > 500) { S.chat.shift(); if (R.log.firstChild) R.log.firstChild.remove(); }
      delete S.typing[m.uid];
      renderTyping();
      appendChat(m);
      if (!m.sys && m.uid === S.me.id) { S.stats.messages += 1; if (!R.editingNick) updateProfile(); }
    });
    sock.on('presence', ids => { S.online = ids; updateOnline(); if (S.tab === 'profile') paintProfile(); });
    sock.on('typing', uid => { S.typing[uid] = Date.now(); renderTyping(); setTimeout(renderTyping, 3100); });
    sock.on('changed', reload);
    sock.on('live', st => { S.live = st; liveClock(st); if (S.tab === 'living') showLive(); });
    sock.on('radio', st => { S.radio = st; liveClock(st); updateMusic(); });
    sock.on('live:bad', () => toast('Ese link no parece de YouTube.'));
    sock.on('notif', reload);
    sock.on('logout', () => boot());
    sock.on('connect_error', err => { if (err && err.message === 'auth') boot(); });
  }
  async function logout() {
    try { await api('/api/logout', {}); } catch (e) {}
    boot();
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (R.lightbox) R.lightbox.classList.add('hidden'); closeEmojis(); } });
  boot();
})();
