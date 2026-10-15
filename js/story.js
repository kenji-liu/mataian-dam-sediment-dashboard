
dash.calc('b_rate', {
  inputs: ['periods'], title: '殘壩區每日流失速率',
  description: '各期 B 區流失量除以天數（萬 m³/天）。',
  fn: (periods) => periods.map(p => ({ period: p.period, rate: Math.round(-Number(p.B) / Number(p.days) * 10) / 10 }))
});
dash.calc('cumul', {
  inputs: ['periods'], title: '各區累積變化',
  description: '以 2025-09-25 為零點，逐期累加 A、B、C、D 區變化量（萬 m³）。',
  fn: (periods) => {
    const out = [{ date: '2025-09-25', A: 0, B: 0, C: 0, D: 0 }];
    periods.forEach(p => { const l = out[out.length - 1]; out.push({ date: p.end, A: l.A + Number(p.A), B: l.B + Number(p.B), C: l.C + Number(p.C), D: l.D + Number(p.D) }); });
    return out;
  }
});
dash.calc('budget', {
  inputs: ['zones'], title: '土砂收支',
  description: '以 2025/9/25→2026/9/14 的 DEM 差分：A、B 兩區流失量合計，以及其中留在 C 區河道、留在 D 區界點下游河床、流出治理範圍的量與占比（萬 m³）。',
  fn: (zones) => {
    const g = k => Number(zones.find(z => z.zone.startsWith(k)).dem_since_breach);
    const a = -g('A'), b = -g('B'), c = g('C'), d = g('D'), loss = a + b, rest = loss - c - d;
    const p = v => Math.round(v / loss * 100) + '%';
    return [
      { part: 'A+B 流失', value: loss, share: '100%' },
      { part: 'A 崩積區 流失', value: a, share: p(a) },
      { part: 'B 殘壩區 流失', value: b, share: p(b) },
      { part: '留在 C 區河道', value: c, share: p(c) },
      { part: '留在界點下游河床', value: d, share: p(d) },
      { part: '輸出至花蓮溪或出海', value: rest, share: p(rest) }
    ];
  }
});
dash.calc('profile_tbl', {
  inputs: ['profile'], title: '河道各公里高程表',
  description: '距殘壩頂每整數公里處的五期河床高程（m），以及 2026/9/14 較 2025/9/25 的高程變化（m）。',
  fn: (profile) => profile.filter(r => Math.abs(Number(r.dist_km) - Math.round(Number(r.dist_km))) < 0.01).map(r => {
    const v = k => (r[k] == null || r[k] === '' ? null : Number(r[k]));
    const b = v('d250925'), e = v('d260914');
    return { km: Math.round(Number(r.dist_km)), d250816: v('d250816'), d250925: b, d251013: v('d251013'), d260314: v('d260314'), d260914: e, chg: b != null && e != null ? Math.round((e - b) * 10) / 10 : null };
  })
});

