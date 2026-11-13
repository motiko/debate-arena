# Astro + Svelte web Venue with an enforced quality bar

Debates are public, shareable content, so SEO and load time on mobile and slow connections matter most. The web Venue is built with Astro (server-rendered HTML on Cloudflare Workers, JavaScript only for interactive islands) and Svelte 5 for the islands (live Turn stream, voting, Debate setup), rather than a React-based framework, whose runtime cost hurts first load on slow devices. Svelte's compile-time accessibility warnings also support the accessibility bar.

## Quality bar

From the first release, every page must meet:

- Lighthouse Performance ≥ 90, SEO 100 and Accessibility 100, measured as a mid-range phone on slow 4G.
- WCAG 2.2 AA, including keyboard-only use, screen-reader announcement of live Turns and vote changes, and reduced motion.

A pull request that drops a key page (home, Debate page, live Debate) below the bar, or fails the axe accessibility tests, cannot merge. Automated checks are complemented by manual keyboard and screen-reader passes, since tools catch only part of WCAG.

## Considered Options

- **React Router v7 / Next.js**: large ecosystem, but React's runtime is too heavy for the load-time goal.
- **Solid / Preact islands**: fast, but Solid lacks built-in accessibility linting and Preact is larger and slower than Svelte.
