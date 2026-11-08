# Network races

Up to eight players race each other, each in their own browser. The original has no multiplayer (`research/game-content.md` section 5), so this is an addition of the port, in `source/net/` and `tools/lobby.mjs`.

## Playing

1. Main menu, `Internet`. The button no longer leads to the old A2 Racer site; it opens the multiplayer screens.
2. One player names a server under `Een server maken` and presses `Server maken`. That player is the host.
3. The others see the server under `Meedoen met een server` and press `Meedoen`, or type its name.
4. Everyone picks a car under `Jouw auto`; two players may pick the same car. The others press `Klaar`.
5. The host picks the etappe, laps and difficulty, and presses `Start de race` once everyone is ready.
6. All browsers load the race and wait for each other. The countdown starts at the same moment in all of them.
7. After the finish, or Esc and J, the player is back in the room, with the result list once players have finished. The host can start the next race when everyone is back.

Where the site has no lobby server, as on GitHub Pages, the list shows the servers on the same network (the same router), and a server elsewhere is joined by typing its name under `Meedoen met een server`. The host can remove a player with `Weg`. If the host leaves, the server closes. Chase etappes (Rotterdam, Wenen, Berlijn) are not offered: they have no opponents, so no places for other players.

In a network race there is no pause key, since the others drive on. The race also runs on when the window loses focus but stays visible. A hidden tab stops, as browsers stop drawing hidden pages. That player's car then stands still for the others.

## How the browsers find each other

The race and the room run in the browsers, the host's browser keeping the room: who is in, the settings, the start and the results. The browsers still need a way to reach each other. There are two, and the game picks one by itself:

| Way | When | Server list | Traffic |
|---|---|---|---|
| Lobby server, `tools/lobby.mjs` | A lobby answers on `lobby` next to the page, as with `npm start`. Or `?lobby=wss://...` | Yes | Through the lobby, which relays within a room |
| WebRTC through the public PeerJS broker | No lobby answers, as on a static site such as GitHub Pages. Or `?lobby=peer` | The servers on the same network; any other by typing its name | Directly between each member and the host's browser, which relays to the others |

**The lobby server** keeps no game state. It lists the named servers and relays messages within a room. It has no dependencies.

| Setup | Command | Players open |
|---|---|---|
| One computer, several windows | `npm start` | `http://127.0.0.1:4180/` |
| Local network | `npm start -- --lan`, or `HOST=0.0.0.0 npm start` | One of the addresses it prints |
| Static web host with a lobby | `node tools/lobby-server.mjs` next to the web server, port 4181 | The site, with `/lobby` passed on |

For Nginx, inside the `server` block next to the game's location:

```nginx
location = /a2racer4/lobby {
    proxy_pass http://127.0.0.1:4181/lobby;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
}
```

**The PeerJS broker** (`0.peerjs.com`, run by the PeerJS project, free and public) only introduces the browsers. A host registers its server name as an id, `a2racer4-mp-` and the name in lower case. A member asks the broker for that id, and the two then talk over a WebRTC data channel (`source/net/transports.js`, PeerJS 1.5.4).

The broker cannot list ids, so `LanDirectory` lists the servers on the same network. Browsers cannot broadcast on a network. Instead each browser asks a STUN server (`stun.l.google.com`) for its public address, which the machines behind one router share; for IPv6 it takes the /64 prefix. It hashes that address into a broker id, `a2racer4-lan-` and 16 hex digits. The first browser to ask for the id holds it and keeps the list. Hosts announce their server to it every 3 seconds, an entry lapses after 10 seconds, and everyone asks it for the list. When that browser closes, the next to notice takes the id. Two networks behind one carrier address (CGNAT, some mobile networks) see each other's servers. A browser that blocks WebRTC or gets no STUN answer sees no list. A server on another network is joined by typing its name. PeerJS's default STUN and TURN servers are used. A network that blocks WebRTC can still keep a player out. Every message between members passes through the host's browser, so the host's upload carries the most.

The site at `a2racer.meertens.dev` is GitHub Pages, so it uses the broker. `.github/workflows/pages.yml` builds and publishes it on every push to `main`.

## How it works

Each browser runs its own complete race: traffic, police, pickups and damage are local to that browser. Only the humans' cars are shared.

