# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

This is the live source for **rhxutah.com**, the marketing site for Ridgeline Home Exteriors (siding, seamless gutters, stucco, in-ground drainage, and permanent holiday lighting in Utah County / Salt Lake County). The site is deployed via **GitHub Pages** with a custom domain (`CNAME` → `rhxutah.com`); pushing to `main` publishes directly to production. There is no staging environment.

The repo was originally created by a one-time static export of a WordPress install (see the `Initial site export from WordPress` commit). **There is no WordPress, PHP, database, or CMS running anymore.** `wp-content/`, `wp-includes/`, and `xmlrpc.php` are leftover static asset trees (theme CSS/JS from the Salient theme + WPBakery, uploaded images, Font Awesome fonts) kept only because pages still reference those paths — they are not functional and should not be treated as a live WordPress codebase.

**There is no build system, package manager, linter, or test suite.** Every page is a plain, fully self-contained `index.html` file. "Development" means directly editing HTML/CSS in place, then committing and pushing.

## Repository layout

- `index.html` — homepage.
- `<slug>/index.html` — one directory per page, e.g. `services/`, `contact-us/`, `our-work/`, and the blog-post-style article pages (`maintaining-your-gutters-essential-tips/`, `understanding-soffit-and-fascia-an-essential-guide-for-homeowners/`, etc.). This directory-with-index.html pattern reproduces WordPress's clean-URL permalinks (`/slug/` resolves to `/slug/index.html` on GitHub Pages).
- `wp-content/themes/salient/`, `wp-content/themes/salient-child/`, `wp-content/plugins/*` — static theme CSS/JS and font assets carried over from the WordPress export. Treat as a read-only vendor/asset library; there's no compiler or bundler to run over it.
- `wp-content/uploads/` — image assets (photos, siding color swatches, logos) referenced by pages via absolute `https://rhxutah.com/wp-content/uploads/...` URLs.
- `wp-includes/js/` — a few WordPress core JS files (jquery, a11y/i18n helpers) still referenced by page markup.
- `sitemap.xml` / `robots.txt` — hand-maintained sitemap; `robots.txt` points to it.
- `xmlrpc.php` — static leftover file (WordPress RSD discovery XML), not executable — ignore unless explicitly asked to remove it.

## Working with pages

There is **no shared template, include mechanism, or component system**. Site-wide UI — the main nav menu, footer, the mobile sticky call/quote bar (`#rhx-sticky-cta` near the end of `<body>`), the Google Analytics `gtag` snippet, and the `HomeAndConstructionBusiness` JSON-LD block — is duplicated **verbatim inside every single `index.html`**. When a change needs to apply site-wide (e.g. updating the phone number, a CTA label, a nav link, or the sticky bar), grep for the relevant string across all page directories and edit every occurrence — there is no single source of truth to change once. Past commits do exactly this (e.g. adding the sticky call/quote bar touched all 13 top-level pages in one commit).

Useful search when making a site-wide change:
```bash
grep -rn "Get Your Free Quote Now" --include=index.html .
grep -rln "rhx-sticky-cta" --include=index.html .
```

Key conventions found in existing markup:
- Phone number `(801) 900-3362` / `tel:+18019003362` appears in the sticky bar and CTAs on every page — keep formatting consistent when changing it.
- CTA links point to `#gform_wrapper_1` (the quote form anchor on the Contact page), usually as `https://rhxutah.com/contact-us/#gform_wrapper_1` from other pages or `#gform_wrapper_1` from within `contact-us/index.html` itself.
- The "contact form" markup still uses Gravity Forms class names/IDs (`gform_wrapper`, `gform_1`) for styling compatibility, but the `<form>` actually posts to `https://api.web3forms.com/submit` — a hosted form backend, not WordPress. Don't assume Gravity Forms is functional server-side.
- The icon font situation is fragile: Font Awesome icons (`fa fa-phone`, etc.) work, but the theme's proprietary icomoon glyphs were removed and replaced with plain Unicode fallbacks styled via inline `<style>` overrides (see `.icon-button-arrow:before`, `.icon-salient-search:before` near the end of `index.html`). Don't reintroduce icomoon-only icon classes without also adding a Unicode/Font Awesome fallback, or they'll render as blank boxes again.
- `sitemap.xml` has a `<lastmod>` per URL — bump it (to the current date) when you materially edit a page, and add an entry when you add a new page.

## Verifying changes

There's no build or test command to run. Verify by opening the changed HTML file(s) directly in a browser (or a local static file server, e.g. `python3 -m http.server`) and visually checking the page, especially:
- The change renders correctly at both desktop and mobile widths (the sticky CTA bar only shows below 1000px — see the `@media (min-width: 1000px)` rule near the end of each page).
- If you touched shared UI, confirm you updated it in every page directory, not just one.

## Git workflow

Commits go directly to `main` (no branches/PRs in this repo's history) with descriptive, user-facing commit messages describing the on-site change (e.g. "Add FAQ schema, Licensed & Insured trust line, swap text CTAs for direct form links"). Since pushes to `main` deploy live, double-check edits across all affected pages before committing.
