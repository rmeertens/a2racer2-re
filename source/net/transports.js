// How the browsers of a room reach each other. Both speak the lobby's messages
// (tools/lobby.mjs) to NetSession, so the room works the same over either:
//   WsTransport    the lobby server, next to the page (npm start) or at ?lobby=wss://...
//   PeerTransport  WebRTC between the browsers, the host's browser as the hub, found through the
//                  public PeerJS broker: for a static site without a lobby, such as GitHub Pages.
//                  The broker cannot list ids, so the servers on the same network are listed by
//                  LanDirectory; any server can be joined by typing its name.
import { Peer } from 'peerjs';

export const MAX_PLAYERS = 8;
const ID_PREFIX = 'a2racer4-mp-';
const LAN_PREFIX = 'a2racer4-lan-';
const CONNECT_MS = 4000;
const STUN = 'stun:stun.l.google.com:19302';
const ANNOUNCE_MS = 3000;
const ROOM_TTL_MS = 10000;

/** A server's name as a broker id: the same name gives the same id in every browser. */
export function roomPeerId(name) {
  const slug = String(name).trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return ID_PREFIX + (slug || 'server');
}

export class WsTransport {
  constructor(url) {
    this.url = url;
    this.kind = 'lobby';
    this.lists = true;
  }

  open(onMessage, onClose) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Geen verbinding met de lobby op ' + this.url));
      }, CONNECT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Geen verbinding met de lobby op ' + this.url));
      };
      ws.onclose = () => {
        if (this.ws === ws) onClose();
      };
      ws.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data));
        } catch {
          // not ours
        }
      };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
  }
}

/**
 * A key for the network this browser is on: its public address as a STUN server sees it, which
 * the machines behind one router share. IPv4 whole; IPv6 by its /64 prefix, since every machine
 * has its own address there. Hashed, so the broker id does not carry the address. Null when the
 * browser gives no such candidate (WebRTC blocked, or no STUN reply).
 */
export async function networkKey(timeoutMs = 3000) {
  if (typeof RTCPeerConnection === 'undefined') return null;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] });
  const found = [];
  try {
    pc.createDataChannel('probe');
    const done = new Promise((resolve) => {
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          resolve();
          return;
        }
        const parts = e.candidate.candidate.split(' ');
        if (parts[7] === 'srflx') found.push(e.candidate.address || parts[4]);
      };
      setTimeout(resolve, timeoutMs);
    });
    await pc.setLocalDescription(await pc.createOffer());
    await done;
  } catch {
    return null;
  } finally {
    pc.close();
  }
  const v4 = found.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  const raw = v4 || (found[0] ? found[0].split(':').slice(0, 4).join(':') : null);
  if (!raw) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('a2racer4|' + raw)));
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The servers on this network, for a site without a lobby. One browser per network holds the
 * broker id a2racer4-lan-<networkKey>: the first to ask for it gets it. Hosts announce their
 * server to it every few seconds, and everyone asks it for the list. When that browser goes,
 * the next to notice takes the id over.
 */
export class LanDirectory {
  constructor(options) {
    this.options = options;
    this.rooms = new Map();
    this.mine = null;
    this.available = false;
    this.stopped = false;
    this.waiters = [];
  }

  async start() {
    const key = await networkKey();
    if (!key || this.stopped) return;
    this.id = LAN_PREFIX + key;
    this.available = true;
    this.claim();
    this.timer = setInterval(() => this.send(this.mine ? { t: 'announce', room: this.mine } : null), ANNOUNCE_MS);
  }

