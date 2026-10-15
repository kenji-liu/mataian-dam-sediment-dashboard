/* Standalone runtime: provides the small `dash` API the page scripts expect (data(), calc(), onData(), colors). */
(function () {
  const FILES = {"locator": "locator.json", "geo": "geopts.json", "zoneinfo": "zoneinfo.json", "satellite": "satellite.json", "mapgrid": "mapgrid.json", "periods": "periods.json", "treemap": "treemap.json", "radar": "radar.json", "venn": "venn.json", "zones": "zones.json", "profile": "profile.json", "persist": "persist.json"};
  const store = {}, cbs = [];
  window.dash = {
    colors: ['#2e6fd8', '#e8a317', '#1fa774', '#c47ad8', '#e5484d', '#7a8794', '#14b8c4', '#a8641e'],
    data: (id) => store[id] !== undefined ? { status: 'ok', data: store[id], columns: [] } : { status: 'missing', data: [] },
    calc: (id, o) => { store[id] = o.fn(...o.inputs.map(i => store[i])); },
    loader: () => {}, onData: (fn) => { cbs.push(fn); fn(); }, setLink: () => {}, params: () => ({}), setParams: () => {}, resetParams: () => {}, refresh: () => {}
  };
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => cbs.forEach(f => f()), 150); });
  const status = document.getElementById('boot-status');
  Promise.all(Object.entries(FILES).map(([id, f]) => fetch('data/' + f).then(r => { if (!r.ok) throw new Error(f); return r.json(); }).then(d => { store[id] = d; })))
    .then(() => ['story', 'spatial', 'locator'].reduce((p, n) => p.then(() => new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/' + n + '.js'; s.onload = res; s.onerror = () => rej(new Error(n)); document.body.appendChild(s); })), Promise.resolve()))
    .then(() => { if (status) status.remove(); })
    .catch(e => { if (status) status.textContent = '資料載入失敗：' + e.message + '（請用 http 伺服器或 GitHub Pages 開啟，不要直接雙擊檔案）'; });
})();
