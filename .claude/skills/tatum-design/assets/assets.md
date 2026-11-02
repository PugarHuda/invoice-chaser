# Brand assets

The file manifest for Tatum brand assets. **Usage rules** (logo clear space,
minimum size, placement, icon style and coloring) live in
`guidelines/brand.md` — this page tracks the files themselves.

> Assets are the one place raw files live inside the manual. Everything else is
> tokens (values) or prose (roles). Keep binaries small, versioned, and named
> for what they are.

## Manifest

| Path | What it holds | Status |
| --- | --- | --- |
| `logo/tatum-wordmark.svg` | Full Tatum wordmark for **light** surfaces: mark + black letterforms | ready |
| `logo/tatum-wordmark-dark.svg` | Full Tatum wordmark for **dark** surfaces: mark + near-white letterforms | ready |
| `logo/tatum-mark.svg` | Standalone Tatum mark (brand colors only, theme-independent) | ready |
| favicon | Browser favicon derived from the mark | stub — todo |
| social/OG image | Link-preview/share image template | stub — todo |

Icon files are **not** stored in the manual — consume the Untitled UI set (or
Lucide) directly, per the rules in `guidelines/brand.md`.

When adding an asset, add its row here with the concrete filename and a
one-line description. The manifest is the index of record — an asset not listed
here is not part of the brand set.

## File mechanics

- `tatum-wordmark.svg` / `tatum-wordmark-dark.svg`: two files, one per theme.
  The letterforms are a fixed color baked into each file — black on the light
  file, near-white on the dark file. Pick the file that matches the active
  theme; don't recolor by hand. The brand mark's fills are identical in both
  files and never re-themed.
- `tatum-mark.svg`: fixed brand colors; reads on both light and dark
  backgrounds, so it needs no per-theme variant.
