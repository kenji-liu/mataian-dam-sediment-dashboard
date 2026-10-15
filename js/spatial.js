window.msGeo = (rows) => {
  const m = new Map();
  rows.forEach(r => { if (!m.has(r.zone)) m.set(r.zone, { zone: r.zone, name: r.name, pts: [] }); m.get(r.zone).pts.push({ i: Number(r.i), x: Number(r.x), y: Number(r.y) }); });
  return Array.from(m.values()).map(g => ({ zone: g.zone, name: g.name, coords: g.pts.sort((a, b) => a.i - b.i).map(p => [p.x, p.y]) }));
};
dash.calc('heat', {
  inputs: ['periods'], title: '分區分期沖淤速率',
  description: '每區每期的淨變化（以 DEM 差分直接計算的累積量逐期相減）除以天數再乘 30，萬 m³/月。',
  fn: (periods) => {
    const Z = { A: 'A 崩積區', B: 'B 殘壩區', C: 'C 治理界點以上河道', D: 'D 界點下游河床' };
    return periods.flatMap(p => Object.keys(Z).map(k => ({ zone: Z[k], period: p.period, net: Number(p[k]), per_month: Math.round(Number(p[k]) / Number(p.days) * 30 * 10) / 10 })));
  }
});
dash.calc('sankey', {
  inputs: ['zones'], title: '土砂來源與去向',
  description: 'A、B 區的淨流失匯成合計流失，再分成留在 C 區河道、留在 D 區界點下游河床，以及流出治理範圍的部分（萬 m³，2025/9/25→2026/9/14）。',
  fn: (zones) => {
    const g = k => Number(zones.find(z => z.zone.startsWith(k)).dem_since_breach);
    const a = -g('A'), b = -g('B'), c = g('C'), d = g('D'), tot = a + b;
    return [
      { source: 'A 崩積區', target: '合計流失', value: a },
      { source: 'B 殘壩區', target: '合計流失', value: b },
      { source: '合計流失', target: 'C 河道', value: c },
      { source: '合計流失', target: 'D 界點下游', value: d },
      { source: '合計流失', target: '流出治理範圍', value: tot - c - d }
    ];
  }
});
dash.calc('tmtable', {
  inputs: ['treemap', 'periods'], title: '沖蝕與淤積分區分期表',
  description: '每區每個時段的沖蝕量、淤積量與合計（萬 m³，只計 |Δz| > 1 m 的格點），以及三期淨變化加總（不設門檻）。',
  fn: (treemap, periods) => {
    const P = ['250925→251013', '251013→260314', '260314→260914'];
    return ['A 崩積區', 'B 殘壩區', 'C 治理界點以上河道', 'D 界點下游河床'].map(zone => {
      const g = (kind, p) => treemap.filter(r => r.zone === zone && r.kind === kind && r.period === p).reduce((a, r) => a + Number(r.volume), 0);
      const row = { zone };
      P.forEach((p, i) => { row['e' + (i + 1)] = g('沖蝕', p); row['d' + (i + 1)] = g('淤積', p); });
      row.et = row.e1 + row.e2 + row.e3; row.dt = row.d1 + row.d2 + row.d3; row.net = periods.reduce((a, p) => a + Number(p[zone.charAt(0)]), 0);
      return row;
    });
  }
});
dash.calc('venn_tbl', {
  inputs: ['venn'], title: '變動面積分組表',
  description: '依在哪些時段發生變動分組的面積（公頃）與占變動總面積的比例。',
  fn: (venn) => {
    const tot = venn.reduce((a, r) => a + Number(r.area_ha), 0);
    const names = ['2025/9/25–10/13', '2025/10/13–2026/3/14', '2026/3/14–9/14'];
    return venn.map(r => {
      const on = [r.in_p1, r.in_p2, r.in_p3].map((v, i) => v ? names[i] : null).filter(Boolean);
      const label = on.length === 3 ? '三個時段都有（持續活動）' : on.length === 1 ? '只有 ' + on[0] : on.join(' ＋ ');
      return { label, code: (r.in_p1 ? 1 : 0) + (r.in_p2 ? 2 : 0) + (r.in_p3 ? 4 : 0), area_ha: Number(r.area_ha), share: Math.round(Number(r.area_ha) / tot * 1000) / 10, n: on.length };
    }).sort((a, b) => b.n - a.n || b.area_ha - a.area_ha);
  }
});

dash.calc('funnel', {
  inputs: ['zones'], title: '土砂傳輸漏斗',
  description: 'A+B 流失的土砂，依序扣掉留在 C 河道、留在 D 界點下游河床的量，剩下流出治理範圍的量（萬 m³）。',
  fn: (zones) => {
    const g = k => Number(zones.find(z => z.zone.startsWith(k)).dem_since_breach);
    const tot = -(g('A') + g('B')), c = g('C'), d = g('D');
    return [
      { step: '① A、B 兩區流失', value: tot, lost: 0, lost_label: '' },
      { step: '② 過了 C 河道', value: tot - c, lost: c, lost_label: '留在 C 河道' },
      { step: '③ 過了 D 河床', value: tot - c - d, lost: d, lost_label: '留在 D 河床' }
    ];
  }
});