(function () {
  const fmt = d3.format(',');
  const sgn = v => (v > 0 ? '+' : '') + fmt(v);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DUR = reduce ? 0 : 650;
  let chart = null, tip = null, legendEl = null;
  const seen = {};
  const STEPS = ['rates', 'cumul', 'profile', 'budget'];
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || 'currentColor';

  const META = {
    rates: { t: '殘壩區每日流失速率', n: '各期 B 區流失量 ÷ 天數，萬 m³/天。紅柱是潰決後第一期（2025/9/25–10/13），藍柱是之後各期。', src: ['b_rate', 'periods'] },
    cumul: { t: '各區累積土砂變化', n: '以 2025/9/25 為零點逐期累加，萬 m³。往下＝累積流失，往上＝累積淤積。', src: ['cumul'] },
    profile: { t: '河道縱斷面：殘壩頂 → 下游 15 km', n: '河床高程（m），五個時間點比較。滑鼠左右移動，會在線上標出該位置每一期的高程數值；下方表格列出每整數公里的數值。', src: ['profile'] },
    budget: { t: '土砂收支：2025/9/25 → 2026/9/14', n: 'A+B 流失的總量，以及留在 C 河道、留在 D 界點下游河床、已流出治理範圍各占多少（萬 m³）。', src: ['budget'] }
  };

  function showTip(ev, html) {
    const r = chart.getBoundingClientRect();
    tip.replaceChildren(); html.forEach(([cls, txt, color]) => { const d = document.createElement('div'); if (cls) d.className = cls; if (color) { const s = document.createElement('span'); s.className = 'sw'; s.style.background = color; d.appendChild(s); } d.appendChild(document.createTextNode(txt)); tip.appendChild(d); });
    tip.style.opacity = 1;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = ev.clientX - r.left + 12, y = ev.clientY - r.top - th - 8;
    if (x + tw > r.width) x = ev.clientX - r.left - tw - 12; if (x < 0) x = 0; if (y < 0) y = ev.clientY - r.top + 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => { tip.style.opacity = 0; };

  function legend(items) {
    const L = legendEl; L.replaceChildren();
    items.forEach(([name, color]) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = color; s.append(i, document.createTextNode(name)); L.appendChild(s); });
  }

  function svgBox(h) {
    const W = Math.max(280, chart.clientWidth);
    let svg = d3.select(chart).select('svg');
    if (svg.empty()) svg = d3.select(chart).append('svg').attr('width', '100%');
    svg.attr('viewBox', `0 0 ${W} ${h}`).attr('height', h);
    return { svg, W, H: h };
  }
  function measure(svg, texts) {
    const g = svg.append('g').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 700);
    let m = 0; texts.forEach(t => { const n = g.append('text').text(t).node(); m = Math.max(m, n.getComputedTextLength()); });
    g.remove(); return m;
  }
  function styleAxis(g) {
    g.attr('font-size', null).attr('font-family', null);
    g.selectAll('text').attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--ms-fs-chart)');
    g.selectAll('.domain').attr('stroke', 'var(--cds-chart-axis)');
    g.selectAll('.tick line').attr('stroke', 'var(--cds-chart-grid)');
  }

  function drawRates(svg, W, H) {
    const rows = dash.data('b_rate').data;
    const days = Object.fromEntries((dash.data('periods').data || []).map(p => [p.period, p.days]));
    const ml = 40, mb = 44;
    const x = d3.scaleBand(rows.map(r => r.period), [ml, W - 8]).padding(.35);
    const y = d3.scaleLinear([0, d3.max(rows, r => r.rate) * 1.15], [H - mb, 16]).nice();
    svg.append('g').attr('transform', `translate(${ml},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - ml - 8))).call(styleAxis).call(g => g.select('.domain').remove());
    svg.append('g').attr('transform', `translate(0,${H - mb})`).call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat(p => ({ '250925→251013': '2025/9/25–10/13', '251013→260314': '2025/10/13–2026/3/14', '260314→260914': '2026/3/14–9/14' })[p] || p)).call(styleAxis);
    svg.append('g').selectAll('text').data(rows).join('text').attr('x', d => x(d.period) + x.bandwidth() / 2).attr('y', H - mb + 34).attr('text-anchor', 'middle').attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--ms-fs-chart)').text(d => days[d.period] ? `${days[d.period]} 天` : '');
    const bw = Math.min(88, x.bandwidth());
    rows.forEach((r, i) => {
      const col = i === 0 ? css('--cds-chart-status-critical') : dash.colors[0];
      svg.append('rect').attr('x', x(r.period) + (x.bandwidth() - bw) / 2).attr('width', bw).attr('rx', 4).attr('fill', col).attr('y', H - mb).attr('height', 0)
        .on('mousemove', ev => showTip(ev, [['t', r.period], [null, `${r.rate} 萬 m³/天`]])).on('mouseleave', hideTip)
        .transition().delay(i * 120).duration(DUR).ease(d3.easeCubicOut).attr('y', y(r.rate)).attr('height', H - mb - y(r.rate));
      svg.append('text').attr('x', x(r.period) + x.bandwidth() / 2).attr('y', y(r.rate) - 6).attr('text-anchor', 'middle').attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart)').text(r.rate).attr('opacity', 0).transition().delay(i * 120 + DUR * .7).attr('opacity', 1);
    });
    legend([['潰決後第一期', css('--cds-chart-status-critical')], ['之後各期', dash.colors[0]]]);
  }

  function drawCumul(svg, W, H) {
    const rows = dash.data('cumul').data.map(r => ({ ...r, t: new Date(r.date) }));
    const ser = [['B', 'B 殘壩區', css('--cds-chart-status-critical')], ['C', 'C 河道', dash.colors[0]], ['D', 'D 界點下游', dash.colors[2]], ['A', 'A 崩積區', dash.colors[3]]];
    const last = rows[rows.length - 1];
    const endLbl = ser.map(s => `${s[1]} ${sgn(last[s[0]])}`);
    const mr = measure(svg, endLbl) * 1.4 + 22, ml = 56, mb = 50;
    const x = d3.scaleUtc(d3.extent(rows, r => r.t), [ml + 50, W - mr]);
    const y = d3.scaleLinear(d3.extent(rows.flatMap(r => ser.map(s => r[s[0]]))), [H - mb, 16]).nice();
    svg.append('g').attr('transform', `translate(${ml},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(fmt).tickSize(-(W - ml - mr))).call(styleAxis).call(g => g.select('.domain').remove());
    svg.append('g').attr('transform', `translate(0,${H - mb})`).call(d3.axisBottom(x).tickValues(rows.map(r => r.t)).tickFormat(d3.utcFormat('%Y/%-m/%-d'))).call(styleAxis).call(g => g.selectAll('.tick text').attr('dy', '.9em').attr('text-anchor', (d, i) => i === 0 ? 'end' : i === 1 ? 'start' : 'middle').attr('dx', (d, i) => i === 0 ? '.5em' : i === 1 ? '-.5em' : null).style('font-size', W < 560 ? 'var(--ms-fs-chart)' : 'var(--ms-fs-chart-lg)'));
    svg.append('line').attr('x1', ml).attr('x2', W - mr).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', 'var(--cds-chart-reference)').attr('stroke-dasharray', '4 3');
    const spread = (items, gap) => { items.sort((a, b) => a.y - b.y); for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap; return items; };
    const ends = spread(ser.map((s, i) => ({ y: y(last[s[0]]), s, lbl: endLbl[i] })), 22);
    ser.forEach(([k, name, col]) => {
      const line = d3.line().x(r => x(r.t)).y(r => y(r[k]));
      const p = svg.append('path').datum(rows).attr('d', line).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 3.5).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      const L = p.node().getTotalLength();
      p.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L).transition().duration(DUR * 1.4).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0).on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
      svg.append('g').selectAll('circle').data(rows).join('circle').attr('cx', r => x(r.t)).attr('cy', r => y(r[k])).attr('r', 6.5).attr('fill', col).attr('stroke', 'var(--color-panel)').attr('stroke-width', 2)
        .on('mousemove', (ev, r) => showTip(ev, [['t', `${r.date}（距 2025/9/25 ${Math.round((r.t - rows[0].t) / 864e5)} 天）`], ...ser.map(s => [null, `${s[1]}　${sgn(r[s[0]])} 萬 m³`, s[2]])])).on('mouseleave', hideTip);
    });
    // a value label at every point (labels in the same column are spread apart)
    rows.forEach((r, j) => {
      if (j === 0 || j === rows.length - 1) return;
      spread(ser.map(([k, , col]) => ({ y: y(r[k]), v: r[k], col })), 19).forEach(l => {
        svg.append('text').attr('x', x(r.t) + 12).attr('y', l.y).attr('dy', '.35em').attr('fill', l.col).attr('stroke', 'var(--color-panel)').attr('stroke-width', 4).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).style('font-variant-numeric', 'tabular-nums').style('pointer-events', 'none').text(sgn(l.v)).attr('opacity', 0).transition().delay(DUR * 1.1).duration(300).attr('opacity', 1);
      });
    });
    ends.forEach(e => svg.append('text').attr('x', W - mr + 10).attr('y', e.y).attr('dy', '.35em').attr('fill', e.s[2]).style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(e.lbl));
    legend([]);
  }

  function drawProfile(svg, W, H) {
    const rows = dash.data('profile').data;
    const ser = [['d250816', '2025/8/16 堰塞湖期', css('--cds-chart-muted')], ['d250925', '2025/9/25 潰決後', css('--cds-chart-status-critical')], ['d251013', '2025/10/13', dash.colors[3]], ['d260314', '2026/3/14', dash.colors[2]], ['d260914', '2026/9/14', dash.colors[0]]];
    const ml = 48, mb = 44, mr = 10;
    const x = d3.scaleLinear([0, d3.max(rows, r => r.dist_km)], [ml, W - mr]);
    const vals = rows.flatMap(r => ser.map(s => r[s[0]])).filter(v => v != null);
    const y = d3.scaleLinear(d3.extent(vals), [H - mb, 12]).nice();
    svg.append('g').attr('transform', `translate(${ml},0)`).call(d3.axisLeft(y).ticks(6).tickSize(-(W - ml - mr))).call(styleAxis).call(g => g.select('.domain').remove());
    svg.append('g').attr('transform', `translate(0,${H - mb})`).call(d3.axisBottom(x).ticks(Math.max(4, Math.floor(W / 80))).tickFormat(d => d + ' km')).call(styleAxis);
    [[3.3, 'B｜C 界'], [12.2, '治理界點(約)']].forEach(([d, t]) => { svg.append('line').attr('x1', x(d)).attr('x2', x(d)).attr('y1', 12).attr('y2', H - mb).attr('stroke', 'var(--cds-chart-reference)').attr('stroke-dasharray', '4 3'); svg.append('text').attr('x', x(d) + 4).attr('y', 22).attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--ms-fs-chart)').text(t); });
    ser.forEach(([k, , col], i) => {
      const line = d3.line().defined(r => r[k] != null).x(r => x(r.dist_km)).y(r => y(r[k]));
      const p = svg.append('path').datum(rows).attr('d', line).attr('fill', 'none').attr('stroke', col).attr('stroke-width', k === 'd260914' ? 4 : 2.4).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      const L = p.node().getTotalLength();
      p.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L).transition().delay(i * 160).duration(DUR * 1.6).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0).on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
    });
    const rule = svg.append('line').attr('y1', 12).attr('y2', H - mb).attr('stroke', 'var(--color-fg)').attr('stroke-width', 1.5).attr('opacity', 0).style('pointer-events', 'none');
    const dots = ser.map(([k, , col]) => svg.append('circle').attr('r', 5.5).attr('fill', col).attr('stroke', 'var(--color-panel)').attr('stroke-width', 2).attr('opacity', 0).style('pointer-events', 'none'));
    const labs = ser.map(([k, , col]) => svg.append('text').attr('fill', col).attr('stroke', 'var(--color-panel)').attr('stroke-width', 5).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).style('font-variant-numeric', 'tabular-nums').attr('opacity', 0).style('pointer-events', 'none'));
    const kmTag = svg.append('text').attr('y', H - mb + 30).attr('text-anchor', 'middle').attr('fill', 'var(--color-fg)').attr('stroke', 'var(--color-panel)').attr('stroke-width', 5).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).attr('opacity', 0).style('pointer-events', 'none');
    const sg = d3.format('+,.1f');
    svg.append('rect').attr('x', ml).attr('y', 12).attr('width', W - ml - mr).attr('height', H - mb - 12).attr('fill', 'transparent').style('cursor', 'crosshair')
      .on('mousemove', ev => {
        const [mx] = d3.pointer(ev); const d = x.invert(mx); const r = rows[d3.minIndex(rows, q => Math.abs(q.dist_km - d))];
        rule.attr('x1', x(r.dist_km)).attr('x2', x(r.dist_km)).attr('opacity', 1);
        kmTag.attr('x', Math.min(W - 40, Math.max(40, x(r.dist_km)))).attr('opacity', 1).text(`距殘壩頂 ${r.dist_km.toFixed(1)} km`);
        ser.forEach(([k], i) => { if (r[k] != null) dots[i].attr('cx', x(r.dist_km)).attr('cy', y(r[k])).attr('opacity', 1); else dots[i].attr('opacity', 0); });
        const vis = ser.map(([k], i) => ({ i, k, y: r[k] == null ? null : y(r[k]) })).filter(o => o.y != null).sort((a, b) => a.y - b.y);
        for (let q = 1; q < vis.length; q++) if (vis[q].y - vis[q - 1].y < 17) vis[q].y = vis[q - 1].y + 17;
        const right = x(r.dist_km) < (W - ml) * .72;
        labs.forEach(l => l.attr('opacity', 0));
        vis.forEach(o => labs[o.i].attr('x', x(r.dist_km) + (right ? 12 : -12)).attr('y', o.y).attr('dy', '.35em').attr('text-anchor', right ? 'start' : 'end').attr('opacity', 1).text(`${d3.format(',.1f')(r[o.k])} m`));
        const b0 = r.d250925;
        showTip(ev, [['t', `距殘壩頂 ${r.dist_km.toFixed(1)} km`], ...ser.filter(s => r[s[0]] != null).map(s => [null, `${s[1]}　${d3.format(',.1f')(r[s[0]])} m` + (s[0] !== 'd250925' && b0 != null ? `（較 2025/9/25 ${sg(r[s[0]] - b0)} m）` : ''), s[2]])]);
      })
      .on('mouseleave', () => { rule.attr('opacity', 0); kmTag.attr('opacity', 0); dots.forEach(d => d.attr('opacity', 0)); labs.forEach(l => l.attr('opacity', 0)); hideTip(); });
    legend(ser.map(s => [s[1], s[2]]));
  }

  function drawBudget(svg, W, H) {
    const all = dash.data('budget').data;
    const rows = all.filter(r => r.part !== 'A 崩積區 流失' && r.part !== 'B 殘壩區 流失');
    const A = all.find(r => r.part === 'A 崩積區 流失'), Bq = all.find(r => r.part === 'B 殘壩區 流失');
    const cols = [css('--cds-chart-status-critical'), dash.colors[0], dash.colors[2], css('--cds-chart-muted')];
    const ml = measure(svg, rows.map(r => r.part)) * 1.3 + 16, mr = measure(svg, rows.map(r => `${fmt(r.value)}（${r.share}）`)) * 1.4 + 16;
    const y = d3.scaleBand(rows.map(r => r.part), [14, H - 14]).padding(.3);
    const x = d3.scaleLinear([0, d3.max(rows, r => r.value)], [ml, W - mr]);
    const bh = Math.min(64, y.bandwidth());
    const aCol = dash.colors[3], bCol = css('--cds-chart-status-critical');
    rows.forEach((r, i) => {
      const yy = y(r.part) + (y.bandwidth() - bh) / 2;
      svg.append('text').attr('x', ml - 10).attr('y', yy + bh / 2).attr('dy', '.35em').attr('text-anchor', 'end').attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).text(r.part);
      if (i === 0 && A && Bq) {
        const wa = x(A.value) - ml, wb = x(Bq.value) - ml;
        [[Bq, 0, wb, bCol, 'B 殘壩區'], [A, wb, wa, aCol, 'A 崩積區']].forEach(([q, off, w, col, nm], k) => {
          const rect = svg.append('rect').attr('x', ml + off).attr('y', yy).attr('height', bh).attr('fill', col).attr('stroke', 'var(--color-panel)').attr('stroke-width', 2).attr('width', 0).attr('rx', 3)
            .on('mousemove', ev => showTip(ev, [['t', nm + ' 流失'], [null, `${fmt(q.value)} 萬 m³（占 A+B 的 ${q.share}）`, col]])).on('mouseleave', hideTip);
          rect.transition().delay(k * 150).duration(DUR).ease(d3.easeCubicOut).attr('width', w);
          const lab = svg.append('text').attr('x', ml + off + w / 2).attr('y', yy + bh / 2).attr('dy', '.35em').attr('text-anchor', 'middle').attr('fill', '#fff').attr('stroke', 'rgba(0,0,0,.5)').attr('stroke-width', 3).attr('paint-order', 'stroke').style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).style('pointer-events', 'none').attr('opacity', 0);
          if (nm.startsWith('B')) lab.text(`B 殘壩區　${fmt(q.value)}（${q.share}）`);
          lab.transition().delay(DUR * .8).duration(300).attr('opacity', w > 150 ? 1 : 0);
        });
        // A label sits outside above the tiny segment
        svg.append('text').attr('x', ml + wb + wa / 2).attr('y', yy - 8).attr('text-anchor', 'middle').attr('fill', aCol).style('font-size', 'var(--ms-fs-chart)').style('font-weight', 800).text(`A 崩積區　${fmt(A.value)}（${A.share}）`);
      } else {
        svg.append('rect').attr('x', ml).attr('y', yy).attr('height', bh).attr('rx', 4).attr('fill', cols[i]).attr('width', 0)
          .on('mousemove', ev => showTip(ev, [['t', r.part], [null, `${fmt(r.value)} 萬 m³（${r.share}）`, cols[i]]])).on('mouseleave', hideTip)
          .transition().delay(i * 150).duration(DUR).ease(d3.easeCubicOut).attr('width', Math.max(3, x(r.value) - ml));
      }
      svg.append('text').attr('x', x(r.value) + 8).attr('y', yy + bh / 2).attr('dy', '.35em').attr('fill', 'var(--color-fg)').style('font-size', 'var(--ms-fs-chart-lg)').style('font-weight', 800).style('font-variant-numeric', 'tabular-nums').text(`${fmt(r.value)}（${r.share}）`).attr('opacity', 0).transition().delay(i * 150 + DUR * .7).attr('opacity', 1);
    });
    legend([['A 崩積區', aCol], ['B 殘壩區', bCol], ['留在 C 區河道', dash.colors[0]], ['留在 D 界點下游河床', dash.colors[2]], ['流出治理範圍', css('--cds-chart-muted')]]);
  }

  const DRAW = { rates: drawRates, cumul: drawCumul, profile: drawProfile, budget: drawBudget };

  function renderStep(step) {
    const m = META[step];
    chart = document.getElementById('chart-' + step); legendEl = document.getElementById('legend-' + step);
    if (!chart) return;
    tip = chart.querySelector('.ms-tip'); if (!tip) { tip = document.createElement('div'); tip.className = 'ms-tip'; chart.appendChild(tip); }
    const st = m.src.map(id => dash.data(id).status);
    d3.select(chart).selectAll('svg, .ms-fail').remove(); hideTip();
    if (st.some(s => s === 'error')) { chart.classList.remove('dash-skeleton'); const f = document.createElement('div'); f.className = 'ms-fail'; f.textContent = 'Failed to load'; chart.appendChild(f); legend([]); return; }
    if (!st.every(s => s === 'ok') || !seen[step]) { chart.classList.add('dash-skeleton'); legend([]); return; }
    chart.classList.remove('dash-skeleton');
    const W0 = Math.max(280, chart.clientWidth);
    const H = Math.round(Math.min(540, Math.max(W0 < 520 ? 320 : 380, W0 * .42)));
    const { svg, W } = svgBox(H);
    DRAW[step](svg, W, H);
  }
  function render() { STEPS.forEach(renderStep); }

  function fillText() {
    const z = dash.data('zones'), r = dash.data('b_rate'), b = dash.data('budget'), cu = dash.data('cumul'), pr = dash.data('profile');
    const set = (sel, v) => document.querySelectorAll(sel).forEach(el => { el.textContent = v; });
    const zr = name => (z.data || []).find(q => q.zone === name);
    if (z.status === 'ok') {
      ['A 崩積區', 'B 殘壩區', 'C 治理界點以上河道'].forEach(n => set(`[data-source="zones"][data-field="dem_since_breach"][data-where="zone=${n}"]`, sgn(zr(n).dem_since_breach)));
      const B = zr('B 殘壩區'), C = zr('C 治理界點以上河道');
      document.getElementById('takeaway').textContent = `潰決一年來，殘壩區流失 ${fmt(-B.dem_since_breach)} 萬 m³、中游河道淤積 ${fmt(C.dem_since_breach)} 萬 m³；殘壩下切已減緩，但河床持續淤高，治理重點應移到中游河道。`;
    }
    if (r.status === 'ok') r.data.forEach(q => set(`[data-source="b_rate"][data-where="period=${q.period}"]`, q.rate));
    if (b.status === 'ok') b.data.forEach(q => { set(`[data-source="budget"][data-field="share"][data-where="part=${q.part}"]`, q.share); set(`[data-source="budget"][data-field="value"][data-where="part=${q.part}"]`, fmt(q.value)); });
    if (cu.status === 'ok') { const l = cu.data[cu.data.length - 1]; set('[data-source="cumul"][data-field="B"]', sgn(l.B)); set('[data-source="cumul"][data-field="C"]', sgn(l.C)); }
    if (pr.status === 'ok') pr.data.forEach(q => ['d250816', 'd250925', 'd260914'].forEach(f => set(`[data-source="profile"][data-field="${f}"][data-where="dist_km=${q.dist_km}"]`, q[f] == null ? '—' : d3.format(',.1f')(q[f]))));
    document.querySelectorAll('.ms-kpi .num').forEach(el => { if (el.querySelector('span').textContent !== '—') el.classList.remove('dash-skeleton'); });
    const kb = document.getElementById('k-b'); kb.className = 'bad';
    const kc = document.getElementById('k-c'); kc.className = 'warn';
    const ka = document.getElementById('k-a'); if (ka) ka.className = 'bad';
  }

  STEPS.forEach(s => { const c = document.getElementById('chap-' + s); if (!c) return; c.querySelector('.c-title').textContent = META[s].t; c.querySelector('.c-note').textContent = META[s].n; });
  function hero() {
    const sat = dash.data('satellite'); const h = document.querySelector('#hero .ms-hero-bg');
    if (h && sat.status === 'ok' && !h.dataset.img) { h.dataset.img = '1'; h.style.backgroundImage = `url(${sat.data[0].data_url})`; }
  }
  function fillProfileTable() {
    const t = dash.data('profile_tbl'); const tb = document.querySelector('#pf-table tbody'); if (!tb || t.status !== 'ok') return;
    tb.replaceChildren();
    const f1 = v => (v == null || v === '' ? '—' : d3.format(',.1f')(Number(v)));
    t.data.forEach(r => {
      const tr = document.createElement('tr');
      ['km', 'd250816', 'd250925', 'd251013', 'd260314', 'd260914', 'chg'].forEach((c, i) => {
        const td = document.createElement('td');
        if (c === 'km') td.textContent = r.km;
        else if (c === 'chg') { td.textContent = r.chg == null ? '—' : d3.format('+,.1f')(Number(r.chg)); if (r.chg != null) td.className = Number(r.chg) < 0 ? 'neg' : 'pos'; }
        else td.textContent = f1(r[c]);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }
  dash.onData(() => { fillText(); fillProfileTable(); hero(); render(); });

  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const s = e.target.dataset.step;
    if (!seen[s]) { seen[s] = true; renderStep(s); }
    dash.setLink(e.target.id);
  }), { root: document, rootMargin: '0px 0px -12% 0px' });
  STEPS.forEach(s => { const c = document.getElementById('chap-' + s); if (c) io.observe(c); });
  const rv = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.remove('pre'); rv.unobserve(e.target); } }), { root: document, rootMargin: '0px 0px -6% 0px' });
  if (!reduce) document.querySelectorAll('.reveal').forEach((el, i) => { if (i > 1) { el.classList.add('pre'); rv.observe(el); } });

  const named = document.getElementById(location.hash.slice(1));
  if (named) named.scrollIntoView();
})();
