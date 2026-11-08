#!/usr/bin/env node
// The lobby on its own, for a static host: the game's files come from the web server, and the
// web server passes /lobby on to this. docs/multiplayer.md has an Nginx example.
//   node tools/lobby-server.mjs  (PORT, default 4181; HOST, default 127.0.0.1)
import { createServer } from 'node:http';
import { attachLobby } from './lobby.mjs';

const server = createServer((req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('A2 Racer 4 lobby: connect with a WebSocket\n');
});
attachLobby(server, { path: '/lobby' });
const port = Number(process.env.PORT || 4181);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`lobby on ws://${host}:${server.address().port}/lobby`));
