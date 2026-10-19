// panes.js — the plot area as 1, 2 or 4 windows, each showing its own view.
// Each pane owns a canvas, a tooltip and a slot for non-canvas content;
// main.js decides what to draw in it. Shared between nanovna-web and
// tinysa-web: the storage key and the default views are parameters.
// SPDX-License-Identifier: GPL-2.0-only

/**
 * createPanes(container, views, onChange, { key, defaults })
 *   views:    { key: label } — what a pane can show
 *   onChange: called after any layout or view change
 *   key:      localStorage key for the remembered layout
 *   defaults: the view each pane starts with (index = pane number)
 * Returns { panes, layout, setLayout(n), viewOf(i), setView(i, key) }.
 */
export function createPanes(container, views, onChange, { key = 'panes', defaults = [] } = {}) {
  const first = Object.keys(views)[0];
  const st = { layout: 1, views: [0, 1, 2, 3].map(i => views[defaults[i]] ? defaults[i] : first), panes: [] };
  try { const s = JSON.parse(localStorage.getItem(key) || 'null'); if (s && [1, 2, 4].includes(s.layout) && Array.isArray(s.views)) { st.layout = s.layout; st.views = [0, 1, 2, 3].map(i => views[s.views[i]] ? s.views[i] : st.views[i]); } } catch {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify({ layout: st.layout, views: st.views })); } catch {} };

  function build(initial) {
    container.innerHTML = ''; container.dataset.layout = st.layout; st.panes = [];
    for (let i = 0; i < st.layout; i++) {
      const el = document.createElement('section'); el.className = 'pane'; el.dataset.pane = i;
      const head = document.createElement('div'); head.className = 'pane-head';
      const tabs = document.createElement('div'); tabs.className = 'views'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', `Window ${i + 1} view`);
      const body = document.createElement('div'); body.className = 'chart-wrap'; body.dataset.view = st.views[i];
      for (const [k, label] of Object.entries(views)) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.dataset.view = k; b.textContent = label;
        b.setAttribute('aria-pressed', String(st.views[i] === k));
        b.addEventListener('click', () => setView(i, k));
        tabs.appendChild(b);
      }
      head.appendChild(tabs);
      const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'plot');
      const tip = document.createElement('div'); tip.className = 'tip';
      const slot = document.createElement('div'); slot.className = 'pane-slot';      // non-canvas content (a meter panel)
      body.append(canvas, tip, slot); el.append(head, body); container.appendChild(el);
      st.panes.push({ i, el, head, body, canvas, tip, slot, get view() { return st.views[i]; } });
    }
    if (!initial) onChange();
  }
  function setView(i, k) {
    if (!views[k] || !st.panes[i]) return;
    st.views[i] = k;
    st.panes[i].head.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.view === k)));
    st.panes[i].body.dataset.view = k;
    save(); onChange();
  }
  function setLayout(n) { if (![1, 2, 4].includes(n)) return; st.layout = n; save(); build(); }
  build(true);
  return { get panes() { return st.panes; }, get layout() { return st.layout; }, setLayout, setView, viewOf: i => st.views[i] };
}
