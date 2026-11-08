// The lobby for network races: a list of named servers and a relay between the browsers in one.
// The race itself runs in each player's browser; the host's browser runs the room (who is in,
// which etappe, when to start, the results). This only lists rooms and passes messages on, so it
// needs no game files and keeps no state beyond the open connections. Plain WebSocket (RFC 6455)
// on node:http, without dependencies.
//   attachLobby(server, { path: '/lobby' })   on an existing http.Server, as tools/serve.mjs does
//   node tools/lobby-server.mjs               on its own, behind a proxy, see docs/multiplayer.md
import { createHash, randomBytes } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Eight players: the host and seven others, as many cars as a race can hold. */
export const MAX_PLAYERS = 8;
const MAX_MESSAGE = 64 * 1024;
const MAX_ROOMS = 200;
const PING_MS = 20000;
const NAME_MAX = 24;

function cleanName(s, fallback) {
  const t = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX);
  return t || fallback;
}

/** One WebSocket connection: frames in and out, text messages as JSON. */
class Socket {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.closed = false;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.data(d));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }

  data(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2);
        if (hi) return this.close(1009);
        len = b.readUInt32BE(6);
        at = 10;
      }
      if (len > MAX_MESSAGE || !masked) return this.close(1009);
      if (b.length < at + 4 + len) return;
      const mask = b.subarray(at, at + 4);
      const payload = Buffer.from(b.subarray(at + 4, at + 4 + len));
      for (let k = 0; k < payload.length; k++) payload[k] ^= mask[k & 3];
      this.buffer = b.subarray(at + 4 + len);
      if (op === 8) return this.close(1000);
      if (op === 9) {
        this.frame(10, payload);
        continue;
      }
      if (op === 10) {
        this.alive = true;
        continue;
      }
      if (op === 0 || op === 1 || op === 2) {
        this.fragments.push(payload);
        if (this.fragments.reduce((n, f) => n + f.length, 0) > MAX_MESSAGE) return this.close(1009);
        if (!fin) continue;
        const whole = Buffer.concat(this.fragments);
        this.fragments = [];
        let msg;
        try {
          msg = JSON.parse(whole.toString('utf8'));
        } catch {
          continue;
        }
        if (msg && typeof msg === 'object') this.onMessage(msg);
      }
    }
  }

  frame(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255]) : null;
    let header = head;
    if (!header) {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(msg) {
    this.frame(1, Buffer.from(JSON.stringify(msg), 'utf8'));
  }

  close(code = 1000) {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.end(Buffer.from([0x88, 2, code >> 8, code & 255]));
    } catch {
      // already gone
    }
    this.socket.destroy();
    this.onClose();
  }
}

export class Lobby {
  constructor() {
    this.clients = new Map();
    this.rooms = new Map();
    this.timer = setInterval(() => this.ping(), PING_MS);
    this.timer.unref?.();
  }

  ping() {
    for (const c of this.clients.values()) {
      if (!c.ws.alive) {
        c.ws.close(1001);
        continue;
      }
      c.ws.alive = false;
      c.ws.frame(9, Buffer.alloc(0));
    }
  }

  connect(socket) {
    const id = randomBytes(6).toString('hex');
    const client = { id, room: null };
    client.ws = new Socket(socket, (msg) => this.message(client, msg), () => this.leave(client, true));
    this.clients.set(id, client);
    client.ws.send({ t: 'welcome', you: id, max: MAX_PLAYERS });
  }

  listing() {
    return [...this.rooms.values()].map((r) => ({ id: r.id, name: r.name, players: r.members.size, max: r.max, state: r.state, track: r.track }));
  }

  message(client, msg) {
    const room = client.room ? this.rooms.get(client.room) : null;
    switch (msg.t) {
      case 'list':
        client.ws.send({ t: 'rooms', rooms: this.listing() });
        break;
      case 'host': {
        this.leave(client, false);
        if (this.rooms.size >= MAX_ROOMS) {
          client.ws.send({ t: 'error', error: 'full' });
          break;
        }
        const name = cleanName(msg.name, 'Server');
        if ([...this.rooms.values()].some((r) => r.name.toLowerCase() === name.toLowerCase())) {
          client.ws.send({ t: 'error', error: 'name-taken' });
          break;
        }
        const r = { id: randomBytes(4).toString('hex'), name, host: client.id, members: new Set([client.id]), max: MAX_PLAYERS, state: 'lobby', track: '' };
        this.rooms.set(r.id, r);
        client.room = r.id;
        client.ws.send({ t: 'hosted', room: r.id, name: r.name });
        break;
      }
      case 'join': {
        this.leave(client, false);
        const key = String(msg.room ?? '').toLowerCase();
        const r = this.rooms.get(msg.room) || [...this.rooms.values()].find((x) => x.name.toLowerCase() === key);
        if (!r) {
          client.ws.send({ t: 'error', error: 'no-room' });
          break;
        }
        if (r.members.size >= r.max) {
          client.ws.send({ t: 'error', error: 'room-full' });
          break;
        }
        if (r.state !== 'lobby') {
          client.ws.send({ t: 'error', error: 'racing' });
          break;
        }
        r.members.add(client.id);
        client.room = r.id;
        client.ws.send({ t: 'joined', room: r.id, name: r.name, host: r.host });
        this.clients.get(r.host)?.ws.send({ t: 'peer', id: client.id, event: 'join' });
        break;
      }
      case 'meta':
        // The host tells the listing what the room is doing.
        if (room && room.host === client.id) {
          if (msg.state === 'lobby' || msg.state === 'racing') room.state = msg.state;
          if (typeof msg.track === 'string') room.track = msg.track.slice(0, 40);
        }
        break;
      case 'kick':
        if (room && room.host === client.id && msg.id !== client.id && room.members.has(msg.id)) {
          const other = this.clients.get(msg.id);
          other?.ws.send({ t: 'closed', reason: 'kicked' });
          if (other) this.leave(other, false);
        }
        break;
      case 'to': {
        // To one member, or '*' for all others. Members other than the host reach the host and,
        // for race state, each other: the relay fans out so a sample crosses it once.
        if (!room) break;
        const out = { t: 'from', from: client.id, d: msg.d };
        if (msg.to === '*') {
          for (const id of room.members) if (id !== client.id) this.clients.get(id)?.ws.send(out);
        } else if (room.members.has(msg.to)) {
          this.clients.get(msg.to)?.ws.send(out);
        }
        break;
      }
      case 'leave':
        this.leave(client, false);
        break;
      default:
        break;
    }
  }

  leave(client, gone) {
    const r = client.room ? this.rooms.get(client.room) : null;
    client.room = null;
    if (gone) this.clients.delete(client.id);
    if (!r) return;
    r.members.delete(client.id);
    if (r.host === client.id) {
      this.rooms.delete(r.id);
      for (const id of r.members) {
        const other = this.clients.get(id);
        if (!other) continue;
        other.room = null;
        other.ws.send({ t: 'closed', reason: 'host-left' });
      }
    } else {
      this.clients.get(r.host)?.ws.send({ t: 'peer', id: client.id, event: 'leave' });
    }
  }
}

/** Answers WebSocket upgrades on path, and only those, on an http.Server. */
export function attachLobby(server, { path = '/lobby' } = {}) {
  const lobby = new Lobby();
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (!url.pathname.endsWith(path) || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    lobby.connect(socket);
  });
  return lobby;
}
