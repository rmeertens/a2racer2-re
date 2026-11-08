// The multiplayer screens, over the main menu: name a server and host it, or pick one to join;
// then the room, where the host picks etappe, laps and difficulty and everyone their car.
// The port's own screens, in Dutch like the rest of the game. docs/multiplayer.md.
import { NetSession, lobbyChoice, MAX_PLAYERS } from './session.js';

const LIST_MS = 2000;
const STORE = 'a2racer4.multiplayer';
const ERRORS = {
  'name-taken': 'Die servernaam is al in gebruik. Kies een andere naam.',
  'no-room': 'Die server bestaat niet (meer).',
  'room-full': `Die server is vol: er kunnen ${MAX_PLAYERS} spelers mee.`,
  racing: 'Op die server wordt nu geracet. Probeer het na de race opnieuw.',
  full: 'Er zijn te veel servers. Probeer het later opnieuw.',
  broker: 'Geen verbinding met de PeerJS-server waarmee browsers elkaar vinden. Probeer het later opnieuw.',
  'host-left': 'De host heeft de server gesloten.',
  kicked: 'De host heeft je van de server gehaald.',
};
const DIFFICULTY = ['Makkelijk', 'Normaal', 'Moeilijk'];
/** Car 7 is Davilex's download car, the truck: static.ini names it only 'downld'. */
const CAR_NAMES = { 6: 'Politie-auto', 7: 'De Schaduw (truck)' };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}');
  } catch {
    return {};
  }
}

function store(v) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    // private window: nothing kept
  }
}

function formatTime(s) {
  if (typeof s !== 'number' || !isFinite(s)) return '-';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}

