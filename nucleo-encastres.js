// Encastres en caras planas de contacto (de Cortador STL).
// Busca caras planas coincidentes y opuestas entre dos piezas (las tapas de un
// corte por plano o de una tapa plana) y coloca:
//  - «macho»: un pin pegado a una pieza y el agujero en la otra (la más gruesa);
//  - «pasadores»: un agujero en cada pieza y pasadores sueltos que se imprimen aparte.
// El punto elegido es el más alejado del borde de la cara común; con 2 por unión
// se buscan dos puntos separados. Si no cabe con la pared mínima, no se pone.
import earcut from './earcut.js?v=2.10';

const Q = 1e4;
const vkey = (p, o) => Math.round(p[o] * Q) + ',' + Math.round(p[o + 1] * Q) + ',' + Math.round(p[o + 2] * Q);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const pushTri = (arr, a, b, c) => arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
const pushOriented = (arr, a, b, c, dir) => (dot(cross(sub(b, a), sub(c, a)), dir) < 0 ? pushTri(arr, a, c, b) : pushTri(arr, a, b, c));
const area2 = p2 => { let a = 0; for (let i = 0, n = p2.length; i < n; i++) { const p = p2[i], q = p2[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function inPoly(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

function chainLoops(segs) {
  const adj = new Map();
  for (const [a, b] of segs) { let l = adj.get(a); if (!l) { l = []; adj.set(a, l); } l.push(b); }
  const loops = [];
  for (const st of adj.keys()) while (adj.get(st).length) {
    const loop = [st]; let cur = st, closed = false;
    for (let g = 0; g < 5e6; g++) { const ends = adj.get(cur); if (!ends || !ends.length) break; const nx = ends.pop(); if (nx === st) { closed = true; break; } loop.push(nx); cur = nx; }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}
function nest(L) {
  L = L.filter(l => Math.abs(l.area) > 1e-9).sort((x, y) => Math.abs(y.area) - Math.abs(x.area));
  L.forEach((l, i) => { l.depth = 0; l.parent = -1; l.holes = []; for (let j = 0; j < i; j++) if (inPoly(l.p2[0], L[j].p2)) { l.depth++; l.parent = j; } });
  L.forEach(l => { if (l.depth % 2 === 1 && l.parent >= 0) L[l.parent].holes.push(l); });
  return L.filter(l => l.depth % 2 === 0);
}
function fillPoly(outer, holes, dir, out) {
  const datos = [], inicios = [], all3 = outer.p3.slice();
  for (const p of outer.p2) datos.push(p[0], p[1]);
  for (const h of holes) { inicios.push(datos.length / 2); for (const p of h.p2) datos.push(p[0], p[1]); for (const p of h.p3) all3.push(p); }
  const idx = earcut(datos, inicios.length ? inicios : null, 2);
  if (!idx.length) return false;
  for (let i = 0; i < idx.length; i += 3) pushOriented(out, all3[idx[i]], all3[idx[i + 1]], all3[idx[i + 2]], dir);
  return true;
}
function lathe(prof, seg, cx = 0, cy = 0) {
  const out = [], P = (r, z, j) => { const a = (j / seg) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a), z]; };
  for (let i = 0; i < prof.length - 1; i++) {
    const [r0, z0] = prof[i], [r1, z1] = prof[i + 1];
    for (let j = 0; j < seg; j++) { const A = P(r0, z0, j), B = P(r0, z0, j + 1), C = P(r1, z1, j + 1), D = P(r1, z1, j); if (r0 > 0) pushTri(out, A, B, C); if (r1 > 0) pushTri(out, A, C, D); }
  }
  return out;
}

function planarGroups(pos) {
  const g = new Map();
  for (let t = 0, o = 0; o < pos.length; o += 9, t++) {
    const n = cross([pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2]], [pos[o + 6] - pos[o], pos[o + 7] - pos[o + 1], pos[o + 8] - pos[o + 2]]);
    const l = Math.hypot(n[0], n[1], n[2]); if (l < 1e-6) continue;
    const u = [n[0] / l, n[1] / l, n[2] / l];
    for (let j = 0; j < 3; j++) if (Math.abs(u[j]) < 2e-4) u[j] = 0;
    const s = (u[0] !== 0 ? u[0] : u[1] !== 0 ? u[1] : u[2]) > 0 ? 1 : -1, cn = [u[0] * s, u[1] * s, u[2] * s], d = dot(cn, [pos[o], pos[o + 1], pos[o + 2]]);
    const key = ((Math.round(cn[0] * 800) + 800) * 1601 + (Math.round(cn[1] * 800) + 800)) * 1601 * 1e6 + (Math.round(cn[2] * 800) + 800) * 1e6 + (Math.round(d * 20) + 500000);
    let e = g.get(key); if (!e) { e = { cn, d, area: { 1: 0, '-1': 0 }, tris: { 1: [], '-1': [] } }; g.set(key, e); }
    e.tris[s].push(t); e.area[s] += l / 2;
  }
  return g;
}
function regionInfo(pos, tris, m, dPl) {
  const kp = new Map(), edges = new Set(), segs = [];
  for (const t of tris) {
    const ks = [0, 1, 2].map(j => { const o = t * 9 + j * 3, k = vkey(pos, o); if (!kp.has(k)) kp.set(k, [pos[o], pos[o + 1], pos[o + 2]]); return k; });
    for (let j = 0; j < 3; j++) edges.add(ks[j] + '>' + ks[(j + 1) % 3]);
  }
  for (const e of edges) { const [a, b] = e.split('>'); if (!edges.has(b + '>' + a)) segs.push([a, b]); }
  const loops = chainLoops(segs), ref = Math.abs(m[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = nrm(cross(m, ref)), v = cross(m, u);
  const L = loops.map(l => { const p3 = l.map(k => kp.get(k)), p2 = p3.map(p => [dot(p, u), dot(p, v)]); return { p3, p2, area: area2(p2) }; });
  return { L, u, v, m, d: dPl };
}
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function edgeDist(p, L) { let m = Infinity; for (const l of L) { const q = l.p2; for (let i = 0; i < q.length; i++) { const d = segDist(p, q[i], q[(i + 1) % q.length]); if (d < m) m = d; } } return m; }
function insideL(p, L) { let c = false; for (const l of L) if (inPoly(p, l.p2)) c = !c; return c; }
function rayDepth(pos, o, dir) {
  let best = Infinity;
  for (let i = 0; i < pos.length; i += 9) {
    const e1 = [pos[i + 3] - pos[i], pos[i + 4] - pos[i + 1], pos[i + 5] - pos[i + 2]], e2 = [pos[i + 6] - pos[i], pos[i + 7] - pos[i + 1], pos[i + 8] - pos[i + 2]];
    const p = cross(dir, e2), det = dot(e1, p); if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, tv = [o[0] - pos[i], o[1] - pos[i + 1], o[2] - pos[i + 2]], uu = dot(tv, p) * inv; if (uu < 0 || uu > 1) continue;
    const q = cross(tv, e1), vv = dot(dir, q) * inv; if (vv < 0 || uu + vv > 1) continue;
    const t = dot(e2, q) * inv; if (t > 1e-3 && t < best) best = t;
  }
  return best;
}
function thickness(pos, c, dir, r, R) { let m = rayDepth(pos, c, dir); for (const s of [[r, 0], [-r, 0], [0, r], [0, -r]]) m = Math.min(m, rayDepth(pos, add(add(c, R.u, s[0]), R.v, s[1]), dir)); return m; }

// piezas: [{sopa: Float32Array, col: Int16Array}] (posiciones reales, sin separar).
// J: {tipo:'macho'|'pasadores', d, profundidad, holgura, porUnion, pared}
export function anadirEncastres(piezas, J, { xPasadores = 0, yPasadores = 0 } = {}) {
  const WALL = J.pared, rp = (J.d + J.holgura) / 2, need = rp + WALL, minA = Math.PI * need * need;
  const groups = piezas.map(p => planarGroups(p.sopa)), ops = piezas.map(() => new Map()), pins = [];
  let skipped = 0, joins = 0;
  const getOp = (i, key, s) => {
    const id = key + '#' + s; let op = ops[i].get(id);
    if (!op) { const g = groups[i].get(key), m = [g.cn[0] * s, g.cn[1] * s, g.cn[2] * s]; op = { tris: g.tris[s], info: regionInfo(piezas[i].sopa, g.tris[s], m, g.d * s), holes: [] }; ops[i].set(id, op); }
    return op;
  };
  for (let i = 0; i < piezas.length; i++) for (const [key, g] of groups[i]) {
    if (g.area[1] < minA) continue;
    for (let j = 0; j < piezas.length; j++) {
      if (j === i) continue;
      const hh = groups[j].get(key); if (!hh || hh.area[-1] < minA) continue;
      const A = getOp(i, key, 1), B = getOp(j, key, -1), RA = A.info, LA = RA.L, LB = B.info.L.map(l => ({ p2: l.p3.map(p => [dot(p, RA.u), dot(p, RA.v)]) }));
      let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
      for (const l of LA) for (const p of l.p2) { mn = [Math.min(mn[0], p[0]), Math.min(mn[1], p[1])]; mx = [Math.max(mx[0], p[0]), Math.max(mx[1], p[1])]; }
      const step = Math.max(0.4, Math.max(mx[0] - mn[0], mx[1] - mn[1]) / 48), cand = []; let overlap = 0;
      for (let x = mn[0] + step / 2; x < mx[0]; x += step) for (let y = mn[1] + step / 2; y < mx[1]; y += step) {
        const p = [x, y]; if (!insideL(p, LA) || !insideL(p, LB)) continue; overlap++;
        const dd = Math.min(edgeDist(p, LA), edgeDist(p, LB));
        if (dd >= need && !A.holes.some(h => Math.hypot(h.c2[0] - x, h.c2[1] - y) < h.r + rp + WALL)) cand.push({ p, dd });
      }
      if (overlap * step * step < minA) continue;
      if (!cand.length) { skipped++; continue; }
      cand.sort((a, b) => b.dd - a.dd);
      let chosen = [cand[0]];
      if (J.porUnion === 2) {
        const top = cand.slice(0, 500); let best = null, bs = 0;
        for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) { const dd = Math.hypot(top[a].p[0] - top[b].p[0], top[a].p[1] - top[b].p[1]); if (dd < 2 * need) continue; const sc = Math.min(top[a].dd, top[b].dd) + dd * 0.5; if (sc > bs) { bs = sc; best = [top[a], top[b]]; } }
        if (best) chosen = best;
      }
      let placed = 0;
      for (const c of chosen) {
        const c3 = add(add(RA.m.map(x => x * RA.d), RA.u, c.p[0]), RA.v, c.p[1]);
        const ti = thickness(piezas[i].sopa, c3, RA.m.map(x => -x), rp, RA), tj = thickness(piezas[j].sopa, c3, RA.m, rp, RA), toB = p => [dot(p, B.info.u), dot(p, B.info.v)];
        if (J.tipo === 'pasadores') {
          const hi = Math.min(J.profundidad, ti - WALL), hj = Math.min(J.profundidad, tj - WALL); if (hi < 2 || hj < 2) continue;
          A.holes.push({ c2: c.p, c3, r: rp, h: hi, kind: 'pocket' }); B.holes.push({ c2: toB(c3), c3, r: rp, h: hj, kind: 'pocket' }); pins.push({ r: J.d / 2, L: hi + hj - 0.6 }); placed++;
        } else {
          const femA = ti >= tj, hf = Math.min(J.profundidad, (femA ? ti : tj) - WALL), hb = hf - 0.5; if (hb < 2) continue;
          const Fm = femA ? A : B, Mo = femA ? B : A, tf = p => (Fm === A ? c.p : toB(p)), tm = p => (Mo === A ? c.p : toB(p));
          Fm.holes.push({ c2: tf(c3), c3, r: rp, h: hf, kind: 'pocket' }); Mo.holes.push({ c2: tm(c3), c3, r: J.d / 2, h: hb, kind: 'boss' }); placed++;
        }
      }
      if (placed) joins++; else skipped++;
    }
  }
  const salida = piezas.map((pc, i) => {
    const mods = [...ops[i].values()].filter(o => o.holes.length); if (!mods.length) return { ...pc, cambiada: false };
    const rm = new Set(); mods.forEach(o => o.tris.forEach(t => rm.add(t)));
    const P = [], C = [], pos = pc.sopa;
    for (let t = 0; t < pos.length / 9; t++) { if (rm.has(t)) continue; for (let j = 0; j < 9; j++) P.push(pos[t * 9 + j]); C.push(pc.col[t]); }
    for (const op of mods) {
      const R = op.info, m = R.m, cc = pc.col[op.tris[0]], n0 = P.length;
      const circ = op.holes.map(h => { const p2 = [], p3 = [], seg = 28; for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2, q = [h.c2[0] + h.r * Math.cos(a), h.c2[1] + h.r * Math.sin(a)]; p2.push(q); p3.push(add(add(m.map(x => x * R.d), R.u, q[0]), R.v, q[1])); } return { p2, p3, area: area2(p2), h }; });
      const outers = nest(R.L.map(l => ({ p2: l.p2, p3: l.p3, area: l.area })));
      for (const ou of outers) { const mine = circ.filter(c => inPoly(c.h.c2, ou.p2) && !ou.holes.some(hh => inPoly(c.h.c2, hh.p2))); fillPoly(ou, ou.holes.concat(mine), m, P); }
      for (const c of circ) {
        const h = c.h, n = c.p3.length, dir = h.kind === 'pocket' ? -1 : 1, center = add(add(m.map(x => x * R.d), R.u, h.c2[0]), R.v, h.c2[1]);
        const end = c.p3.map(p => add(p, m, dir * h.h)), ce = add(center, m, dir * h.h);
        for (let s = 0; s < n; s++) {
          const a = c.p3[s], b = c.p3[(s + 1) % n], a2 = end[s], b2 = end[(s + 1) % n], radial = nrm(sub(a, center)), wdir = h.kind === 'pocket' ? radial.map(x => -x) : radial;
          pushOriented(P, a, b, b2, wdir); pushOriented(P, a, b2, a2, wdir); pushOriented(P, ce, a2, b2, m);
        }
      }
      for (let q = n0; q < P.length; q += 9) C.push(cc);
    }
    return { sopa: new Float32Array(P), col: Int16Array.from(C), cambiada: true };
  });
  let pasadores = null;
  if (pins.length) {
    const P = [];
    pins.forEach((p, i) => { const r = p.r, L = p.L, ch = Math.min(0.4, r * 0.2), x = xPasadores + (i % 6) * (J.d + 5), y = yPasadores + Math.floor(i / 6) * (J.d + 5); for (const v of lathe([[0, 0], [r - ch, 0], [r, ch], [r, L - ch], [r - ch, L], [0, L]], 28, x, y)) P.push(v); });
    pasadores = { sopa: new Float32Array(P), cantidad: pins.length, largos: pins.map(p => p.L) };
  }
  return { piezas: salida, pasadores, uniones: joins, sinEspacio: skipped };
}
