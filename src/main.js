// Three.js only loads on pages with the hero.
const stage = document.querySelector('.hero-stage');
if (stage) {
  import('./hero.js').then(({ initHero }) => initHero(stage));
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

// Shadertoy embeds load only when asked: each one is a full WebGL context.
document.querySelectorAll('.shader-card').forEach((card) => {
  const button = card.querySelector('.shader-play');
  button?.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.src = `https://www.shadertoy.com/embed/${card.dataset.shader}?gui=true&paused=false&muted=true`;
    frame.title = card.querySelector('h4')?.textContent ?? 'Shader';
    frame.allowFullscreen = true;
    frame.loading = 'lazy';
    button.replaceWith(frame);
  });
});
