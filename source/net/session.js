// A network room, as the host's browser keeps it or a member's browser follows it. The lobby
// server (tools/lobby.mjs) lists rooms and passes messages on; the room itself lives here: who
// is in, which etappe and how many laps, the start, the results. Race state goes from every
// browser to all the others, about 30 times a second.
//
// Messages, in the d field of the lobby's 'to' and 'from':
//   member -> host  hello { nick, car }, set { car, ready }, ping { c }, loaded
//   host -> member  room { ... }, pong { c, h }, start { race }, go { at }
//   all -> all      s { sample }, fin { time }, left

import { WsTransport, PeerTransport } from './transports.js';

/**
 * Where the browsers meet. ?lobby=peer: WebRTC through the public PeerJS broker. ?lobby=wss://...:
 * that lobby server. Otherwise the lobby next to the page, as npm start serves it, and when there
 * is none, as on a static site, the broker.
 */
export function lobbyChoice(params) {
  const given = params && params.get('lobby');
  if (given === 'peer') return { url: null, fallback: true };
  if (given) return { url: given, fallback: false };
  const u = new URL('lobby', location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  u.hash = '';
  return { url: u.href, fallback: true };
}

export const MAX_PLAYERS = 8;
const PING_MS = 2000;
const LOAD_TIMEOUT_MS = 60000;
const GO_DELAY_MS = 1500;
const SAMPLE_TICKS = 2;

const now = () => performance.now();

export class NetSession {
  /** choice: lobbyChoice(). */
  constructor(choice) {
    this.choice = choice;
    this.transport = null;
    this.you = null;
    this.role = null;
    this.roomId = null;
    this.room = null;
    this.rooms = [];
    this.listeners = new Set();
    this.offset = 0;
    this.bestRtt = Infinity;
    this.rtt = 0;
    this.race = null;
    this.net = null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event, data) {
    for (const fn of this.listeners) fn(event, data);
  }

  /** The room's shared clock in seconds: the host's performance.now(). */
  clock = () => (now() + this.offset) / 1000;

  get isHost() {
    return this.role === 'host';
  }

  get connected() {
    return Boolean(this.transport);
  }

  /** Whether the way the browsers meet can list servers. The broker cannot. */
  get lists() {
    return Boolean(this.transport && this.transport.lists);
  }

  connect() {
    if (this.ready) return this.ready;
    const attempt = async () => {
      const onMessage = (msg) => this.lobbyMessage(msg);
      const onClose = (t) => () => {
        if (this.transport !== t) return;
        this.transport = null;
        this.ready = null;
        const wasIn = Boolean(this.roomId);
        this.resetRoom();
        this.emit('disconnected', { wasIn });
      };
      if (this.choice.url) {
        const ws = new WsTransport(this.choice.url);
        try {
          await ws.open(onMessage, onClose(ws));
          this.transport = ws;
          return;
        } catch (e) {
          if (!this.choice.fallback) throw e;
        }
      }
      const peer = new PeerTransport();
      await peer.open(onMessage, onClose(peer));
      this.transport = peer;
    };
    this.ready = attempt().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  close() {
    const t = this.transport;
    this.transport = null;
    this.ready = null;
    this.resetRoom();
    if (t) t.close();
  }

  put(msg) {
    if (this.transport) this.transport.send(msg);
  }

  to(id, d) {
    this.put({ t: 'to', to: id, d });
  }

  toAll(d) {
    this.put({ t: 'to', to: '*', d });
  }

  list() {
    this.put({ t: 'list' });
  }

  resetRoom() {
    clearInterval(this.pingTimer);
    clearTimeout(this.loadTimer);
    this.role = null;
    this.roomId = null;
    this.room = null;
    this.offset = 0;
    this.bestRtt = Infinity;
  }

  // --- joining and hosting -----------------------------------------------------------

  /** Opens a room named name. me: { nick, car }. track: { etappe, laps, name } to start with. */
  async host(name, me, track) {
    await this.connect();
    this.pending = { kind: 'host', me, track };
    this.put({ t: 'host', name });
    return this.wait('room');
  }

  async join(room, me) {
    await this.connect();
    this.pending = { kind: 'join', me };
    this.put({ t: 'join', room });
    return this.wait('room');
  }

  /** Resolves on the next event of that kind, rejects on an error first. */
  wait(kind) {
    return new Promise((resolve, reject) => {
      const off = this.on((event, data) => {
        if (event === kind) {
          off();
          resolve(data);
        } else if (event === 'error' || event === 'closed' || event === 'disconnected') {
          off();
          reject(new Error(data && data.error ? data.error : event));
        }
      });
    });
  }

  leave() {
    if (this.roomId) this.put({ t: 'leave' });
    this.resetRoom();
    this.emit('left');
  }

  lobbyMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        if (msg.you) this.you = msg.you;
        break;
      case 'rooms':
        this.rooms = msg.rooms || [];
        this.emit('rooms', this.rooms);
        break;
      case 'error':
        this.pending = null;
        this.emit('error', { error: msg.error });
        break;
      case 'hosted': {
        const p = this.pending || { me: { nick: 'Host', car: 0 }, track: { etappe: 0, laps: 2, name: '' } };
        this.pending = null;
        this.role = 'host';
        this.roomId = msg.room;
        this.room = {
          id: msg.room, name: msg.name, host: this.you, phase: 'lobby',
          etappe: p.track.etappe, laps: p.track.laps, trackName: p.track.name,
          players: [{ id: this.you, nick: p.me.nick, car: p.me.car, ready: true, ping: 0 }],
          results: null, raceId: 0,
        };
        this.publish();
        break;
      }
      case 'joined': {
        const p = this.pending || { me: { nick: 'Speler', car: 0 } };
        this.pending = null;
        this.role = 'member';
        this.roomId = msg.room;
        this.hostId = msg.host;
        this.to(this.hostId, { k: 'hello', nick: p.me.nick, car: p.me.car });
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.to(this.hostId, { k: 'ping', c: now() }), PING_MS);
        this.to(this.hostId, { k: 'ping', c: now() });
        break;
      }
      case 'peer':
        if (this.isHost) this.peer(msg.id, msg.event);
        break;
      case 'closed': {
        const reason = msg.reason;
        this.resetRoom();
        this.emit('closed', { error: reason });
        break;
      }
      case 'from':
        this.message(msg.from, msg.d);
        break;
      default:
        break;
    }
  }

  // --- the room, kept by the host --------------------------------------------------------

  /** Host: sends the room to everyone and to the listing. */
  publish() {
    if (!this.isHost || !this.room) return;
    this.toAll({ k: 'room', room: this.room });
    this.put({ t: 'meta', state: this.room.phase === 'lobby' ? 'lobby' : 'racing', track: this.room.trackName || '' });
    this.emit('room', this.room);
  }

  peer(id, event) {
    const r = this.room;
    if (!r) return;
    if (event === 'leave') {
      const gone = r.players.find((p) => p.id === id);
      r.players = r.players.filter((p) => p.id !== id);
      if (gone && this.net) this.net.remove(id);
      if (r.phase !== 'lobby') this.raceProgress();
      this.publish();
    }
  }

  /** Host: what a member sent. Members: what the host or another member sent. */
  message(from, d) {
    if (!d || typeof d !== 'object') return;
    const r = this.room;
    if (this.isHost) {
      const p = r && r.players.find((x) => x.id === from);
      switch (d.k) {
        case 'hello':
          if (!r) return;
          if (r.players.length >= MAX_PLAYERS && !p) return;
          if (!p) r.players.push({ id: from, nick: cleanNick(d.nick), car: carOf(d.car), ready: false, ping: 0 });
          this.publish();
          return;
        case 'set':
          if (!p) return;
          if (d.car !== undefined && r.phase === 'lobby') p.car = carOf(d.car);
          if (d.ready !== undefined) p.ready = Boolean(d.ready);
          if (d.nick !== undefined) p.nick = cleanNick(d.nick);
          this.publish();
          return;
        case 'ping':
          this.to(from, { k: 'pong', c: d.c, h: now() });
          if (p && typeof d.rtt === 'number') p.ping = Math.round(d.rtt);
          return;
        case 'loaded':
          if (p) p.loaded = true;
          this.maybeGo();
          return;
        default:
          break;
      }
    } else {
      switch (d.k) {
        case 'room':
          this.room = d.room;
          this.emit('room', this.room);
          return;
        case 'pong': {
          const rtt = now() - d.c;
          this.rtt = rtt;
          // The fastest exchange says the most about the offset: NTP's rule.
          if (rtt <= this.bestRtt * 1.5 || rtt < 30) {
            this.bestRtt = Math.min(this.bestRtt, rtt);
            this.offset = d.h + rtt / 2 - now();
          }
          // Next ping carries the round trip, for the host's list.
          clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => this.to(this.hostId, { k: 'ping', c: now(), rtt: this.rtt }), PING_MS);
          return;
        }
        case 'start':
          if (from === this.hostId && d.race) {
            this.currentRace = d.race;
            this.emit('start', d.race);
          }
          return;
        case 'go':
          if (from === this.hostId) {
            this.lastGo = { at: d.at - this.offset, raceId: d.raceId };
            this.emit('go', this.lastGo);
          }
          return;
        default:
          break;
      }
    }
    // Both: race traffic.
    switch (d.k) {
      case 's':
        if (this.net && d.s) this.net.receive(from, d.s);
        return;
      case 'fin':
        this.finished(from, d.time);
        return;
      case 'left':
        if (this.net) this.net.remove(from);
        if (this.isHost && r) {
          const p = r.players.find((x) => x.id === from);
          if (p) p.inRace = false;
          this.raceProgress();
          this.publish();
        }
        return;
      default:
        break;
    }
  }

  // --- the host's settings --------------------------------------------------------------

  setTrack(etappe, laps, name) {
    if (!this.isHost || this.room.phase !== 'lobby') return;
    Object.assign(this.room, { etappe, laps, trackName: name });
    this.publish();
  }

  /** Mine: the car I drive, and whether I am ready. */
  setMine(change) {
    if (!this.room) return;
    if (this.isHost) {
      const p = this.room.players.find((x) => x.id === this.you);
      if (change.car !== undefined) p.car = carOf(change.car);
      if (change.nick !== undefined) p.nick = cleanNick(change.nick);
      this.publish();
    } else {
      this.to(this.hostId, { k: 'set', ...change });
    }
  }

  kick(id) {
    if (this.isHost) this.put({ t: 'kick', id });
  }

  canStart() {
    const r = this.room;
    return Boolean(this.isHost && r && r.phase === 'lobby' && r.players.every((p) => p.ready || p.id === this.you));
  }

  /** Host: the grid is the order of the list, the host first. */
  start() {
    if (!this.canStart()) return;
    const r = this.room;
    r.raceId = (r.raceId || 0) + 1;
    r.phase = 'loading';
    r.results = [];
    const race = {
      id: r.raceId,
      etappe: r.etappe,
      laps: r.laps,
      difficulty: r.difficulty ?? 1,
      trackName: r.trackName,
      seed: 1 + Math.floor(Math.random() * 90000) / 1000,
      players: r.players.map((p, grid) => ({ id: p.id, nick: p.nick, car: p.car, grid })),
    };
    for (const p of r.players) {
      p.loaded = false;
      p.inRace = true;
      p.finished = false;
      p.time = null;
      if (p.id !== this.you) p.ready = false;
    }
    this.currentRace = race;
    this.toAll({ k: 'start', race });
    this.publish();
    clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => this.go(), LOAD_TIMEOUT_MS);
    this.emit('start', race);
  }

  maybeGo() {
    const r = this.room;
    if (!this.isHost || !r || r.phase !== 'loading') return;
    if (r.players.every((p) => p.loaded || !p.inRace)) this.go();
  }

  go() {
    const r = this.room;
    if (!this.isHost || !r || r.phase !== 'loading') return;
    clearTimeout(this.loadTimer);
    r.phase = 'racing';
    const at = now() + GO_DELAY_MS;
    this.toAll({ k: 'go', at, raceId: r.raceId });
    this.publish();
    this.lastGo = { at, raceId: r.raceId };
    this.emit('go', this.lastGo);
  }

  // --- in a race ------------------------------------------------------------------------

  /** This browser's race is booted: the host starts when all are. Resolves at the shared start. */
  loaded(net) {
    this.net = net;
    this.tickCount = 0;
    this.myFinish = null;
    const raceId = this.currentRace && this.currentRace.id;
    const go = new Promise((resolve) => {
      if (this.lastGo && this.lastGo.raceId === raceId) {
        resolve(this.lastGo.at);
        return;
      }
      const off = this.on((event, data) => {
        if (event === 'go' && data.raceId === raceId) {
          off();
          resolve(data.at);
        } else if (event === 'closed' || event === 'disconnected' || event === 'left') {
          off();
          resolve(null);
        }
      });
    });
    if (this.isHost) {
      const me = this.room.players.find((p) => p.id === this.you);
      if (me) me.loaded = true;
      this.maybeGo();
    } else {
      this.to(this.hostId, { k: 'loaded' });
    }
    // at is in this browser's performance.now(): the host's time less the offset.
    return go.then((at) => {
      if (at === null) return;
      this.goClock = (at + this.offset) / 1000;
      const wait = at - now();
      return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : undefined;
    });
  }

  /** After each tick of the local race. */
  afterTick() {
    const net = this.net;
    if (!net) return;
    this.tickCount++;
    if (!this.myFinish && net.finishedNow) {
      this.myFinish = this.clock() - (this.goClock || this.clock());
      this.toAll({ k: 'fin', time: this.myFinish });
      this.finished(this.you, this.myFinish);
    }
    if (this.tickCount % SAMPLE_TICKS === 0 && this.roomId) this.toAll({ k: 's', s: net.sample() });
  }

  finished(id, time) {
    const r = this.room;
    if (!r) return;
    if (typeof time !== 'number' || !isFinite(time)) return;
    const p = r.players.find((x) => x.id === id);
    if (p) {
      p.finished = true;
      p.time = time;
    }
    if (this.isHost) {
      r.results = r.results || [];
      if (!r.results.some((x) => x.id === id) && p) r.results.push({ id, nick: p.nick, car: p.car, time });
      r.results.sort((a, b) => a.time - b.time);
      this.publish();
    } else {
      this.emit('room', r);
    }
  }

  /** The local race has ended: back to the room. */
  raceEnded() {
    this.toAll({ k: 'left' });
    const net = this.net;
    this.net = null;
    if (this.isHost && this.room) {
      const me = this.room.players.find((p) => p.id === this.you);
      if (me) me.inRace = false;
      this.raceProgress();
      this.publish();
    }
    return net;
  }

  /** Host: back to the lobby once nobody is racing. Those who did not finish get no time. */
  raceProgress() {
    const r = this.room;
    if (!this.isHost || !r || r.phase === 'lobby') return;
    if (r.players.some((p) => p.inRace)) return;
    r.phase = 'lobby';
    clearTimeout(this.loadTimer);
  }
}

function cleanNick(s) {
  const t = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return t || 'Speler';
}

function carOf(c) {
  const n = Number(c);
  return Number.isInteger(n) && n >= 0 && n <= 7 ? n : 0;
}
