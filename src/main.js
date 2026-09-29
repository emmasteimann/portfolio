// Debug-view pills: a row of buttons that each set a view index on a renderer.
export function bindViewSwitch(el, setView) {
  el.hidden = false;
  el.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-view]');
    if (!button) return;
    el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    setView(Number(button.dataset.view));
  });
}

// Three.js only loads on pages that use it.
const stage = document.querySelector('.hero-stage');
if (stage) {
  import('./hero.js').then(({ initHero }) => initHero(stage, {
    onReady: ({ setView }) => {
      const pills = document.querySelector('.view-switch[data-target="hero"]');
      if (pills) bindViewSwitch(pills, setView);
    },
  }));
}

// Play looping clips only while they're on screen.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const videos = document.querySelectorAll('video[data-autoplay]');
if (!reducedMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) {
        target.play().catch(() => {});
      } else {
        target.pause();
      }
    }
  }, { threshold: 0.25 });
  videos.forEach((v) => observer.observe(v));
}

// Nav gets a backdrop once the page scrolls past the top.
const nav = document.querySelector('.nav');
const onScroll = () => nav?.classList.toggle('is-scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Shadertoy refuses to be framed on other sites, so "Run live" opens the shader there.
document.querySelectorAll('.shader-card').forEach((card) => {
  card.querySelector('.shader-play')?.addEventListener('click', () => {
    window.open(`https://www.shadertoy.com/view/${card.dataset.shader}`, '_blank', 'noopener');
  });
});

// Playground: loads when it's about to scroll into view.
const playground = document.querySelector('.playground');
if (playground) {
  const start = () => import('./playground.js').then(({ initPlayground }) => {
    const stats = playground.querySelector('.playground-stats');
    const api = initPlayground(playground, {
      onStats: ({ particles, simMs, width, height, fps }) => {
        stats.textContent = `${particles} particles · sim ${simMs.toFixed(2)} ms · ${width}×${height} · ${fps} fps`;
      },
    });
    if (!api) return;
    bindViewSwitch(playground.querySelector('.view-switch'), api.setView);
    playground.querySelector('[data-action="squish"]').addEventListener('click', api.squish);
    playground.querySelector('[data-action="jump"]').addEventListener('click', api.jump);
  });
  if (new URLSearchParams(location.search).has('debug')) {
    start();
  } else {
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { io.disconnect(); start(); }
    }, { rootMargin: '400px' });
    io.observe(playground);
  }
}