  /** Takes the directory id, or connects to whoever has it. */
  claim() {
    if (this.stopped) return;
    this.dropPeer();
    const peer = new Peer(this.id, this.options);
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.role = 'directory';
      peer.on('connection', (conn) => this.serve(conn));
    });
    peer.on('error', (e) => {
      if (this.peer !== peer) return;
      if (e.type === 'unavailable-id') this.follow();
      else this.retry();
    });
    peer.on('disconnected', () => {
      if (this.peer === peer && !this.stopped) peer.reconnect();
    });
  }

  follow() {
    this.dropPeer();
    const peer = new Peer(this.options);
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      const conn = peer.connect(this.id, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (this.peer !== peer) return;
        this.role = 'follower';
        this.conn = conn;
        if (this.mine) conn.send({ t: 'announce', room: this.mine });
      });
      conn.on('data', (m) => {
        if (m && m.t === 'rooms' && Array.isArray(m.rooms)) {
          this.last = m.rooms;
          for (const w of this.waiters.splice(0)) w(m.rooms);
        }
      });
      const gone = () => {
        if (this.conn === conn) this.conn = null;
        if (this.peer === peer) this.retry();
      };
      conn.on('close', gone);
      conn.on('iceStateChanged', (state) => {
        if (state === 'failed' || state === 'closed') gone();
      });
    });
    peer.on('error', () => {
      if (this.peer === peer) this.retry();
    });
  }

  /** The directory went or could not be reached: try to become it, at a random moment. */
  retry() {
    if (this.stopped) return;
    this.dropPeer();
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.claim(), 500 + Math.random() * 2500);
  }

  serve(conn) {
    conn.on('data', (m) => {
      if (!m) return;
      if (m.t === 'announce' && m.room && typeof m.room.name === 'string') {
        this.rooms.set(conn.peer, { ...clean(m.room), seen: Date.now() });
      } else if (m.t === 'unannounce') {
        this.rooms.delete(conn.peer);
      } else if (m.t === 'list') {
        conn.send({ t: 'rooms', rooms: this.listing() });
      }
    });
    conn.on('close', () => this.rooms.delete(conn.peer));
  }

  listing() {
    const now = Date.now();
    const out = [];
    for (const [k, r] of this.rooms) {
      if (now - r.seen > ROOM_TTL_MS) this.rooms.delete(k);
      else out.push(r);
    }
    if (this.mine) out.push(clean(this.mine));
    return out.map(({ seen, ...r }) => r);
  }

  send(msg) {
    if (this.role === 'follower' && this.conn && this.conn.open && msg) this.conn.send(msg);
  }

  /** This browser's server, or null when it hosts none. */
  announce(room) {
    this.mine = room ? clean(room) : null;
    this.send(room ? { t: 'announce', room: this.mine } : { t: 'unannounce' });
  }

  list() {
    if (this.role === 'directory') return Promise.resolve(this.listing());
    if (this.role === 'follower' && this.conn && this.conn.open) {
      return new Promise((resolve) => {
        this.waiters.push(resolve);
        this.conn.send({ t: 'list' });
        setTimeout(() => resolve(this.last || []), 2000);
      });
    }
    return Promise.resolve(this.mine ? [clean(this.mine)] : []);
  }

  dropPeer() {
    if (this.peer) {
      const p = this.peer;
      this.peer = null;
      p.destroy();
    }
    this.conn = null;
    this.role = null;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.dropPeer();
    for (const w of this.waiters.splice(0)) w([]);
  }
}

function clean(r) {
  const name = String(r.name ?? '').slice(0, 24);
  return { id: name, name, players: Math.max(0, Math.min(MAX_PLAYERS, Number(r.players) || 0)), max: MAX_PLAYERS, state: r.state === 'racing' ? 'racing' : 'lobby', track: String(r.track ?? '').slice(0, 40) };
}

export class PeerTransport {
  /** options: PeerJS options, for another broker; none for the public one. */
  constructor(options = {}) {
    this.options = { debug: 0, ...options };
    this.kind = 'peer';
    // The servers on this network, through LanDirectory.
    this.lists = true;
    this.peer = null;
    this.members = new Map();
    this.hostConn = null;
    this.racing = false;
  }

  open(onMessage, onClose) {
    this.emit = onMessage;
    this.onClose = onClose;
    this.emit({ t: 'welcome', you: null, max: MAX_PLAYERS });
    this.lan = new LanDirectory(this.options);
    this.lan.start();
    return Promise.resolve();
  }

  /** What the network's list shows of this browser's server. */
  announce() {
    if (!this.lan) return;
    if (this.role !== 'host') {
      this.lan.announce(null);
      return;
    }
    this.lan.announce({ name: this.roomName, players: this.members.size + 1, state: this.racing ? 'racing' : 'lobby', track: this.track || '' });
  }

