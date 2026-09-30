// SlimeLab write-up: the A/B chart, drawn as HTML bars on one scale.
// Measured medians (ms): interleaved A/B in URP; A-B-A-B runs of packaged builds in Unreal.
const rows = [
  { label: 'Unity URP', sub: 'run 1', before: 5.45, after: 3.66 },
  { label: 'Unity URP', sub: 'run 2', before: 5.26, after: 3.64 },
  { label: 'Unreal, Lumen on', sub: 'pass 1', before: 5.51, after: 4.04 },
  { label: 'Unreal, Lumen on', sub: 'pass 2', before: 5.51, after: 4.04 },
];
const max = 6; // axis 0-6 ms

const host = document.getElementById('ab-rows');
const ticks = document.getElementById('ab-ticks');
if (host && ticks) {
  for (const r of rows) {
    const saving = Math.round((1 - r.after / r.before) * 100);
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      `<div class="chart-label">${r.label}<small>${r.sub} · −${saving}%</small></div>` +
      '<div class="track"><div class="bars">' +
      `<div class="bar before" style="width:${(r.before / max) * 100}%"><em>${r.before.toFixed(2)} ms</em></div>` +
      `<div class="bar after" style="width:${(r.after / max) * 100}%"><em>${r.after.toFixed(2)} ms</em></div>` +
      '</div></div>';
    host.appendChild(row);
  }
  for (let t = 0; t <= max; t += 1) {
    const s = document.createElement('span');
    s.style.left = `${(t / max) * 100}%`;
    s.textContent = t + (t === max ? ' ms' : '');
    ticks.appendChild(s);
  }
}
