// Floating glass tab bar interaction (phone layout): a highlight pill sits under the active tab; press and hold, slide
// the finger along the bar and the pill follows fluidly; release to switch. A plain tap still switches immediately.

import { h } from './ui.js';

export function initTabbar() {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  const pill = h('span.pill');
  bar.prepend(pill);
  const glass = () => document.documentElement.hasAttribute('data-glass');
  const tabs = () => [...bar.querySelectorAll('a')];
  const tabAt = (x) => tabs().find((a) => { const r = a.getBoundingClientRect(); return x >= r.left && x <= r.right; });

  function place(a, animate = true) {
    if (!glass() || !a) { pill.style.opacity = '0'; return; }
    const r = a.getBoundingClientRect(), b = bar.getBoundingClientRect();
    pill.style.transition = animate ? '' : 'none';
    pill.style.opacity = '1';
    pill.style.left = `${r.left - b.left}px`;
    pill.style.width = `${r.width}px`;
    if (!animate) requestAnimationFrame(() => { pill.style.transition = ''; });
  }
  const sync = (animate = true) => place(bar.querySelector('a.active'), animate);

  let downTab = null, hoverTab = null, dragged = false, suppressClick = false;
  bar.addEventListener('pointerdown', (e) => {
    if (!glass()) return;
    const a = e.target.closest('a'); if (!a) return;
    downTab = a; hoverTab = a; dragged = false;
    bar.classList.add('pressing');
    try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    place(a);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!downTab) return;
    const a = tabAt(e.clientX);
    if (a && a !== hoverTab) { hoverTab = a; dragged = true; place(a); }
  });
  const finish = (e, cancelled) => {
    if (!downTab) return;
    bar.classList.remove('pressing');
    const target = cancelled ? null : (tabAt(e.clientX) || hoverTab);
    downTab = null; hoverTab = null; dragged = false;
    // With pointer capture on the bar the browser delivers the follow-up click to the bar, not to the link (mouse and
    // pen do this; touch may still click the link). So the bar switches the tab itself on release, for taps and
    // slides alike, and swallows the click that may follow.
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    if (target) { const href = target.getAttribute('href'); if (location.hash !== href) location.hash = href; else sync(); }
    else sync();
  };
  bar.addEventListener('pointerup', (e) => finish(e, false));
  bar.addEventListener('pointercancel', (e) => finish(e, true));
  bar.addEventListener('click', (e) => { if (suppressClick) { e.preventDefault(); suppressClick = false; } });
  bar.addEventListener('touchmove', (e) => { if (downTab) e.preventDefault(); }, { passive: false }); // no page scroll while sliding on the bar

  window.addEventListener('hashchange', () => setTimeout(sync, 0));
  window.addEventListener('resize', () => sync(false));
  const obs = new MutationObserver(() => sync(false));
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-glass'] });
  setTimeout(() => sync(false), 0);
}