(function () {
  const fmt = d3.format(',');
  const sgn = v => (v > 0 ? '+' : '') + fmt(v);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DUR = reduce ? 0 : 700;
  const probe = document.createElement('span'); probe.style.display = 'none'; document.getElementById('spatial').appendChild(probe);
  function rgb(v, fb) { probe.style.color = ''; probe.style.color = v; const c = d3.color(getComputedStyle(probe).color); return c ? c.formatRgb() : fb; }
  const PNAME = { p1: '250925→251013', p2: '251013→260314', p3: '260314→260914' };
  const PLAB = { tot: '2025/9/25–2026/9/14 全期', p1: '2025/9/25–10/13', p2: '2025/10/13–2026/3/14', p3: '2026/3/14–9/14' };
  const PFULL = { '250925→251013': '2025/9/25–10/13', '251013→260314': '2025/10/13–2026/3/14', '260314→260914': '2026/3/14–9/14' };
  const ZK = { 'A 崩積區': 'A', 'B 殘壩區': 'B', 'C 治理界點以上河道': 'C', 'D 界點下游河床': 'D' };
  const state = { p: 'tot', zone: null, drawn: {} };
  const PC = { 1: '#ff4d4f', 2: '#2fd07f', 4: '#3b9cff', 3: '#ffd23f', 5: '#c77dff', 6: '#19d3da', 7: '#ff2bd6' };
  let persistHi = null;
  const PN = ['2025/9/25–10/13', '2025/10/13–2026/3/14', '2026/3/14–9/14'];
  const codeName = c => [1, 2, 4].filter(b => c & b).map(b => PN[Math.log2(b)]).join(' ＋ ');
  function zoneColor(k) { return { A: dash.colors[3], B: rgb('var(--cds-chart-status-critical)', '#c0392b'), C: dash.colors[0], D: dash.colors[2] }[k]; }
  function ramp() {
    const neg = rgb('var(--cds-chart-status-critical)', 'rgb(192,57,43)'), pos = rgb(dash.colors[0], 'rgb(46,111,216)'), mid = rgb('var(--color-panel)', 'rgb(245,245,245)');
    return v => v < 0 ? d3.interpolateRgb(mid, neg)(Math.min(1, -v)) : d3.interpolateRgb(mid, pos)(Math.min(1, v));
  }

  // tooltip per box
  function tipFor(box) {
    let t = box.querySelector('.ms-tip'); if (!t) { t = document.createElement('div'); t.className = 'ms-tip'; box.appendChild(t); }
    return {
      show(ev, lines) {
        t.replaceChildren(); lines.forEach(([cls, txt, col]) => { const d = document.createElement('div'); if (cls) d.className = cls; if (col) { const s = document.createElement('span'); s.className = 'sw'; s.style.background = col; d.appendChild(s); } d.appendChild(document.createTextNode(txt)); t.appendChild(d); });
        t.style.opacity = 1; const r = box.getBoundingClientRect(); const tw = t.offsetWidth, th = t.offsetHeight;
        let x = ev.clientX - r.left + 12, y = ev.clientY - r.top - th - 8; if (x + tw > r.width) x = ev.clientX - r.left - tw - 12; if (x < 0) x = 0; if (y < 0) y = ev.clientY - r.top + 14;
        t.style.left = x + 'px'; t.style.top = y + 'px';
      },
      hide() { t.style.opacity = 0; }
    };
  }
  function failed(box) { d3.select(box).selectAll('svg,canvas,.ms-fail').remove(); box.classList.remove('dash-skeleton'); const f = document.createElement('div'); f.className = 'ms-fail'; f.textContent = 'Failed to load'; box.appendChild(f); }
  const seenIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.__seen = true; seenIO.unobserve(e.target); redrawAll(); } }), { root: document, rootMargin: '0px 0px -6% 0px' });
  function ready(box, ids) {
    const st = ids.map(i => dash.data(i).status);
    if (st.includes('error')) { failed(box); return false; }
    if (!st.every(s => s === 'ok')) { box.classList.add('dash-skeleton'); return false; }
    if (!box.__seen) { if (!box.__obs) { box.__obs = true; seenIO.observe(box); } box.classList.add('dash-skeleton'); return false; }
    box.classList.remove('dash-skeleton'); d3.select(box).selectAll('.ms-fail').remove(); return true;
  }
  function svgIn(box, H) { d3.select(box).selectAll('svg').remove(); const W = Math.max(260, box.clientWidth); const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`); return { svg, W }; }
  function anim(key) { const first = !state.drawn[key]; state.drawn[key] = true; return first ? DUR : 0; }
  const cap = sel => sel.attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--ms-fs-chart)');

  // ---------- MAP ----------
  let grid = null, satImg = null, satReady = false;
  function drawMap() {
    const box = document.getElementById('map'); if (!ready(box, ['mapgrid', 'geo'])) return;
    const rows = dash.data('mapgrid').data, geo = window.msGeo(dash.data('geo').data);
    const X0 = 277500, Y1 = 2625700, CW = 290, CH = 138;
    if (!grid) { grid = new Array(CW * CH); rows.forEach(r => { const c = Math.round((r.x - X0 - 25) / 50), rr = Math.round((Y1 - r.y - 25) / 50); if (c >= 0 && c < CW && rr >= 0 && rr < CH) grid[rr * CW + c] = r; }); }
    const W = Math.max(260, box.clientWidth), H = Math.round(W * CH / CW);
    let cv = box.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); box.prepend(cv); }
    const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; box.style.minHeight = H + 'px';
    const off = document.createElement('canvas'); off.width = CW; off.height = CH; const oc = off.getContext('2d'); const img = oc.createImageData(CW, CH);
    const col = ramp(); const p = state.p;
    const sat = dash.data('satellite');
    if (sat.status === 'ok' && !satImg) { satImg = new Image(); satImg.onload = () => { satReady = true; drawMap(); }; satImg.src = sat.data[0].data_url; }
    for (let i = 0; i < CW * CH; i++) {
      const r = grid[i]; if (!r) continue;
      const g = 55 + 190 * r.hs; let R = g, G = g, B = g, A = satReady ? 0 : 255;
      const v = r[p];
      if (v != null && Math.abs(v) >= 3) {
        const c = d3.color(col(Math.max(-1, Math.min(1, v / 30)))); const a = Math.min(.92, .35 + Math.abs(v) / 30 * .6);
        if (satReady) { R = c.r; G = c.g; B = c.b; A = Math.round(255 * Math.min(.92, .5 + Math.abs(v) / 30 * .45)); } else { R = R * (1 - a) + c.r * a; G = G * (1 - a) + c.g * a; B = B * (1 - a) + c.b * a; }
      }
      img.data.set([R, G, B, A], i * 4);
    }
    oc.putImageData(img, 0, 0);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = true; ctx.clearRect(0, 0, W, H); if (satReady) ctx.drawImage(satImg, 150, 180, 1450, 690, 0, 0, W, H); ctx.drawImage(off, 0, 0, W, H);
    // overlays
    d3.select(box).selectAll('svg').remove();
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H);
    const sx = x => (x - X0) / (CW * 50) * W, sy = y => (Y1 - y) / (CH * 50) * H;
    const line = d3.line().x(d => sx(d[0])).y(d => sy(d[1]));
    const path = geo.find(g => g.zone === 'path');
    if (path) svg.append('path').attr('d', line(path.coords)).attr('fill', 'none').attr('stroke', '#fff').attr('stroke-opacity', .7).attr('stroke-width', 1.2).attr('stroke-dasharray', '3 3');
    geo.filter(g => g.zone !== 'path').forEach(g => {
      const on = state.zone === g.zone;
      svg.append('path').attr('d', line(g.coords) + 'Z').attr('fill', on ? zoneColor(g.zone) : 'none').attr('fill-opacity', on ? .12 : 0).attr('stroke', zoneColor(g.zone)).attr('stroke-width', on ? 4.5 : 2.8);
      const cx = d3.mean(g.coords, d => sx(d[0])), cy = d3.min(g.coords, d => sy(d[1]));
      svg.append('text').attr('x', cx).attr('y', Math.max(14, cy - 4)).attr('text-anchor', 'middle').attr('fill', zoneColor(g.zone)).attr('stroke', 'rgba(0,0,0,.55)').attr('stroke-width', 3).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(g.zone);
    });
    // scale bar 2 km
    const km2 = 2000 / (CW * 50) * W;
    const sb = svg.append('g').attr('transform', `translate(12,${H - 16})`);
    sb.append('rect').attr('width', km2).attr('height', 5).attr('fill', '#fff').attr('stroke', '#000').attr('stroke-width', .6);
    sb.append('text').attr('y', -5).attr('fill', '#fff').attr('stroke', 'rgba(0,0,0,.6)').attr('stroke-width', 3).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart)').text('0　　　2 km');
    svg.append('text').attr('x', W - 14).attr('y', 22).attr('text-anchor', 'middle').attr('fill', '#fff').attr('stroke', 'rgba(0,0,0,.6)').attr('stroke-width', 3).attr('paint-order', 'stroke').style('font-weight', 700).text('N ↑');
    // zone legend
    const zl = document.getElementById('map-zone-legend'); zl.replaceChildren();
    [['A', '崩積區'], ['B', '殘壩區'], ['C', '河道'], ['D', '界點下游']].forEach(([k, n]) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.cssText = `display:inline-block;width:.8rem;height:.2rem;margin-right:.3rem;vertical-align:middle;background:${zoneColor(k)}`; s.append(i, document.createTextNode(`${k} ${n}`)); zl.appendChild(s); });
    // tooltip
    const tp = tipFor(box);
    cv.onmousemove = ev => {
      const r0 = cv.getBoundingClientRect(); const c = Math.floor((ev.clientX - r0.left) / r0.width * CW), rr = Math.floor((ev.clientY - r0.top) / r0.height * CH);
      const r = grid[rr * CW + c]; if (!r) { tp.hide(); return; }
      const lines = [['t', `TWD97 ${fmt(r.x)}, ${fmt(r.y)}${r.zone ? '　' + r.zone + ' 區' : ''}`], [null, `2026/9 高程 ${fmt(r.z)} m`]];
      ['tot', 'p1', 'p2', 'p3'].forEach(k => { if (r[k] != null) lines.push([null, `${PLAB[k]}　${(r[k] > 0 ? '+' : '') + d3.format('.1f')(r[k])} m`, k === state.p ? (r[k] < 0 ? zoneColor('B') : dash.colors[0]) : null]); });
      tp.show(ev, lines);
    };
    cv.onmouseleave = () => tp.hide();
    document.getElementById('map-note').textContent = `${PLAB[state.p]}：50 m 網格平均高程變化（只顯示 |Δz| ≥ 3 m 的格子），底圖為衛星影像${state.zone ? `；標示 ${state.zone} 區` : ''}`;
  }
  function setPeriod(p, zone) {
    state.p = p; if (zone !== undefined) state.zone = zone;
    document.querySelectorAll('#map-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === p)));
    drawMap(); drawHeat();
  }
  document.querySelectorAll('#map-seg button').forEach(b => b.addEventListener('click', () => setPeriod(b.dataset.p, null)));
  (function drawRamp() { const c = document.getElementById('ramp'); const x = c.getContext('2d'); const col = ramp(); for (let i = 0; i < 180; i++) { x.fillStyle = col(i / 89.5 - 1); x.fillRect(i, 0, 1, 12); } })();

  // ---------- HEAT ----------
  function drawHeat() {
    const box = document.getElementById('heat'); if (!ready(box, ['heat'])) return;
    const rows = dash.data('heat').data;
    const zones = Object.keys(ZK), periods = Object.values(PNAME);
    const { svg, W } = svgIn(box, 396);
    const ml = 150, mt = 60, H = 396;
    const x = d3.scaleBand(periods, [ml, W - 6]).padding(.06), y = d3.scaleBand(zones, [mt, H - 8]).padding(.06);
    const mx = d3.max(rows, r => Math.abs(r.per_month)); const col = ramp();
    const scale = v => col(Math.sign(v) * Math.sqrt(Math.abs(v) / mx));
    periods.forEach(p => { const k = Object.keys(PNAME).find(q => PNAME[q] === p); const HL = { p1: ['2025/9/25–', '10/13'], p2: ['2025/10/13–', '2026/3/14'], p3: ['2026/3/14–', '9/14'] }[k]; HL.forEach((ln, i) => cap(svg.append('text').attr('x', x(p) + x.bandwidth() / 2).attr('y', mt - 30 + i * 18).attr('text-anchor', 'middle')).text(ln).style('font-weight', 800)); });
    zones.forEach(z => svg.append('text').attr('x', ml - 8).attr('y', y(z) + y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart)').text(z));
    const tp = tipFor(box); const d = anim('heat');
    rows.forEach((r, i) => {
      const k = Object.keys(PNAME).find(q => PNAME[q] === r.period), on = state.p === k && state.zone === ZK[r.zone];
      const g = svg.append('g').style('cursor', 'pointer');
      g.append('rect').attr('x', x(r.period)).attr('y', y(r.zone)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('rx', 4).attr('fill', scale(r.per_month)).attr('stroke', on ? 'var(--color-fg)' : 'none').attr('stroke-width', 2).attr('opacity', d ? 0 : 1).transition().delay(i * 40).duration(d).attr('opacity', 1);
      const strong = Math.abs(r.per_month) / mx > .35;
      g.append('text').attr('x', x(r.period) + x.bandwidth() / 2).attr('y', y(r.zone) + y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'middle').attr('fill', strong ? '#fff' : 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart)').style('font-variant-numeric', 'tabular-nums').style('font-weight', 800).style('font-size', 'var(--ms-fs-chart-lg)').text(sgn(Math.round(r.per_month)));
      g.on('mousemove', ev => tp.show(ev, [['t', `${r.zone}｜${PLAB[k]}`], [null, `${sgn(r.per_month)} 萬 m³/月`], [null, `期間淨變化 ${sgn(r.net)} 萬 m³`]])).on('mouseleave', tp.hide)
        .on('click', () => { setPeriod(k, ZK[r.zone]); document.getElementById('map-card').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); });
    });
  }

  // ---------- RADAR ----------
  function drawRadar() {
    const box = document.getElementById('radar'); if (!ready(box, ['radar'])) return;
    const rows = dash.data('radar').data;
    const axes = [['erosion', '被沖走的量', '萬 m³', '被沖走的土方'], ['deposition', '堆起來的量', '萬 m³', '堆起來的土方'], ['active_pct', '變動的面積比例', '%', '地面變動超過 1 m 的面積比例'], ['mean_abs_dz', '平均變動高度', 'm', '每一格平均上下變動'], ['p02_lowering', '下降最多處', 'm', '下降最劇烈的 2% 格子，至少降了'], ['p98_raising', '抬升最多處', 'm', '抬升最劇烈的 2% 格子，至少升了']];
    const H = 430; const { svg, W } = svgIn(box, H);
    const R = Math.min(W / 2 - 92, H / 2 - 56), cx = W / 2, cy = H / 2 - 10;
    const mx = Object.fromEntries(axes.map(([k]) => [k, d3.max(rows, r => Number(r[k]))]));
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / axes.length;
    [.25, .5, .75, 1].forEach(f => svg.append('polygon').attr('points', axes.map((_, i) => [cx + Math.cos(ang(i)) * R * f, cy + Math.sin(ang(i)) * R * f].join(',')).join(' ')).attr('fill', 'none').attr('stroke', 'var(--cds-chart-grid)'));
    axes.forEach(([, n], i) => { svg.append('line').attr('x1', cx).attr('y1', cy).attr('x2', cx + Math.cos(ang(i)) * R).attr('y2', cy + Math.sin(ang(i)) * R).attr('stroke', 'var(--cds-chart-grid)'); const a = ang(i), lx = cx + Math.cos(a) * (R + 16), ly = cy + Math.sin(a) * (R + 16) + (Math.abs(Math.cos(a)) < .2 ? (Math.sin(a) < 0 ? -8 : 10) : 0); cap(svg.append('text').attr('x', lx).attr('y', ly).attr('dy', '.35em').attr('text-anchor', Math.abs(Math.cos(a)) < .2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end')).text(n); });
    const tp = tipFor(box); const d = anim('radar');
    const lg = svg.append('g');
    rows.forEach((r, j) => {
      const k = ZK[r.zone], c = zoneColor(k);
      const pts = axes.map(([a], i) => [cx + Math.cos(ang(i)) * R * (Number(r[a]) / mx[a]), cy + Math.sin(ang(i)) * R * (Number(r[a]) / mx[a])]);
      const pg = svg.append('polygon').attr('fill', c).attr('fill-opacity', .2).attr('stroke', c).attr('stroke-width', 3).attr('stroke-linejoin', 'round').style('cursor', 'pointer')
        .attr('points', pts.map(() => [cx, cy].join(',')).join(' '));
      pg.transition().delay(j * 120).duration(d).ease(d3.easeCubicOut).attr('points', pts.map(p => p.join(',')).join(' '));
      pts.forEach(p => svg.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', 4.5).attr('fill', c).attr('stroke', 'var(--color-panel)').attr('stroke-width', 1.5).attr('opacity', d ? 0 : 1).style('pointer-events', 'none').transition().delay(j * 120 + d).duration(200).attr('opacity', 1));
      pg.on('mousemove', ev => { pg.attr('fill-opacity', .4); tp.show(ev, [['t', r.zone + `（${fmt(r.area_ha)} ha）`], ...axes.map(([a, n, u, l]) => [null, `${l}　${fmt(r[a])} ${u}`])]); })
        .on('mouseleave', () => { pg.attr('fill-opacity', .2); tp.hide(); })
        .on('click', () => setPeriod('tot', k));
      const lx = 6 + j * (W - 12) / 4, ly = H - 10;
      lg.append('rect').attr('x', lx).attr('y', ly - 6).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', c);
      cap(lg.append('text').attr('x', lx + 14).attr('y', ly).attr('dy', '.3em')).text(k + ' ' + { A: '崩積區', B: '殘壩區', C: '河道', D: '界點下游' }[k]);
    });
  }

  // ---------- VENN ----------
  function drawVenn() {
    const box = document.getElementById('venn'); if (!ready(box, ['venn'])) return;
    const rows = dash.data('venn').data;
    const H = 470; const { svg, W } = svgIn(box, H);
    const r = Math.min(W / 3.4, 125), cx = W / 2, cy = H / 2 - 2, o = r * .62;
    const C = [{ k: 'in_p1', n: PN[0], x: cx - o, y: cy - o * .55, c: zoneColor('B') }, { k: 'in_p2', n: PN[1], x: cx + o, y: cy - o * .55, c: dash.colors[2] }, { k: 'in_p3', n: PN[2], x: cx, y: cy + o * .7, c: dash.colors[0] }];
    const d = anim('venn');
    C.forEach((c, i) => {
      svg.append('circle').attr('cx', c.x).attr('cy', c.y).attr('r', d ? 0 : r).attr('fill', c.c).attr('fill-opacity', .22).attr('stroke', c.c).attr('stroke-width', 3).transition().delay(i * 150).duration(d).ease(d3.easeBackOut).attr('r', r);
      const ly = i < 2 ? c.y - r - 8 : c.y + r + 18;
      const lx = i === 0 ? Math.max(4, c.x - r) : i === 1 ? Math.min(W - 4, c.x + r) : c.x;
      svg.append('text').attr('x', lx).attr('y', ly).attr('text-anchor', i === 0 ? 'start' : i === 1 ? 'end' : 'middle').attr('fill', c.c).style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).text(c.n);
    });
    const pos = f => { const on = C.filter(c => f[c.k]); const off = C.filter(c => !f[c.k]); let x = d3.mean(on, c => c.x), y = d3.mean(on, c => c.y); if (on.length === 1) { const ox = d3.mean(off, c => c.x), oy = d3.mean(off, c => c.y); x += (x - ox) * .45; y += (y - oy) * .45; } if (on.length === 2) { const oc = off[0]; x += (x - oc.x) * .28; y += (y - oc.y) * .28; } return [x, y]; };
    const tp = tipFor(box); const mx = d3.max(rows, q => q.area_ha);
    rows.forEach(q => {
      const [x, y] = pos(q); const core = q.in_p1 && q.in_p2 && q.in_p3;
      const g = svg.append('g').attr('opacity', d ? 0 : 1);
      const code = (q.in_p1 ? 1 : 0) + (q.in_p2 ? 2 : 0) + (q.in_p3 ? 4 : 0), cw = core ? 96 : 74, ch = core ? 40 : 32;
      g.append('rect').attr('x', x - cw / 2).attr('y', y - ch / 2).attr('width', cw).attr('height', ch).attr('rx', ch / 2).attr('fill', PC[code]).attr('stroke', '#fff').attr('stroke-width', 2.5).style('cursor', 'pointer').on('click', () => { persistHi = persistHi === code ? null : code; drawPersist(); });
      g.append('text').attr('x', x).attr('y', y).attr('dy', '.35em').attr('text-anchor', 'middle').attr('fill', '#fff').attr('stroke', 'rgba(0,0,0,.55)').attr('stroke-width', 3).attr('paint-order', 'stroke').style('font-size', core ? '1.35rem' : 'var(--ms-fs-chart-lg)').style('font-weight', 800).style('font-variant-numeric', 'tabular-nums').style('pointer-events', 'none').text(fmt(q.area_ha));
      g.append('rect').attr('x', x - 40).attr('y', y - 22).attr('width', 80).attr('height', 44).attr('fill', 'transparent')
        .on('mousemove', ev => tp.show(ev, [['t', core ? '三段期間都有變動（持續活動區）' : '只在：' + [q.in_p1 && PN[0], q.in_p2 && PN[1], q.in_p3 && PN[2]].filter(Boolean).join('、')], [null, `${fmt(q.area_ha)} 公頃`], [null, '點一下在下方地圖標出位置']])).on('mouseleave', tp.hide).on('click', () => { persistHi = persistHi === code ? null : code; drawPersist(); });
      g.transition().delay(d ? 500 : 0).duration(d).attr('opacity', 1);
    });
  }

  // ---------- SANKEY ----------
  function drawSankey() {
    const box = document.getElementById('sankey'); if (!ready(box, ['sankey'])) return;
    const links = dash.data('sankey').data.map(l => ({ ...l, value: Number(l.value) }));
    const W0 = Math.max(300, box.clientWidth), narrow = W0 < 640;
    const H = narrow ? 540 : 480; const { svg, W } = svgIn(box, H);
    const total = d3.sum(links.filter(l => l.target === '合計流失'), l => l.value);
    const cols = [['A 崩積區', 'B 殘壩區'], ['合計流失'], ['C 河道', 'D 界點下游', '流出治理範圍']];
    const TITLE = { 'A 崩積區': 'A 崩積區', 'B 殘壩區': 'B 殘壩區', '合計流失': '合計流失', 'C 河道': 'C 河道', 'D 界點下游': 'D 界點下游', '流出治理範圍': '流出治理範圍' };
    const SUB = { 'A 崩積區': '崩塌源頭被沖走的量', 'B 殘壩區': '壩體被下切沖走的量', '合計流失': 'A 與 B 加起來', 'C 河道': '淤積在治理界點以上河道', 'D 界點下游': '淤積在界點下游河床', '流出治理範圍': '已輸往花蓮溪或出海（含誤差）' };
    const muted = rgb('var(--cds-chart-muted)', '#8a8a8a');
    const nodeC = { 'A 崩積區': zoneColor('A'), 'B 殘壩區': zoneColor('B'), '合計流失': muted, 'C 河道': zoneColor('C'), 'D 界點下游': zoneColor('D'), '流出治理範圍': muted };
    const nw = 24, gap = 44, top = 62, bottom = 70;
    const k = (H - top - bottom - gap * 2) / total;
    const lw = narrow ? 118 : 215;
    const xs = [lw, W / 2 - nw / 2, W - lw - nw];
    const heads = ['① 從哪裡流失', '② 合計', '③ 最後停在哪裡'];
    heads.forEach((h, i) => {
      const cx = xs[i] + nw / 2;
      svg.append('text').attr('x', cx).attr('y', 22).attr('text-anchor', 'middle').attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(h);
      svg.append('line').attr('x1', cx - (narrow ? 50 : 70)).attr('x2', cx + (narrow ? 50 : 70)).attr('y1', 32).attr('y2', 32).attr('stroke', 'var(--cds-chart-axis)').attr('stroke-width', 2);
    });
    const N = {};
    cols.forEach((col, ci) => {
      const vals = col.map(n => ci === 0 ? links.find(l => l.source === n).value : ci === 1 ? total : links.find(l => l.target === n).value);
      const used = d3.sum(vals) * k + gap * (col.length - 1);
      let y = top + (H - top - bottom - used) / 2;
      col.forEach((n, i) => { N[n] = { x: xs[ci], y, h: Math.max(3, vals[i] * k), v: vals[i], outY: y, inY: y, ci }; y += vals[i] * k + gap; });
    });
    const tp = tipFor(box); const d = anim('sankey');
    const pct = v => d3.format('.0%')(v / total);
    const linkG = svg.append('g'), labG = svg.append('g');
    links.forEach((l, i) => {
      const s = N[l.source], tn = N[l.target], w = Math.max(2, l.value * k);
      const y0 = s.outY + w / 2, y1 = tn.inY + w / 2; s.outY += w; tn.inY += w;
      const x0 = s.x + nw, x1 = tn.x, xm = (x0 + x1) / 2;
      const color = nodeC[tn.ci === 2 ? l.target : l.source];
      const p = linkG.append('path').attr('d', `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}`).attr('fill', 'none').attr('stroke', color).attr('stroke-opacity', .5).attr('stroke-width', w);
      const L = p.node().getTotalLength();
      if (d) p.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L).transition().delay(i * 140).duration(d).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0).on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
      p.on('mousemove', ev => { p.attr('stroke-opacity', .8); tp.show(ev, [['t', `${TITLE[l.source]} → ${TITLE[l.target]}`], [null, `${fmt(l.value)} 萬 m³（占流失總量 ${pct(l.value)}）`]]); }).on('mouseleave', () => { p.attr('stroke-opacity', .5); tp.hide(); });
      if (w >= 18 && !narrow) {
        const mx = xm, my = (y0 + y1) / 2;
        labG.append('text').attr('x', mx).attr('y', my).attr('dy', '.35em').attr('text-anchor', 'middle').attr('fill', 'var(--color-fg)').attr('stroke', 'var(--color-panel)').attr('stroke-width', 4).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).style('pointer-events', 'none').text(fmt(l.value));
      }
    });
    Object.entries(N).forEach(([n, o]) => {
      svg.append('rect').attr('x', o.x).attr('y', o.y).attr('width', nw).attr('height', o.h).attr('rx', 4).attr('fill', nodeC[n]);
      const mid = o.ci === 1, left = o.ci === 0;
      const ax = mid ? o.x + nw / 2 : left ? o.x - 10 : o.x + nw + 10, an = mid ? 'middle' : left ? 'end' : 'start';
      const cy = o.y + o.h / 2;
      const y1 = mid ? o.y + o.h + 20 : cy - 18, y2 = mid ? o.y + o.h + 38 : cy + 2, y3 = cy + 20;
      svg.append('text').attr('x', ax).attr('y', y1).attr('text-anchor', an).attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(TITLE[n]);
      svg.append('text').attr('x', ax).attr('y', y2).attr('text-anchor', an).attr('fill', nodeC[n] === muted ? 'var(--color-fg)' : nodeC[n]).style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).style('font-variant-numeric', 'tabular-nums').text(`${fmt(o.v)} 萬 m³${mid ? '' : '（' + pct(o.v) + '）'}`);
      if (!mid && !narrow) svg.append('text').attr('x', ax).attr('y', y3).attr('text-anchor', an).attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 600).text(SUB[n]);
    });
    // per-100 summary
    const per = [['C 河道', '留在 C 河道'], ['D 界點下游', '留在 D 界點下游'], ['流出治理範圍', '已流出治理範圍']];
    const by = H - 24;
    svg.append('text').attr('x', 6).attr('y', by).attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).text('每 100 m³ 流失的土砂：');
    let px = narrow ? 6 : 175;
    per.forEach(([n, lab], i) => {
      const v = Math.round(N[n].v / total * 100);
      const py = narrow ? by - 4 + 20 * (i + 1) - 40 : by;
      svg.append('rect').attr('x', px).attr('y', py - 12).attr('width', 14).attr('height', 14).attr('rx', 3).attr('fill', nodeC[n]);
      const tx = svg.append('text').attr('x', px + 20).attr('y', py).attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).text(`${v} 個 ${lab}`);
      if (!narrow) px += tx.node().getComputedTextLength() + 44;
    });
  }

  // ---------- TREEMAP (by zone, one map per kind) ----------
  const PSHORT = { '250925→251013': '9/25–10/13', '251013→260314': '10/13–3/14', '260314→260914': '3/14–9/14' };
  const PTINT = { '250925→251013': 1, '251013→260314': .72, '260314→260914': .46 };
  function fit(node, maxW, variants) {
    for (const v of variants) { node.text(v); if (node.node().getComputedTextLength() <= maxW) return; }
    node.text('');
  }
  function drawTree() {
    const box = document.getElementById('tree'); if (!ready(box, ['treemap'])) return;
    const rows = dash.data('treemap').data.filter(r => Number(r.volume) > 0);
    const W0 = Math.max(300, box.clientWidth), narrow = W0 < 780;
    const pw = narrow ? W0 : Math.floor((W0 - 24) / 2);
    const th = narrow ? 480 : Math.round(Math.min(600, Math.max(460, pw * .95)));
    const H = narrow ? th * 2 + 28 : th;
    const { svg } = svgIn(box, H);
    const panel = rgb('var(--color-panel)', '#ffffff');
    const ZK = { A: 'A 崩積區', B: 'B 殘壩區', C: 'C 治理界點以上河道', D: 'D 界點下游河床' };
    const zc = Object.fromEntries(Object.keys(ZK).map(k => [ZK[k], rgb(zoneColor(k), '#888')]));
    const KC = { '沖蝕': rgb('var(--cds-chart-status-critical)', '#c0392b'), '淤積': rgb(dash.colors[0], '#2e6fd8') };
    const KT = { '沖蝕': ['沖蝕', '地面被沖走（流失）'], '淤積': ['淤積', '土砂堆起來（堆積）'] };
    const tp = tipFor(box); const dly = anim('tree');
    const head = 92;
    ['沖蝕', '淤積'].forEach((kind, ki) => {
      const gx = narrow ? 0 : ki * (pw + 24), gy = narrow ? ki * (th + 28) : 0;
      const g = svg.append('g').attr('transform', `translate(${gx},${gy})`).attr('opacity', dly ? 0 : 1);
      const kr = rows.filter(r => r.kind === kind);
      const total = d3.sum(kr, r => Number(r.volume));
      const byZone = d3.rollups(kr, v => d3.sum(v, r => Number(r.volume)), r => r.zone).sort((a, b) => b[1] - a[1]);
      const topLeaf = kr.slice().sort((a, b) => Number(b.volume) - Number(a.volume))[0];
      g.append('path').attr('d', `M0,8a8,8 0 0 1 8,-8h${pw - 16}a8,8 0 0 1 8,8v${head - 8}h${-pw}z`).attr('fill', KC[kind]);
      g.append('text').attr('x', 14).attr('y', 24).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(`${KT[kind][0]}：${KT[kind][1]}`);
      g.append('text').attr('x', 14).attr('y', 55).attr('fill', '#fff').style('font-size', '1.35rem').style('font-weight', 800).style('font-variant-numeric', 'tabular-nums').text(`合計 ${fmt(total)} 萬 m³`);
      const ins = g.append('text').attr('x', 14).attr('y', 80).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700);
      const top1 = `${byZone[0][0]} 占 ${d3.format('.0%')(byZone[0][1] / total)}`, tail = `（${topLeaf.zone.charAt(0)} 區 ${fmt(Number(topLeaf.volume))} 萬）`;
      fit(ins, pw - 24, [`${top1}；最多在 ${PFULL[topLeaf.period]}${tail}`, `${top1}；最多在 ${PSHORT[topLeaf.period]}${tail}`, top1]);
      const hier = { children: byZone.map(([z]) => ({ name: z, children: kr.filter(r => r.zone === z).map(r => ({ name: r.period, zone: z, kind, value: Number(r.volume) })) })) };
      const root = d3.hierarchy(hier).sum(d => d.value || 0).sort((a, b) => b.value - a.value);
      d3.treemap().size([pw, th - head - 6]).paddingTop(d => d.depth === 1 ? 32 : 0).paddingInner(3).paddingOuter(0).round(true)(root);
      const tg = g.append('g').attr('transform', `translate(0,${head + 6})`);
      root.children.forEach(z => {
        const zn = z.data.name, zw = z.x1 - z.x0, col = zc[zn];
        tg.append('rect').attr('x', z.x0).attr('y', z.y0).attr('width', zw).attr('height', z.y1 - z.y0).attr('rx', 6).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 3);
        tg.append('path').attr('d', `M${z.x0},${z.y0 + 6}a6,6 0 0 1 6,-6h${zw - 12}a6,6 0 0 1 6,6v26h${-zw}z`).attr('fill', col);
        const zt = tg.append('text').attr('x', z.x0 + 8).attr('y', z.y0 + 22).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800);
        const pc = d3.format('.0%')(z.value / total), k0 = zn.charAt(0);
        fit(zt, zw - 14, [`${zn}　${fmt(z.value)}（${pc}）`, `${k0} 區　${fmt(z.value)}（${pc}）`, `${k0} ${fmt(z.value)}`, k0]);
      });
      root.leaves().forEach(lf => {
        const r = lf.data, w = lf.x1 - lf.x0, h = lf.y1 - lf.y0, tn = PTINT[r.name], light = tn < .6;
        const lg = tg.append('g').style('cursor', 'pointer');
        lg.append('rect').attr('x', lf.x0).attr('y', lf.y0).attr('width', w).attr('height', h).attr('rx', 3).attr('fill', d3.interpolateRgb(panel, zc[r.zone])(tn)).attr('stroke', zc[r.zone]).attr('stroke-opacity', .6);
        const fg = light ? 'var(--color-fg)' : '#fff';
        if (w > 92 && h > 46) {
          const pl = lg.append('text').attr('x', lf.x0 + 7).attr('y', lf.y0 + 19).attr('fill', fg).style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800); fit(pl, w - 12, [PFULL[r.name], PSHORT[r.name]]);
          lg.append('text').attr('x', lf.x0 + 7).attr('y', lf.y0 + 42).attr('fill', fg).style('font-size', w > 130 && h > 70 ? '1.4rem' : 'var(--ms-fs-chart-lg)').style('font-weight', 800).style('font-variant-numeric', 'tabular-nums').text(fmt(r.value));
        } else if (w > 36 && h > 22) {
          lg.append('text').attr('x', lf.x0 + w / 2).attr('y', lf.y0 + h / 2).attr('dy', '.35em').attr('text-anchor', 'middle').attr('fill', fg).style('font-size', '.8rem').style('font-weight', 800).text(fmt(r.value));
        }
        lg.on('mousemove', ev => tp.show(ev, [['t', `${kind}｜${r.zone}`], [null, `期間 ${PFULL[r.name]}`], [null, `${fmt(r.value)} 萬 m³，占${kind}合計 ${d3.format('.1%')(r.value / total)}`]])).on('mouseleave', tp.hide)
          .on('click', () => { const k = Object.keys(PNAME).find(q => PNAME[q] === r.name); setPeriod(k, ZK_REV[r.zone]); document.getElementById('map-card').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); });
      });
      g.transition().delay(ki * 200).duration(dly).attr('opacity', 1);
    });
    const lg = document.getElementById('tree-legend'); lg.replaceChildren();
    const add = (txt, color, border) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = color; if (border) i.style.border = '1px solid ' + border; s.append(i, document.createTextNode(txt)); lg.appendChild(s); };
    const lead = document.createElement('b'); lead.textContent = '大塊的顏色 = 分區（和地圖同色）：'; lg.appendChild(lead);
    Object.keys(ZK).forEach(k => add(ZK[k], zc[ZK[k]]));
    const l2 = document.createElement('b'); l2.textContent = '　小格的深淺 = 期間：'; l2.style.marginLeft = '1rem'; lg.appendChild(l2);
    const gray = rgb('var(--color-fg)', '#444');
    [['最深　2025/9/25–10/13', 1], ['中等　2025/10/13–2026/3/14', .72], ['最淺　2026/3/14–9/14', .46]].forEach(([n, tt]) => add(n, d3.interpolateRgb(panel, gray)(tt * .75), gray));
  }

  // ---------- FUNNEL ----------
  function drawFunnel() {
    const box = document.getElementById('funnel'); if (!ready(box, ['funnel'])) return;
    const rows = dash.data('funnel').data.map(r => ({ ...r, value: Number(r.value), lost: Number(r.lost) }));
    const W0 = Math.max(300, box.clientWidth), narrow = W0 < 640;
    const H = narrow ? 460 : 440; const { svg, W } = svgIn(box, H);
    const tot = rows[0].value;
    const sw = narrow ? 24 : 40, bh = (H - 20 - sw * 2) / 3 - 8;
    const maxW = narrow ? W * .62 : Math.min(W * .46, 560);
    const cx = narrow ? W * .38 : W * .46;
    const wd = v => Math.max(18, v / tot * maxW);
    const cols = [rgb('var(--cds-chart-status-critical)', '#d9534f'), rgb(dash.colors[1], '#e8a317'), rgb('var(--cds-chart-muted)', '#8a8a8a')];
    const lossC = [null, rgb(zoneColor('C'), '#2e6fd8'), rgb(zoneColor('D'), '#1fa774')];
    const tp = tipFor(box); const d = anim('funnel');
    rows.forEach((r, i) => {
      const y0 = 10 + i * (bh + sw + 8), w0 = wd(r.value), w1 = i < 2 ? wd(rows[i + 1].value) : w0 * .92;
      const g = svg.append('g').attr('opacity', d ? 0 : 1);
      const fi = g.append('path').attr('d', `M${cx - w0 / 2},${y0}L${cx + w0 / 2},${y0}L${cx + w1 / 2},${y0 + bh}L${cx - w1 / 2},${y0 + bh}Z`).attr('fill', cols[i]).attr('fill-opacity', .92).attr('stroke', '#fff').attr('stroke-width', 2.5).attr('stroke-linejoin', 'round');
      g.append('text').attr('x', cx).attr('y', y0 + bh / 2 - 2).attr('text-anchor', 'middle').attr('fill', '#fff').attr('stroke', 'rgba(0,0,0,.35)').attr('stroke-width', 3).attr('paint-order', 'stroke').style('font-size', narrow ? '1.25rem' : '1.7rem').style('font-weight', 800).style('font-variant-numeric', 'tabular-nums').text(fmt(r.value));
      g.append('text').attr('x', cx).attr('y', y0 + bh / 2 + 22).attr('text-anchor', 'middle').attr('fill', '#fff').attr('stroke', 'rgba(0,0,0,.35)').attr('stroke-width', 3).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(`萬 m³　${d3.format('.0%')(r.value / tot)}`);
      const lx = cx - maxW / 2 - 16;
      g.append('text').attr('x', narrow ? 4 : lx).attr('y', y0 + 22).attr('text-anchor', narrow ? 'start' : 'end').attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(r.step);
      g.on('mousemove', ev => tp.show(ev, [['t', r.step], [null, `${fmt(r.value)} 萬 m³（占流失總量 ${d3.format('.1%')(r.value / tot)}）`]])).on('mouseleave', tp.hide);
      g.transition().delay(i * 220).duration(d).attr('opacity', 1);
      if (i < 2) {
        const nx = rows[i + 1], ly = y0 + bh + sw / 2 + 4, col = lossC[i + 1];
        const lg = svg.append('g').attr('opacity', d ? 0 : 1);
        lg.append('path').attr('d', `M${cx},${y0 + bh + 2}l0,${sw - 8}m-7,-9l7,9l7,-9`).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 3).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
        const tx = cx + (narrow ? 20 : 26);
        lg.append('text').attr('x', tx).attr('y', ly - 2).attr('fill', col).style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(`${nx.lost_label}　−${fmt(nx.lost)}（${d3.format('.0%')(nx.lost / tot)}）`);
        lg.transition().delay(i * 220 + 300).duration(d).attr('opacity', 1);
      }
    });
    const last = rows[2];
    const sx = narrow ? 8 : Math.max(cx + maxW / 2 + 40, W - 270), sy = narrow ? H - 4 : 60, sw2 = narrow ? W - 16 : W - sx - 8;
    if (!narrow) {
      const cb = svg.append('g');
      cb.append('rect').attr('x', sx).attr('y', sy - 36).attr('width', sw2).attr('height', 176).attr('rx', 12).attr('fill', cols[2]).attr('fill-opacity', .14).attr('stroke', cols[2]).attr('stroke-width', 2);
      cb.append('text').attr('x', sx + 16).attr('y', sy).attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).text('結論');
      cb.append('text').attr('x', sx + 16).attr('y', sy + 38).attr('fill', 'var(--color-fg)').style('font-size', '2.1rem').style('font-weight', 800).text(d3.format('.0%')(last.value / tot));
      const t2 = cb.append('text').attr('x', sx + 16).attr('y', sy + 66).attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700);
      t2.append('tspan').attr('x', sx + 16).text('的流失土砂已經流出治理');
      t2.append('tspan').attr('x', sx + 16).attr('dy', '1.4em').text('範圍；留在 C、D 河床的');
      t2.append('tspan').attr('x', sx + 16).attr('dy', '1.4em').text(`只有 ${d3.format('.0%')(1 - last.value / tot)}。`);
    }
  }

  // ---------- PERSISTENCE MAP ----------
  function drawPersist() {
    const box = document.getElementById('persist'); if (!ready(box, ['persist', 'satellite', 'geo'])) return;
    const rows = dash.data('persist').data.map(r => ({ x: Number(r.x), y: Number(r.y), code: Number(r.code), zone: r.zone }));
    const sat = dash.data('satellite').data[0], geo = window.msGeo(dash.data('geo').data);
    const X0 = 276000, X1 = 301000, Y0 = 2617000, Y1 = 2627500;
    const vx0 = 277200, vx1 = 300000, vy0 = 2617500, vy1 = 2626000;
    const W0 = Math.max(300, box.clientWidth), H = Math.round(W0 * (vy1 - vy0) / (vx1 - vx0));
    const { svg, W } = svgIn(box, H); box.style.minHeight = H + 'px';
    const sx = x => (x - vx0) / (vx1 - vx0) * W, sy = y => (vy1 - y) / (vy1 - vy0) * H;
    svg.append('image').attr('href', sat.data_url).attr('x', sx(X0)).attr('y', sy(Y1)).attr('width', sx(X1) - sx(X0)).attr('height', sy(Y0) - sy(Y1)).attr('preserveAspectRatio', 'none');
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', '#000').attr('fill-opacity', .32);
    const line = d3.line().x(q => sx(q[0])).y(q => sy(q[1]));
    const cs = 50 / (vx1 - vx0) * W, cell = new Map();
    const cg = svg.append('g');
    const d = anim('persist');
    rows.forEach(r => {
      cell.set(`${Math.round((r.x - 25 - X0) / 50)},${Math.round((Y1 - r.y - 25) / 50)}`, r);
      const on = persistHi == null || persistHi === r.code;
      cg.append('rect').attr('x', sx(r.x - 25)).attr('y', sy(r.y + 25)).attr('width', cs + .8).attr('height', cs + .8).attr('fill', PC[r.code]).attr('opacity', on ? (d ? 0 : .95) : .1);
    });
    if (d) cg.selectAll('rect').transition().delay((_, i) => Math.min(900, i * .25)).duration(d).attr('opacity', .95);
    geo.filter(q => q.zone !== 'path').forEach(q => {
      svg.append('path').attr('d', line(q.coords) + 'Z').attr('fill', 'none').attr('stroke', '#000').attr('stroke-opacity', .7).attr('stroke-width', 6).attr('stroke-linejoin', 'round').style('pointer-events', 'none');
      svg.append('path').attr('d', line(q.coords) + 'Z').attr('fill', 'none').attr('stroke', zoneColor(q.zone)).attr('stroke-width', 2.6).attr('stroke-linejoin', 'round').style('pointer-events', 'none');
      const cx = d3.mean(q.coords, p => sx(p[0])), cy = d3.min(q.coords, p => sy(p[1]));
      svg.append('text').attr('x', cx).attr('y', Math.max(22, cy - 6)).attr('text-anchor', 'middle').attr('fill', '#fff').attr('stroke', 'rgba(0,0,0,.75)').attr('stroke-width', 4).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).style('pointer-events', 'none').text(q.name);
    });
    const tp = tipFor(box);
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent')
      .on('mousemove', ev => { const [mx, my] = d3.pointer(ev); const x = vx0 + mx / W * (vx1 - vx0), y = vy1 - my / H * (vy1 - vy0); const r = cell.get(`${Math.floor((x - X0) / 50)},${Math.floor((Y1 - y) / 50)}`); if (!r) { tp.hide(); return; } tp.show(ev, [['t', `${ZK_NAME[r.zone] || ''}`], [null, `有變動的期間：${codeName(r.code)}`, PC[r.code]], [null, r.code === 7 ? '三段期間都在變（持續活動）' : `${[1, 2, 4].filter(b => r.code & b).length} 段期間有變動`]]); })
      .on('mouseleave', tp.hide);
    const lg = document.getElementById('persist-legend'); lg.replaceChildren();
    const ve = dash.data('venn_tbl');
    (ve.status === 'ok' ? ve.data : []).forEach(q => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pm-chip'; b.setAttribute('aria-pressed', String(persistHi === q.code));
      const i = document.createElement('i'); i.style.background = PC[q.code]; b.append(i, document.createTextNode(`${q.label.replace('（持續活動）', '')}　${fmt(q.area_ha)} ha`));
      b.addEventListener('click', () => { persistHi = persistHi === q.code ? null : q.code; drawPersist(); });
      lg.appendChild(b);
    });
    const all = document.createElement('button'); all.type = 'button'; all.className = 'pm-chip'; all.textContent = '顯示全部'; all.addEventListener('click', () => { persistHi = null; drawPersist(); }); lg.appendChild(all);
  }

  function fillTables() {
    const tm = dash.data('tmtable'), ve = dash.data('venn_tbl');
    const fillTable = (id, d, cols) => {
      const tb = document.querySelector(`#${id} tbody`); if (!tb) return;
      tb.replaceChildren();
      d.data.forEach(r => {
        const tr = document.createElement('tr');
        cols.forEach((c, i) => {
          const td = document.createElement('td'); const v = r[c];
          const txt = typeof v === 'number' ? (c === 'net' ? sgn(v) : c === 'share' ? v + '%' : fmt(v)) : v;
          if (id === 'vn-table' && i === 0) { const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = PC[r.code]; td.append(sw, document.createTextNode(txt)); }
          else td.textContent = txt;
          if (c === 'net') td.className = v < 0 ? 'neg' : 'pos';
          tr.appendChild(td);
        });
        if (id === 'vn-table') { tr.style.cursor = 'pointer'; tr.addEventListener('mouseenter', () => { persistHi = r.code; drawPersist(); }); tr.addEventListener('mouseleave', () => { persistHi = null; drawPersist(); }); }
        tb.appendChild(tr);
      });
    };
    if (tm.status === 'ok') fillTable('tm-table', tm, ['zone', 'e1', 'e2', 'e3', 'et', 'd1', 'd2', 'd3', 'dt', 'net']);
    if (ve.status === 'ok') fillTable('vn-table', ve, ['label', 'area_ha', 'share']);
    const rd = dash.data('radar'), rtb = document.querySelector('#rd-table tbody');
    if (rd.status === 'ok' && rtb) {
      rtb.replaceChildren(); const f1 = d3.format(',.1f');
      rd.data.forEach(r => {
        const tr = document.createElement('tr');
        ['zone', 'erosion', 'deposition', 'active_pct', 'mean_abs_dz', 'p02_lowering', 'p98_raising'].forEach((c, i) => {
          const td = document.createElement('td'); const v = r[c];
          if (i === 0) { const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = zoneColor(ZK_REV[v]); td.append(sw, document.createTextNode(v)); }
          else td.textContent = (c === 'erosion' || c === 'deposition') ? fmt(Number(v)) : f1(Number(v));
          tr.appendChild(td);
        });
        rtb.appendChild(tr);
      });
    }
  }

  const ZK_NAME = { A: 'A 崩積區', B: 'B 殘壩區', C: 'C 治理界點以上河道', D: 'D 界點下游河床' };
  const ZK_REV = { 'A 崩積區': 'A', 'B 殘壩區': 'B', 'C 治理界點以上河道': 'C', 'D 界點下游河床': 'D' };
  function redrawAll() { drawMap(); drawHeat(); drawRadar(); drawVenn(); drawPersist(); drawSankey(); drawFunnel(); drawTree(); fillTables(); }
  dash.onData(redrawAll);
})();
