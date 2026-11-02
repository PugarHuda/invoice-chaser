---
# GENERATED — do not edit. Light-only values from the DTCG token source.
# Dark values live in tokens/mapping.md. Regenerated from the source workspace.
name: "Tatum"
description: "Tatum brand & visual design — light-theme token summary."
colors:
  primary: "#4832e7"
  text-primary: "#181d27"
  text-secondary: "#414651"
  text-tertiary: "#535862"
  text-quaternary: "#717680"
  text-primary-on-brand: "#ffffff"
  text-placeholder: "#717680"
  text-disabled: "#717680"
  text-brand-primary: "#4f37fd"
  text-error-primary: "#d92d20"
  text-warning-primary: "#dc6803"
  text-success-primary: "#079455"
  fg-primary: "#181d27"
  fg-secondary: "#414651"
  fg-tertiary: "#535862"
  fg-quaternary: "#717680"
  fg-quaternary-hover: "#535862"
  fg-brand-primary: "#4f37fd"
  fg-error-primary: "#d92d20"
  fg-warning-primary: "#dc6803"
  fg-success-primary: "#079455"
  fg-disabled: "#a4a7ae"
  fg-white: "#ffffff"
  bg-primary: "#ffffff"
  bg-primary-hover: "#fafafa"
  bg-primary-solid: "#0a0d12"
  bg-secondary: "#fafafa"
  bg-secondary-hover: "#f5f5f5"
  bg-tertiary: "#f5f5f5"
  bg-overlay: "#0a0d12"
  bg-brand-solid: "#4832e7"
  bg-brand-solid-hover: "#402dce"
  bg-error-primary: "#fef3f2"
  bg-warning-primary: "#fffaeb"
  bg-success-primary: "#ecfdf3"
  bg-error-secondary: "#fee4e2"
  bg-warning-secondary: "#fef0c7"
  bg-success-secondary: "#dcfae6"
  bg-disabled-subtle: "#fafafa"
  border-primary: "#d5d7da"
  border-secondary: "#e9eaeb"
  border-brand: "#4f37fd"
  border-error-subtle: "#fda29b"
  ring-focus-ring: "#4f37fd"
  ring-focus-ring-error: "#f04438"
  utility-gray-50: "#fafafa"
  utility-gray-200: "#e9eaeb"
  utility-gray-600: "#535862"
  utility-gray-700: "#414651"
  utility-brand-50: "#ebeaff"
  utility-brand-200: "#bdb8fe"
  utility-brand-600: "#4832e7"
  utility-brand-700: "#402dce"
  utility-success-50: "#ecfdf3"
  utility-success-200: "#abefc6"
  utility-success-600: "#079455"
  utility-success-700: "#067647"
  utility-warning-50: "#fffaeb"
  utility-warning-200: "#fedf89"
  utility-warning-600: "#dc6803"
  utility-warning-700: "#b54708"
  utility-error-50: "#fef3f2"
  utility-error-200: "#fecdca"
  utility-error-600: "#d92d20"
  utility-error-700: "#b42318"
typography:
  xs:
    fontFamily: "Poppins, sans-serif"
    fontSize: "0.75rem"
    lineHeight: "1.125rem"
  sm:
    fontFamily: "Poppins, sans-serif"
    fontSize: "0.875rem"
    lineHeight: "1.25rem"
  md:
    fontFamily: "Poppins, sans-serif"
    fontSize: "1rem"
    lineHeight: "1.5rem"
  lg:
    fontFamily: "Poppins, sans-serif"
    fontSize: "1.125rem"
    lineHeight: "1.75rem"
  xl:
    fontFamily: "Poppins, sans-serif"
    fontSize: "1.25rem"
    lineHeight: "1.875rem"
  heading-xs:
    fontFamily: "Poppins, sans-serif"
    fontSize: "1.5rem"
    lineHeight: "2rem"
  heading-sm:
    fontFamily: "Poppins, sans-serif"
    fontSize: "1.875rem"
    lineHeight: "2.375rem"
  heading-md:
    fontFamily: "Poppins, sans-serif"
    fontSize: "2.25rem"
    lineHeight: "2.75rem"
  heading-lg:
    fontFamily: "Poppins, sans-serif"
    fontSize: "3rem"
    lineHeight: "3.75rem"
  heading-xl:
    fontFamily: "Poppins, sans-serif"
    fontSize: "3.75rem"
    lineHeight: "4.5rem"
  heading-2xl:
    fontFamily: "Poppins, sans-serif"
    fontSize: "4.5rem"
    lineHeight: "5.625rem"
rounded:
  none: "0rem"
  xxs: "0.125rem"
  xs: "0.25rem"
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.75rem"
  2xl: "1rem"
  3xl: "1.25rem"
  4xl: "1.5rem"
  full: "9999px"
