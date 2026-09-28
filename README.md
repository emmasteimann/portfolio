# goose-portfolio

Portfolio site for Goose Steimann. Vite + Three.js, no framework.

- `npm run dev`: local server at http://localhost:5173 (`?crt` zooms the hero into the desk CRT and exposes `__hero.frame(t)` for tuning the shader)
- `npm run build`: static site in `dist/`, deployable anywhere (GitHub Pages, Netlify, Cloudflare Pages)

Hero: `src/hero.js`, one fragment shader over the studio illustration (lamp flicker, ON AIR pulse, star twinkle, dust, parallax, and a ray-marched slime on the CRT).
Case studies live in `projects/`. Media is in `public/media` (compressed with ffmpeg, CRF 27, 1280 wide max).
