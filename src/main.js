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
