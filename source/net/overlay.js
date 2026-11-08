// Over a network race: the standings of all humans and a name over each other car. The game's
// own HUD stays as it is; its position counts the other humans, who drive its racer slots.

const STANDINGS_MS = 150;
// Name tags fade out with distance, in world units (10 = 1 m).
const TAG_FAR = 2500;

function formatTime(s) {
  if (typeof s !== 'number' || !isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

export class NetOverlay {
  constructor(el) {
    this.el = el;
    this.list = document.createElement('ol');
    this.list.className = 'net-standings';
    this.tagBox = document.createElement('div');
    this.tagBox.className = 'net-tags';
    el.append(this.list, this.tagBox);
    this.tags = new Map();
  }

  start(mp, renderer) {
    this.mp = mp;
    this.renderer = renderer;
    this.last = 0;
    this.el.hidden = false;
    this.list.textContent = '';
    this.tagBox.textContent = '';
    this.tags.clear();
    for (const p of mp.net.setup.players) {
      if (p.id === mp.net.setup.me) continue;
      const tag = document.createElement('span');
      tag.className = 'net-tag';
      tag.textContent = p.nick;
      tag.hidden = true;
      this.tagBox.append(tag);
      this.tags.set(p.id, tag);
    }
  }

  stop() {
    this.mp = null;
    this.el.hidden = true;
    this.list.textContent = '';
    this.tagBox.textContent = '';
    this.tags.clear();
  }

  /** Finished first by time, then by chunks driven, then by grid. */
  standings() {
    const { net, session } = this.mp;
    const room = session.room;
    const info = new Map((room ? room.players : []).map((p) => [p.id, p]));
    const rows = net.setup.players.map((p) => {
      const mine = p.id === net.setup.me;
      const puppet = net.puppets.get(p.id);
      const r = info.get(p.id);
      const progress = mine ? net.progress : puppet && puppet.sample ? puppet.sample.d : net.nrOpp - p.grid;
      const gone = !mine && (!r || (puppet && puppet.gone));
      return { id: p.id, nick: p.nick, mine, progress, grid: p.grid, finished: Boolean(r && r.finished), time: r ? r.time : null, gone };
    });
    rows.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.time - b.time;
      if (a.gone !== b.gone) return a.gone ? 1 : -1;
      return b.progress - a.progress || a.grid - b.grid;
    });
    return rows;
  }

  frame(now) {
    if (!this.mp) return;
    if (now - this.last > STANDINGS_MS) {
      this.last = now;
      const rows = this.standings();
      const items = rows.map((r, k) => {
        const li = document.createElement('li');
        li.className = (r.mine ? 'mine ' : '') + (r.gone ? 'gone' : '');
        const pos = document.createElement('b');
        pos.textContent = String(k + 1);
        const name = document.createElement('span');
        name.textContent = r.nick;
        li.append(pos, name);
        if (r.finished) {
          const t = document.createElement('i');
          t.textContent = formatTime(r.time);
          li.append(t);
        }
        return li;
      });
      this.list.replaceChildren(...items);
    }
    this.placeTags();
  }

  placeTags() {
    const { net } = this.mp;
    const r = this.renderer;
    if (!r || !r.area || !r.xr) return;
    const dpr = window.devicePixelRatio || 1;
    const seen = new Set();
    for (const t of net.tags()) {
      const tag = this.tags.get(t.id);
      if (!tag) continue;
      const nx = t.x / r.xr;
      const ny = t.y / r.yr;
      if (nx < -1.1 || nx > 1.1 || ny < -1.1 || ny > 1.1 || t.dist > TAG_FAR) continue;
      seen.add(t.id);
      const x = (r.area.x + ((nx + 1) / 2) * r.area.w) / dpr;
      const y = (r.area.y + ((1 - ny) / 2) * r.area.h) / dpr;
      tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      tag.style.opacity = String(Math.max(0.35, 1 - t.dist / TAG_FAR));
      tag.hidden = false;
    }
    for (const [id, tag] of this.tags) if (!seen.has(id)) tag.hidden = true;
  }
}
