(function () {
  const fmt = d3.format(',');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.getElementById('locator');
  const probe = document.createElement('span'); probe.style.display = 'none'; root.appendChild(probe);
  function rgb(v, fb) { probe.style.color = ''; probe.style.color = v; const c = d3.color(getComputedStyle(probe).color); return c ? c.formatRgb() : fb; }
  const ZN = { A: '崩積區', B: '殘壩區', C: '治理界點以上河道', D: '界點下游河床' };
  const zc = () => ({ A: dash.colors[3], B: 'var(--cds-chart-status-critical)', C: dash.colors[0], D: dash.colors[2] });
  let active = null, drawnOnce = false, layer = 'sat';
  const X0 = 276000, X1 = 301000, Y0 = 2617000, Y1 = 2627500, CW = 250, CH = 105;

  function paintChips() {
    const c = zc();
    document.querySelectorAll('.zchip').forEach(el => { el.style.setProperty('--zc', c[el.dataset.z]); });
  }

  function fillList() {
    const z = dash.data('zoneinfo'); if (z.status !== 'ok') return;
    z.data.forEach(r => {
      const set = (f, v) => document.querySelectorAll(`[data-source="zoneinfo"][data-field="${f}"][data-where="zone=${r.zone}"]`).forEach(el => { el.textContent = v; });
      set('name', r.name); set('role', r.role); set('where', r.where);
      set('area_ha', fmt(r.area_ha)); set('elev_min', fmt(r.elev_min)); set('elev_max', fmt(r.elev_max));
      if (r.chan_from_km != null) { set('chan_from_km', r.chan_from_km.toFixed(1)); set('chan_to_km', r.chan_to_km.toFixed(1)); }
    });
    document.querySelectorAll('.lc-item').forEach(el => el.classList.remove('dash-skeleton'));
  }

  function setActive(k) {
    active = k;
    document.querySelectorAll('.lc-item').forEach(el => el.classList.toggle('on', el.dataset.z === k));
    draw();
  }
  document.querySelectorAll('.lc-item').forEach(el => {
    el.addEventListener('mouseenter', () => setActive(el.dataset.z));
    el.addEventListener('focus', () => setActive(el.dataset.z));
    el.addEventListener('mouseleave', () => setActive(null));
    el.addEventListener('blur', () => setActive(null));
  });

  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = []; p.forEach(q => { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
    const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop(); return lo.concat(up);
  }

  function draw() {
    const box = document.getElementById('lcmap');
    const ids = layer === 'sat' ? ['locator', 'geo', 'zoneinfo', 'satellite'] : ['locator', 'geo', 'zoneinfo'];
    const st = ids.map(i => dash.data(i).status);
    if (st.includes('error')) { d3.select(box).selectAll('svg,canvas,.ms-fail').remove(); box.classList.remove('dash-skeleton'); const f = document.createElement('div'); f.className = 'ms-fail'; f.textContent = 'Failed to load'; box.appendChild(f); return; }
    if (!st.every(s => s === 'ok')) { box.classList.add('dash-skeleton'); return; }
    box.classList.remove('dash-skeleton'); d3.select(box).selectAll('.ms-fail').remove();
    const rows = dash.data('locator').data, geo = window.msGeo(dash.data('geo').data), info = dash.data('zoneinfo').data;
    const W = Math.max(280, box.clientWidth), H = Math.round(W * (Y1 - Y0) / (X1 - X0));
    box.style.minHeight = H + 'px';
    // terrain canvas
    let cv = box.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); box.prepend(cv); }
    const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = '100%'; cv.style.height = H + 'px'; cv.style.display = 'block'; cv.style.borderRadius = '6px';
    const off = document.createElement('canvas'); off.width = CW; off.height = CH; const oc = off.getContext('2d'); const img = oc.createImageData(CW, CH);
    const elev = d3.interpolateRgbBasis(['#3f6b4a', '#8fae6d', '#d9cc92', '#b58a63', '#f2eee6']);
    rows.forEach(r => {
      const c = Math.round((r.x - X0 - 50) / 100), rr = Math.round((Y1 - r.y - 50) / 100); if (c < 0 || c >= CW || rr < 0 || rr >= CH) return;
      const e = d3.color(elev(Math.min(1, Math.max(0, (r.z - 100) / 2600)))); const sh = .45 + .75 * r.hs;
      img.data.set([Math.min(255, e.r * sh), Math.min(255, e.g * sh), Math.min(255, e.b * sh), 255], (rr * CW + c) * 4);
    });
    oc.putImageData(img, 0, 0);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, W, H); ctx.drawImage(off, 0, 0, W, H);

    d3.select(box).selectAll('svg').remove();
    const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H).style('position', 'absolute').style('left', 0).style('top', 0);
    const sx = x => (x - X0) / (X1 - X0) * W, sy = y => (Y1 - y) / (Y1 - Y0) * H;
    const halo = s => s.attr('stroke', 'rgba(0,0,0,.65)').attr('stroke-width', 4).attr('paint-order', 'stroke').attr('stroke-linejoin', 'round');
    // graticule every 5 km
    if (layer === 'sat') { const sat = dash.data('satellite').data[0]; svg.append('image').attr('href', sat.data_url).attr('x', 0).attr('y', 0).attr('width', W).attr('height', H).attr('preserveAspectRatio', 'none').style('pointer-events', 'none'); }
    const g = svg.append('g');
    for (let x = 280000; x < X1; x += 5000) { g.append('line').attr('x1', sx(x)).attr('x2', sx(x)).attr('y1', 0).attr('y2', H).attr('stroke', '#fff').attr('stroke-opacity', .25).attr('stroke-dasharray', '2 4'); halo(g.append('text').attr('x', sx(x) + 4).attr('y', H - 6).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700)).text(`E ${x / 1000}`); }
    for (let y = 2620000; y < Y1; y += 5000) { g.append('line').attr('x1', 0).attr('x2', W).attr('y1', sy(y)).attr('y2', sy(y)).attr('stroke', '#fff').attr('stroke-opacity', .25).attr('stroke-dasharray', '2 4'); halo(g.append('text').attr('x', 6).attr('y', sy(y) - 5).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700)).text(`N ${(y / 1000).toFixed(0)}`); }
    const line = d3.line().x(d => sx(d[0])).y(d => sy(d[1]));
    const path = geo.find(q => q.zone === 'path');
    const col = zc();
    const pathEl = path && svg.append('path').attr('d', line(path.coords)).attr('fill', 'none').attr('stroke', '#7fd3ff').attr('stroke-width', 3).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    if (pathEl && !reduce && !drawnOnce) { const L = pathEl.node().getTotalLength(); pathEl.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L).transition().duration(1400).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0).on('end', function () { d3.select(this).attr('stroke-dasharray', null); }); }
    // flow chevrons
    if (path) for (let i = 4; i < path.coords.length - 1; i += 6) { const a = path.coords[i], b = path.coords[i + 1]; const ang = Math.atan2(sy(b[1]) - sy(a[1]), sx(b[0]) - sx(a[0])) * 180 / Math.PI; svg.append('path').attr('d', 'M-5,-5L2,0L-5,5').attr('fill', 'none').attr('stroke', '#fff').attr('stroke-width', 2.2).attr('transform', `translate(${sx(a[0])},${sy(a[1])}) rotate(${ang})`); }
    // overall study-area frame
    const hull = convexHull(geo.filter(q => q.zone !== 'path').flatMap(q => q.coords.map(c => [sx(c[0]), sy(c[1])])));
    if (hull) {
      svg.append('path').attr('d', 'M' + hull.map(p => p.join(',')).join('L') + 'Z').attr('fill', 'none').attr('stroke', '#000').attr('stroke-opacity', .6).attr('stroke-width', 6).attr('stroke-linejoin', 'round').style('pointer-events', 'none');
      svg.append('path').attr('d', 'M' + hull.map(p => p.join(',')).join('L') + 'Z').attr('fill', 'none').attr('stroke', '#ffd60a').attr('stroke-width', 2.8).attr('stroke-dasharray', '10 6').attr('stroke-linejoin', 'round').style('pointer-events', 'none');
      const top = hull.reduce((m, p) => p[1] < m[1] ? p : m, hull[0]);
      halo(svg.append('text').attr('x', top[0] + 8).attr('y', top[1] - 8).attr('fill', '#ffd60a').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800)).text('整體分析範圍');
    }
    // zones
    geo.filter(q => q.zone !== 'path').forEach(q => {
      const on = active === q.zone, dim = active && !on;
      svg.append('path').attr('d', line(q.coords) + 'Z').attr('fill', 'none').attr('stroke', '#000').attr('stroke-opacity', dim ? .25 : .75).attr('stroke-width', (on ? 5 : 3) + 4).attr('stroke-linejoin', 'round').style('pointer-events', 'none');
      svg.append('path').attr('d', line(q.coords) + 'Z').attr('fill', col[q.zone]).attr('fill-opacity', on ? .3 : dim ? .04 : (layer === 'sat' ? .1 : .2)).attr('stroke', col[q.zone]).attr('stroke-width', on ? 5 : 3).attr('stroke-opacity', dim ? .5 : 1).attr('stroke-linejoin', 'round').style('cursor', 'pointer').style('pointer-events', 'all')
        .on('mouseenter', () => setActive(q.zone)).on('mouseleave', () => setActive(null));
      const i = info.find(r => r.zone === q.zone);
      if (i) {
        const lx = sx(i.cx), ly = sy(i.cy);
        const t = svg.append('text').attr('x', lx).attr('y', ly).attr('text-anchor', 'middle').attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).style('pointer-events', 'none');
        halo(t); t.append('tspan').attr('x', lx).style('font-size', '2.1rem').text(q.zone);
        t.append('tspan').attr('x', lx).attr('dy', '1.3em').style('font-size', 'var(--ms-fs-chart-lg)').text(q.name.replace(/^[A-D] /, ''));
      }
    });
    // markers: dam site and treatment boundary
    const mark = (x, y, label, dx, dy, anchor) => {
      svg.append('circle').attr('cx', sx(x)).attr('cy', sy(y)).attr('r', 6).attr('fill', '#fff').attr('stroke', '#111').attr('stroke-width', 2.5);
      halo(svg.append('text').attr('x', sx(x) + dx).attr('y', sy(y) + dy).attr('text-anchor', anchor).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800)).text(label);
    };
    if (path) {
      mark(path.coords[0][0], path.coords[0][1], '殘壩頂（河道起點）', -10, 22, 'start');
      const bi = path.coords.findIndex(c => c[0] >= 282100); if (bi > 0) mark(path.coords[bi][0], path.coords[bi][1], 'B｜C 分界', -2, 24, 'middle');
      const gi = path.coords.findIndex(c => c[0] >= 289000); if (gi > 0) mark(path.coords[gi][0], path.coords[gi][1], '治理界點（約）', 0, -14, 'middle');
    }
    halo(svg.append('text').attr('x', sx(X0 + (X1 - X0) * .5)).attr('y', 22).attr('text-anchor', 'middle').attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700)).text('水流方向：由西（上游）往東（下游）');
    // scale bar and north
    const k5 = 5000 / (X1 - X0) * W; const sb = svg.append('g').attr('transform', `translate(${W - k5 - 16},${H - 34})`);
    sb.append('rect').attr('width', k5).attr('height', 6).attr('fill', '#fff').attr('stroke', '#000').attr('stroke-width', .8);
    halo(sb.append('text').attr('x', k5 / 2).attr('y', -6).attr('text-anchor', 'middle').attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800)).text('5 km');
    const na = svg.append('g').attr('transform', `translate(${W - 28},44)`); na.append('path').attr('d', 'M0,-16L8,10L0,4L-8,10Z').attr('fill', '#fff').attr('stroke', '#000'); halo(na.append('text').attr('y', 28).attr('text-anchor', 'middle').attr('fill', '#fff').style('font-weight', 800)).text('N');
    if (layer === 'sat') { halo(svg.append('text').attr('x', 16).attr('y', H - 30).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700)).text('衛星影像：2025/9/27–11/16 空拍正射（約 10 m 解析度顯示）'); drawnOnce = true; return; }
    // elevation legend
    const lg = svg.append('g').attr('transform', `translate(16,${H - 66})`);
    const gid = 'lcg'; const df = svg.append('defs').append('linearGradient').attr('id', gid);
    [0, .25, .5, .75, 1].forEach(t => df.append('stop').attr('offset', t).attr('stop-color', elev(t)));
    lg.append('rect').attr('width', 150).attr('height', 10).attr('rx', 3).attr('fill', `url(#${gid})`).attr('stroke', '#000').attr('stroke-opacity', .5);
    halo(lg.append('text').attr('y', -5).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800)).text('高程 m');
    halo(lg.append('text').attr('y', 26).attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700)).text('100');
    halo(lg.append('text').attr('x', 150).attr('y', 26).attr('text-anchor', 'end').attr('fill', '#fff').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700)).text('2,700');
    drawnOnce = true;
  }

  document.querySelectorAll('#lc-seg button').forEach(b => b.addEventListener('click', () => { layer = b.dataset.l; document.querySelectorAll('#lc-seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
  dash.onData(() => { paintChips(); fillList(); draw(); });
})();
