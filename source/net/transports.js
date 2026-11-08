// How the browsers of a room reach each other. Both speak the lobby's messages
// (tools/lobby.mjs) to NetSession, so the room works the same over either:
//   WsTransport    the lobby server, next to the page (npm start) or at ?lobby=wss://...
//   PeerTransport  WebRTC between the browsers, the host's browser as the hub, found through the
//                  public PeerJS broker: for a static site without a lobby, such as GitHub Pages.
//                  It cannot list rooms: a server is joined by its name.
import { Peer } from 'peerjs';

export const MAX_PLAYERS = 8;
const ID_PREFIX = 'a2racer4-mp-';
const CONNECT_MS = 4000;

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

export class PeerTransport {
  /** options: PeerJS options, for another broker; none for the public one. */
  constructor(options = {}) {
    this.options = { debug: 0, ...options };
    this.kind = 'peer';
    this.lists = false;
    this.peer = null;
    this.members = new Map();
    this.hostConn = null;
    this.racing = false;
  }

  open(onMessage, onClose) {
    this.emit = onMessage;
    this.onClose = onClose;
    this.emit({ t: 'welcome', you: null, max: MAX_PLAYERS });
    return Promise.resolve();
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
  }

  send(msg) {
    switch (msg.t) {
      case 'list':
        this.emit({ t: 'rooms', rooms: [], unlisted: true });
        break;
      case 'host':
        this.host(msg.name);
        break;
      case 'join':
        this.join(msg.room);
        break;
      case 'meta':
        this.racing = msg.state === 'racing';
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
      });
      conn.on('data', (m) => {
        if (m && m.t === 'to' && this.members.get(conn.peer) === conn) this.relay(conn.peer, m.to, m.d);
      });
      const gone = () => {
        if (this.members.get(conn.peer) !== conn) return;
        this.members.delete(conn.peer);
        this.emit({ t: 'peer', id: conn.peer, event: 'leave' });
      };
      conn.on('close', gone);
      conn.on('error', gone);
      conn.on('iceStateChanged', (state) => {
        if (state === 'failed' || state === 'closed') gone();
      });
    });
    this.emit({ t: 'hosted', room: this.you, name: String(name).trim() || 'Server' });
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
  }
}