export class LobbyUI {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.saved = load();
    this.session = new NetSession(lobbyChoice(app.params));
    this.session.on((event, data) => this.event(event, data));
    this.build();
  }

  get data() {
    return this.app.data;
  }

  /** The cars a player may pick: indexInGame 0 to 7, named as static.ini has them. */
  cars() {
    const out = [];
    for (let c = 0; c <= 7; c++) {
      const ch = this.data.static.chars.find((x) => x.indexInGame === c);
      out.push({ car: c, name: CAR_NAMES[c] || (ch ? ch.name : `Auto ${c}`) });
    }
    return out;
  }

  /** Races, not chases: a chase has no opponents (FUN_0042de60), so no slots for others. */
  tracks() {
    return this.data.static.tracks.filter((t) => !t.isChase && this.data.trackFilesExist(t));
  }

  carName(c) {
    return (this.cars().find((x) => x.car === c) || { name: `Auto ${c}` }).name;
  }

  build() {
    const r = this.root;
    r.textContent = '';
    this.error = el('p', { class: 'mp-error', role: 'alert', hidden: true });
    this.nick = el('input', { id: 'mp-nick', maxlength: 16, autocomplete: 'off', spellcheck: 'false' });
    this.serverName = el('input', { id: 'mp-server', maxlength: 24, autocomplete: 'off', spellcheck: 'false', placeholder: 'Bijvoorbeeld: Racen bij Roland' });
    this.joinName = el('input', { id: 'mp-join', maxlength: 24, autocomplete: 'off', spellcheck: 'false', placeholder: 'Servernaam' });
    this.roomList = el('ul', { class: 'mp-rooms' });
    this.browse = el('section', { class: 'mp-browse' },
      el('label', { class: 'mp-field', for: 'mp-nick' }, el('span', { text: 'Jouw naam' }), this.nick),
      el('div', { class: 'mp-box' },
        el('h2', { text: 'Een server maken' }),
        el('label', { class: 'mp-field', for: 'mp-server' }, el('span', { text: 'Servernaam' }), this.serverName),
        el('button', { class: 'mp-primary', text: 'Server maken', onclick: () => this.hostClick() })),
      el('div', { class: 'mp-box' },
        el('h2', { text: 'Meedoen met een server' }),
        this.joinHint = el('p', { class: 'mp-empty', hidden: true, text: 'Typ de naam van de server, zoals de host hem noemde.' }),
        this.roomList,
        el('div', { class: 'mp-row' }, this.joinName, el('button', { text: 'Meedoen', onclick: () => this.joinClick(this.joinName.value) }))));

    this.roomTitle = el('h2', { class: 'mp-roomname' });
    this.trackSel = el('select', { id: 'mp-track', onchange: () => this.settingsChanged() });
    this.lapSel = el('select', { id: 'mp-laps', onchange: () => this.settingsChanged() });
    for (let n = 1; n <= 9; n++) this.lapSel.append(el('option', { value: n, text: String(n) }));
    this.diffSel = el('select', { id: 'mp-difficulty', onchange: () => this.settingsChanged() });
    DIFFICULTY.forEach((d, k) => this.diffSel.append(el('option', { value: k, text: d })));
    this.settingsText = el('p', { class: 'mp-settings-text' });
    this.settingsForm = el('div', { class: 'mp-settings' },
      el('label', { class: 'mp-field', for: 'mp-track' }, el('span', { text: 'Etappe' }), this.trackSel),
      el('label', { class: 'mp-field', for: 'mp-laps' }, el('span', { text: 'Ronden' }), this.lapSel),
      el('label', { class: 'mp-field', for: 'mp-difficulty' }, el('span', { text: 'Moeilijkheid' }), this.diffSel));
    this.carSel = el('select', { id: 'mp-car', onchange: () => this.carChanged() });
    for (const c of this.cars()) this.carSel.append(el('option', { value: c.car, text: c.name }));
    this.players = el('tbody');
    this.results = el('div', { class: 'mp-results', hidden: true });
    this.readyBtn = el('button', { class: 'mp-primary', onclick: () => this.readyClick() });
    this.startBtn = el('button', { class: 'mp-primary', text: 'Start de race', onclick: () => this.session.start() });
    this.status = el('p', { class: 'mp-status' });
    this.room = el('section', { class: 'mp-room', hidden: true },
      this.roomTitle,
      this.settingsForm,
      this.settingsText,
      el('table', { class: 'mp-players' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Start' }), el('th', { text: 'Naam' }), el('th', { text: 'Auto' }), el('th', { text: 'Status' }), el('th', { text: 'Ping' }), el('th'))),
        this.players),
      el('label', { class: 'mp-field', for: 'mp-car' }, el('span', { text: 'Jouw auto' }), this.carSel),
      this.results,
      this.status,
      el('div', { class: 'mp-row mp-actions' },
        el('button', { text: 'Server verlaten', onclick: () => this.leaveClick() }),
        this.readyBtn,
        this.startBtn));

    r.append(el('div', { class: 'mp-panel', role: 'dialog', 'aria-label': 'Multiplayer' },
      el('header', {},
        el('h1', { text: 'Multiplayer' }),
        el('button', { class: 'mp-close', text: 'Terug', onclick: () => this.closeClick() })),
      this.error, this.browse, this.room,
      el('p', { class: 'mp-note', text: `Tot ${MAX_PLAYERS} spelers. Elke speler rijdt zijn eigen race in de browser; de anderen rijden mee op de plaatsen van de tegenstanders. Verkeer en politie zijn per speler.` })));
    r.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeClick();
    });
    for (const ev of ['keyup', 'pointerdown', 'pointerup', 'wheel']) r.addEventListener(ev, (e) => e.stopPropagation());
  }

  show() {
    const player = this.data.player;
    this.nick.value = this.saved.nick || (player ? player.name : '') || 'Speler';
    this.serverName.value = this.saved.server || (player ? `${player.name}s server` : 'Mijn server');
    if (!this.mineCar && this.mineCar !== 0) this.mineCar = this.saved.car ?? (player && player.qrChar ? player.qrChar.indexInGame : 0);
    this.carSel.value = String(this.mineCar);
    this.root.hidden = false;
    if (this.session.room) {
      this.showRoom(this.session.room);
    } else {
      this.showBrowse();
    }
  }

  hide() {
    this.root.hidden = true;
    clearInterval(this.listTimer);
  }

  say(text) {
    this.error.textContent = text || '';
    this.error.hidden = !text;
  }

  remember() {
    this.saved = { ...this.saved, nick: this.nick.value.trim(), server: this.serverName.value.trim(), car: this.mineCar };
    store(this.saved);
  }

  async showBrowse() {
    this.browse.hidden = false;
    this.room.hidden = true;
    clearInterval(this.listTimer);
    try {
      await this.session.connect();
      this.roomList.hidden = !this.session.lists;
      this.joinHint.hidden = this.session.lists;
      if (this.session.lists) {
        this.session.list();
        this.listTimer = setInterval(() => this.session.list(), LIST_MS);
      }
    } catch (e) {
      this.say(`${e.message}. Draait de server met de lobby? Zie docs/multiplayer.md.`);
    }
  }

  renderRooms(rooms) {
    if (this.browse.hidden) return;
    const items = rooms.map((r) => el('li', {},
      el('span', { class: 'mp-room-name', text: r.name }),
      el('span', { class: 'mp-room-info', text: `${r.players}/${r.max}${r.track ? ' · ' + r.track : ''}${r.state === 'racing' ? ' · racet' : ''}` }),
      el('button', { text: 'Meedoen', disabled: r.players >= r.max || r.state === 'racing', onclick: () => this.joinClick(r.id) })));
    if (!items.length) items.push(el('li', { class: 'mp-empty', text: 'Nog geen servers. Maak er zelf een.' }));
    this.roomList.replaceChildren(...items);
  }

  me() {
    return { nick: this.nick.value.trim() || 'Speler', car: this.mineCar };
  }

  async hostClick() {
    this.say('');
    this.remember();
    const tracks = this.tracks();
    const t = tracks[0];
    try {
      await this.session.host(this.serverName.value.trim() || 'Server', this.me(), { etappe: t ? t.indexInGame : 0, laps: t ? t.nrLaps : 2, name: t ? t.name : '' });
      this.session.room.difficulty = 1;
      this.session.publish();
    } catch (e) {
      this.say(ERRORS[e.message] || e.message);
    }
  }

  async joinClick(room) {
    this.say('');
    if (!String(room || '').trim()) return;
    this.remember();
    try {
      await this.session.join(String(room).trim(), this.me());
    } catch (e) {
      this.say(ERRORS[e.message] || e.message);
    }
  }

  leaveClick() {
    this.session.leave();
    this.showBrowse();
  }

  closeClick() {
    if (this.session.room) this.session.leave();
    this.session.close();
    this.hide();
    this.app.closeMultiplayer();
  }

  readyClick() {
    const r = this.session.room;
    const me = r && r.players.find((p) => p.id === this.session.you);
    if (me) this.session.setMine({ ready: !me.ready });
  }

  carChanged() {
    this.mineCar = Number(this.carSel.value);
    this.remember();
    this.session.setMine({ car: this.mineCar });
  }

  settingsChanged() {
    const t = this.tracks().find((x) => x.indexInGame === Number(this.trackSel.value));
    if (!t) return;
    const trackChanged = this.session.room && this.session.room.etappe !== t.indexInGame;
    const laps = trackChanged ? t.nrLaps : Number(this.lapSel.value);
    this.session.room.difficulty = Number(this.diffSel.value);
    this.session.setTrack(t.indexInGame, laps, t.name);
  }

  event(event, data) {
    if (this.root.hidden && event !== 'start') return;
    switch (event) {
      case 'rooms':
        this.renderRooms(data);
        break;
      case 'room':
        this.showRoom(data);
        break;
      case 'closed':
        this.say(ERRORS[data && data.error] || 'De server is gesloten.');
        this.showBrowse();
        break;
      case 'disconnected':
        this.say('De verbinding met de lobby is verbroken.');
        this.showBrowse();
        break;
      case 'error':
        if (data && ERRORS[data.error]) this.say(ERRORS[data.error]);
        break;
      case 'start':
        this.hide();
        this.app.startNetRace(data);
        break;
      default:
        break;
    }
  }

  showRoom(room) {
    if (!room) return;
    clearInterval(this.listTimer);
    this.browse.hidden = true;
    this.room.hidden = false;
    const s = this.session;
    const host = s.isHost;
    this.roomTitle.textContent = `Server: ${room.name}`;
    const tracks = this.tracks();
    if (this.trackSel.options.length !== tracks.length) {
      this.trackSel.replaceChildren(...tracks.map((t) => el('option', { value: t.indexInGame, text: `${t.name} (${t.type})` })));
    }
    this.trackSel.value = String(room.etappe);
    this.lapSel.value = String(room.laps);
    this.diffSel.value = String(room.difficulty ?? 1);
    const lobby = room.phase === 'lobby';
    for (const sel of [this.trackSel, this.lapSel, this.diffSel]) sel.disabled = !host || !lobby;
    this.settingsForm.hidden = !host;
    this.settingsText.hidden = host;
    this.settingsText.textContent = `${room.trackName || 'Etappe ' + room.etappe} · ${room.laps} ${room.laps === 1 ? 'ronde' : 'ronden'} · ${DIFFICULTY[room.difficulty ?? 1]}`;
    const me = room.players.find((p) => p.id === s.you);
    this.players.replaceChildren(...room.players.map((p, k) => {
      let state = p.id === room.host ? 'Host' : p.ready ? 'Klaar' : 'Nog niet klaar';
      if (room.phase !== 'lobby') state = p.finished ? `Binnen: ${formatTime(p.time)}` : p.inRace ? 'Racet' : 'Gestopt';
      const kick = host && p.id !== s.you && lobby ? el('button', { class: 'mp-kick', text: 'Weg', title: 'Van de server halen', onclick: () => s.kick(p.id) }) : null;
      return el('tr', { class: p.id === s.you ? 'mine' : '' },
        el('td', { text: String(k + 1) }), el('td', { text: p.nick }), el('td', { text: this.carName(p.car) }),
        el('td', { text: state }), el('td', { text: p.id === room.host ? '' : `${p.ping || '-'} ms` }), el('td', {}, kick));
    }));
    this.carSel.disabled = !lobby;
    if (me && me.car !== this.mineCar && lobby) this.carSel.value = String(me.car);
    this.readyBtn.hidden = host;
    this.readyBtn.textContent = me && me.ready ? 'Toch niet klaar' : 'Klaar';
    this.readyBtn.disabled = !lobby;
    this.startBtn.hidden = !host;
    this.startBtn.disabled = !s.canStart();
    const waiting = room.players.filter((p) => !p.ready && p.id !== room.host).length;
    if (!lobby) this.status.textContent = 'Er wordt nog geracet. De volgende race kan beginnen als iedereen terug is.';
    else if (host) this.status.textContent = waiting ? `Wachten tot iedereen klaar is (${waiting}).` : room.players.length === 1 ? 'Je kunt alleen starten, of wachten op anderen.' : 'Iedereen is klaar.';
    else this.status.textContent = 'De host start de race.';
    const results = room.results || [];
    this.results.hidden = !results.length;
    if (results.length) {
      this.results.replaceChildren(el('h3', { text: 'Uitslag van de laatste race' }), el('ol', {}, ...results.map((x) => el('li', {},
        el('span', { text: x.nick }), el('span', { text: this.carName(x.car) }), el('b', { text: formatTime(x.time) })))));
    }
  }
}
