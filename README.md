# goose-portfolio

Portfolio site for Goose Steimann. Vite + Three.js, no framework.

- `npm run dev`: local server at http://localhost:5173 (`?crt` zooms the hero into the desk CRT and exposes `__hero.frame(t)` for tuning the shader)
- `npm run build`: static site in `dist/`, deployable anywhere (GitHub Pages, Netlify, Cloudflare Pages)

Hero: `src/hero.js`, one fragment shader over the studio illustration (lamp flicker, ON AIR pulse, star twinkle, dust, parallax, and a ray-marched slime on the CRT).
Playground: `src/playground.js`, a shape-matching soft body (23 particles, JS) ray-marched as metaballs, with debug views and dynamic resolution. `?debug` loads it immediately and exposes `__pg.run(seconds)` for stepping and grabbing frames when the tab can't animate.
Case studies live in `projects/`. Media is in `public/media` (compressed with ffmpeg, CRF 27, 1280 wide max).