  /** A fresh broker connection: under the room's id for a host, any id for a member. */
  newPeer(id) {
    this.drop();
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, this.options) : new Peer(this.options);
      this.peer = peer;
      let opened = false;
      peer.on('open', (you) => {
        opened = true;
        this.you = you;
        this.emit({ t: 'welcome', you, max: MAX_PLAYERS });
        resolve(peer);
      });
      peer.on('error', (e) => {
        if (this.peer !== peer) return;
        if (!opened) {
          reject(e);
          return;
        }
        if (e.type === 'peer-unavailable') this.emit({ t: 'error', error: 'no-room' });
        else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') this.emit({ t: 'error', error: 'broker' });
      });
    });
  }

  /** Forgets the room: the broker connection and every data connection. */
  drop() {
    for (const c of this.members.values()) c.close();
    this.members.clear();
    if (this.hostConn) {
      const c = this.hostConn;
      this.hostConn = null;
      c.close();
    }
    if (this.peer) {
      const p = this.peer;
      this.peer = null;
      p.destroy();
    }
    this.role = null;
    this.racing = false;
    if (this.lan) this.lan.announce(null);
  }

  send(msg) {
    switch (msg.t) {
      case 'list':
        if (this.lan) this.lan.list().then((rooms) => this.emit({ t: 'rooms', rooms, lan: true, available: this.lan.available }));
        else this.emit({ t: 'rooms', rooms: [] });
        break;
      case 'host':
        this.host(msg.name);
        break;
      case 'join':
        this.join(msg.room);
        break;
      case 'meta':
        this.racing = msg.state === 'racing';
        if (typeof msg.track === 'string') this.track = msg.track;
        this.announce();
        break;
      case 'kick': {
        const c = this.members.get(msg.id);
        if (c) {
          c.send({ t: 'closed', reason: 'kicked' });
          setTimeout(() => c.close(), 300);
        }
        break;
      }
      case 'to':
        if (this.role === 'host') this.relay(this.you, msg.to, msg.d);
        else if (this.hostConn && this.hostConn.open) this.hostConn.send({ t: 'to', to: msg.to, d: msg.d });
        break;
      case 'leave':
        if (this.role === 'host') for (const c of this.members.values()) c.send({ t: 'closed', reason: 'host-left' });
        // Let the goodbye leave before the connections close.
        setTimeout(() => this.drop(), 200);
        this.role = null;
        break;
      default:
        break;
    }
  }

  /** The host's browser is the hub: a member's message for everyone goes on to the others here. */
  relay(from, to, d) {
    const out = { t: 'from', from, d };
    if (to === '*' || to === this.you) {
      if (from !== this.you) this.emit(out);
      if (to === '*') for (const [id, c] of this.members) if (id !== from && c.open) c.send(out);
    } else {
      const c = this.members.get(to);
      if (c && c.open) c.send(out);
    }
  }

  async host(name) {
    let peer;
    try {
      peer = await this.newPeer(roomPeerId(name));
    } catch (e) {
      this.emit({ t: 'error', error: e && e.type === 'unavailable-id' ? 'name-taken' : 'broker' });
      return;
    }
    this.role = 'host';
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (this.members.size >= MAX_PLAYERS - 1 || this.racing) {
          conn.send({ t: 'closed', reason: this.racing ? 'racing' : 'room-full' });
          setTimeout(() => conn.close(), 300);
          return;
        }
        this.members.set(conn.peer, conn);
        this.emit({ t: 'peer', id: conn.peer, event: 'join' });
        this.announce();
      });
      conn.on('data', (m) => {
        if (m && m.t === 'to' && this.members.get(conn.peer) === conn) this.relay(conn.peer, m.to, m.d);
      });
      const gone = () => {
        if (this.members.get(conn.peer) !== conn) return;
        this.members.delete(conn.peer);
        this.emit({ t: 'peer', id: conn.peer, event: 'leave' });
        this.announce();
      };
      conn.on('close', gone);
      conn.on('error', gone);
      conn.on('iceStateChanged', (state) => {
        if (state === 'failed' || state === 'closed') gone();
      });
    });
    this.roomName = String(name).trim() || 'Server';
    this.emit({ t: 'hosted', room: this.you, name: this.roomName });
    this.announce();
  }

  async join(name) {
    let peer;
    try {
      peer = await this.newPeer(null);
    } catch {
      this.emit({ t: 'error', error: 'broker' });
      return;
    }
    const hostId = roomPeerId(name);
    const conn = peer.connect(hostId, { reliable: true, serialization: 'json' });
    this.hostConn = conn;
    this.role = 'member';
    const timer = setTimeout(() => {
      if (this.hostConn === conn && !conn.open) {
        this.emit({ t: 'error', error: 'no-room' });
        this.drop();
      }
    }, 15000);
    conn.on('open', () => {
      clearTimeout(timer);
      this.emit({ t: 'joined', room: hostId, name: String(name).trim(), host: hostId });
    });
    conn.on('data', (m) => {
      if (!m || this.hostConn !== conn) return;
      if (m.t === 'closed') {
        this.hostConn = null;
        this.emit({ t: 'closed', reason: m.reason });
        this.drop();
      } else if (m.t === 'from') {
        this.emit(m);
      }
    });
    const gone = () => {
      if (this.hostConn !== conn) return;
      clearTimeout(timer);
      this.hostConn = null;
      this.emit({ t: 'closed', reason: 'host-left' });
      this.drop();
    };
    conn.on('close', gone);
    conn.on('iceStateChanged', (state) => {
      if (state === 'failed' || state === 'closed') gone();
    });
  }

  close() {
    this.drop();
    if (this.lan) this.lan.stop();
    this.lan = null;
  }
}