spacing:
  none: "0rem"
  xxs: "0.125rem"
  xs: "0.25rem"
  sm: "0.375rem"
  md: "0.5rem"
  md-lg: "0.625rem"
  lg: "0.75rem"
  lg-xl: "0.875rem"
  xl: "1rem"
  2xl: "1.25rem"
  3xl: "1.5rem"
  4xl: "2rem"
  5xl: "2.5rem"
  6xl: "3rem"
  7xl: "4rem"
  8xl: "5rem"
  9xl: "6rem"
  10xl: "8rem"
  11xl: "10rem"
---

# Tatum — design summary

> **Non-authoritative, light-only.** This one-pager is a shareable summary for
> handoff and interop. The authoritative, dark-aware source is the design
> guidelines (`guidelines/*`) and the generated token outputs
> (`tokens/`). When they disagree, they win. The frontmatter above carries
> **light** values only; dark values live in `tokens/mapping.md`.

## Overview

Tatum's product surfaces are a precision canvas: quiet, exact, and built for
repeated operational use — closer to a workbench than a showpiece. Structure and
density come first; brand shows through restraint, not decoration.

## Colors

Color is **semantic**. Reach for a role, not a swatch:

- Surfaces: `bg-primary` (page/canvas, default card), `bg-secondary` (grouped
  or quiet regions, table headers), `bg-tertiary` (subtle raised surfaces).
- Text: `text-primary` (titles, key values), `text-secondary` (body, labels),
  `text-tertiary` (helper/metadata), `text-quaternary` (lowest emphasis).
- Borders: `border-primary` (inputs, strong dividers), `border-secondary` (row
  dividers, soft separators).
- Brand: `bg-brand-solid` for the primary action fill; `text-brand-primary` for
  links, selected text, and brand emphasis. Brand is for action and emphasis —
  not general decoration.
- Icons: a dedicated foreground family — `text-fg-quaternary` is the default
  utility-icon color, with an emphasis hierarchy, brand, status, and disabled
  variants, and `text-fg-white` for icons on solid fills.
- Status: `success`, `warning`, `error` text and icon roles for accents, and
  the theme-aware **tinted utility scale**
  (`utility-{color}-{50,200,600,700}`) for badges and alert callouts. The plain
  status surface roles are tints in light but saturated solids in dark — use
  the utility tints when text sits on the color. Never rely on color alone —
  pair with a label or icon.
- States: `text-primary-on-brand` on brand fills, `text-placeholder`,
  `text-disabled` + `bg-disabled-subtle`, `border-error-subtle`, and an error
  focus ring.

Every role carries a light and a dark value, so using the role gives correct
dark mode automatically.

## Typography

- The typeface is **Poppins**, shipped as the `font-sans` token
  (`--font-family-sans`). Load the font yourself when consuming package-free;
  a monospace face (Geist Mono in current product surfaces) covers code and
  technical metadata.
- Body sizes: `text-xs` through `text-xl` — `text-md` is the default readable
  body; `text-sm` suits dense controls and table cells.
- Headings: `text-heading-xs` (default dashboard page title) up through
  `text-heading-2xl` for display.
- Weights: `font-regular` body, `font-medium` control text, `font-semibold`
  headings and important values, `font-bold` sparingly.

## Layout

- Product screens sit inside a stable app shell: navigation, an optional header
  region, and a padded main content container.
- Rhythm uses the named spacing scale (`p-xl`, `gap-lg`, and larger steps for
  section separation) — not arbitrary values.
- One primary action per decision area. Filters sit directly above the data
  they affect. Keep layouts scannable and calm.

## Elevation

Tatum is mostly flat — prefer a border plus a surface change over a shadow.
Resting cards use `shadow-xs` at most; overlays that float above the document
(menus, drawers, modals) use `shadow-lg` through `shadow-2xl`. Don't add heavy
shadows to make static cards feel designed.

## Shapes

Corner radius is a named scale: `rounded-md` for inputs, badges, and tooltips,
`rounded-lg` for buttons, dialogs, and floating menus, `rounded-xl` for cards,
tables, and drawers, `rounded-full` for pills and avatars. Match the component
pattern; don't sharpen or soften by eye.

## Components

Core components share one grammar — anatomy, token roles per part, and a full
state set (default, hover, focus, disabled, loading, empty, error). See
`guidelines/components/` for the visual recipes. Exact React props are the
`tds/` sub-guide's job.

## Do's and Don'ts

- **Do** use semantic color roles so dark mode is automatic.
- **Do** use the named spacing, radius, and type scales.
- **Do** carry every state, not just the happy path.
- **Don't** use raw hex, px, rgb, arbitrary `[…]` values, or generic Tailwind
  color scales.
- **Don't** decorate with gradients, glows, or nested cards.
- **Don't** use brand color as general decoration.