- **Places for the others.** `spel.dat` has one human and up to six AI racers. The racer table at `0x5973c0` has six rows, and `intel.ini` says "max 6". So each other human takes a racer slot. `source/net/race-files.js` changes, in memory only and restored after the race, `intel.ini` `NrOpponents`, `opponent.ini` (racers 4 and 5 and `DISTANCE56`, copies, since their AI is off), and `car_cfg.ini`. `FUN_00424660` finds a racer's row by its RefName `RACER_n`, so a slot's row takes the model, driver and damage model of the car its human chose. It also changes the HUD file `overlayN.ini`, which has five finish rows (`STRING_FINISH_POS_1..5`, read for every car in `FUN_00493a40`) and one portrait element per character. Each slot gets its own portrait element, `MP_PLAYER_n`, mapped in `game.ini [Portraits]` and put back after the race.
- **The eighth player.** A seventh other car has no racer row. `NetRace.createCar` makes it with the racers' own `FUN_0042a3d0` on grid place 8, from a `car_cfg.ini` row of its own, `MP_EXTRA`. It has no HUD portrait. The HUD position counts it through `NetRace.beforeHud`, with the game's own tie test `FUN_00412130`. The position's second number stays 7.
- **Puppets.** Each slot's per-tick handler (car record `+0x6C`, `FUN_00419600`) is swapped for a host thunk. The thunk leaves out the AI (`FUN_0040d490`, `FUN_00412570`, `FUN_0041a300`) and keeps the wheel and light visuals `FUN_00435470`. It places the car with the vehicle teleport the reset key uses (vtable `+0xC`, `FUN_004a2d70`), then writes the body and wheel speeds into the Ipion cores (`+0xA4`, `+0x94`). The physics step then carries the car on, and a collision with the local car meets a moving car. The chunk fields of the car record and the racer's chunk count (`0x5cea38`) come from the samples, so the game's own ranking and HUD position include the other humans.
- **Grid.** The room's list order is the grid. At boot every browser records where the game put its racers, and moves its own car to its own grid place, with the chunk count a racer there starts with. So every car stands in the same place in every browser.
- **Samples.** About 30 times a second each browser sends its car's position, rotation, Ipion speeds, chunk fields, chunk count, brake light and finish flag (`0x6fba98`). The others carry a sample forward by its age, at most 0.25 s, on the room's shared clock. They fade the jump to each new sample over a few ticks, and jump outright beyond 6 m.
- **Clock and start.** Members measure their offset to the host's clock by ping, keeping the fastest exchanges as NTP does. The host sends the start time 1.5 s ahead once every browser has loaded. Every browser seeds `rand` with the same value, so traffic starts the same.
- **Results.** Each browser reports its finish time on the shared clock, from the start, and the host keeps the list.

## Messages

Lobby (`tools/lobby.mjs`), JSON over WebSocket: `list` and `rooms`, `host` and `hosted`, `join` and `joined`, `peer` (to the host: join, leave), `meta` (the host's room state for the list), `kick`, `leave`, `closed`, and `to` and `from` to relay a payload to one member or to `*`.

Room (`source/net/session.js`), in the payload: `hello`, `set`, `ping`, `pong`, `room`, `start`, `loaded`, `go`, `s` (a sample), `fin`, `left`.

## Checks

| Command | What it does |
|---|---|
| `node tools/check-multiplayer.mjs --players 8 --seconds 20` | Node, no renderer. N races in one process, the bot on each car, samples passed with 4 ticks of delay. Prints each race's position and how far each puppet is from the car it stands for. About 300 MB per player |
| `node tools/check-multiplayer-browser.mjs --players 3 --seconds 30` | Headless Chromium, needs `npm start` and a fresh bundle. Hosts a named server, joins from the list, marks everyone ready, starts, lets the bots drive, leaves with Esc and J, checks the room and console errors. Writes `evidence/multiplayer/`. `--peer` goes through the PeerJS broker instead and joins from the network's list, `--byname` by typing the name |

Run on 2026-11-08 on an Apple Silicon Mac, Amsterdam:

- `check-multiplayer.mjs`, 3 players, 30 s: puppets within 0.3 m of their car. With 8 players, 20 to 25 s: within 0.5 m, positions 1 to 8 consistent across all eight races.
- `check-multiplayer-browser.mjs`, 3 pages, 20 to 30 s: all checks passed, with no console errors, both through the lobby and with `--peer` through the public PeerJS broker, by name and from the network's list. All three pages ran in one browser on one machine.
- `check-multiplayer-browser.mjs`, 8 pages: joining, the shared start, 7 puppets per page, samples, the return to the room and no console errors all passed. The position check failed twice and was fixed both times: once for the HUD adjustment counted twice in a tick, once for the tie test. After the tie fix the check passed in the 8-race Node run, but the 8-page browser run was not repeated.

Eight pages in one headless Chromium share a CPU with software WebGL, so each runs slower than real time and the pages drift apart. The puppet gaps such a run prints are not the error players would see.

Not verified: real separate machines, a real network with loss or high latency, phones, a full race to the finish with several players, the finish table with seven or eight cars, sound of the other cars, and etappes other than Amsterdam.
