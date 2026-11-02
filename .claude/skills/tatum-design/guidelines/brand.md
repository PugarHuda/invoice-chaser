# Brand

Logo, brand color meaning, and imagery/icon style. File-level asset rules and
the manifest live in `assets/assets.md`; this page is the design-level intent.

## Logo

- Use the supplied files (`assets/logo/`): the **wordmark** — a light file
  (`tatum-wordmark.svg`, black letterforms) and a dark file
  (`tatum-wordmark-dark.svg`, near-white letterforms) — and the **standalone
  mark**. Pick the wordmark file that matches the active theme; the letterform
  color is baked into each file — don't recolor it to the surrounding text
  color. The mark's brand colors are fixed and identical in both files; never
  recolor or reconstruct any part by hand.
- Keep clear space around the logo at least equal to the height of the logo
  mark; nothing intrudes.
- Prefer the logo against `bg-primary` or `bg-secondary`. Over imagery, place it
  on a solid neutral or brand panel so contrast holds.
- Drop to the standalone mark rather than shrinking the wordmark past
  readability.

## Brand color meaning

Brand purple is Tatum's signal of **action and ownership**, not a decorative
accent:

- `bg-brand-solid` — the primary action fill; purple in both themes. One
  primary action per decision area.
- `text-brand-primary` — links, selected text, tab selection, and deliberate
  brand emphasis. Purple in light; **neutralizes to near-white in dark** — the
  role is emphasis, not the hue.
- `text-fg-brand-primary` — brand-emphasised icons; purple in both themes.
- `border-brand` — selected or brand-emphasised outlines; purple in both
  themes.

Do **not** use brand color as a general background, for every icon, for every
hover, or as chart confetti. Its meaning dilutes the more it's sprinkled.

Neutrals (`bg-*`, `text-*`, `border-*` primary/secondary/tertiary) carry the
bulk of the interface. Status colors carry state. Brand carries action. Keeping
those jobs separate is what makes the UI read as Tatum.

## Imagery

- Favor clean, purposeful imagery over decorative filler. Product screens rarely
  need illustration; when they do, it should clarify, not ornament.
- Keep imagery calm enough that foreground text and controls stay legible. Place
  content on a solid surface (`bg-primary`/`bg-secondary`) rather than directly
  over busy images.
- No gradient blobs, glows, or glassmorphism as default decoration.
- Chain/network logos, payment marks, and other third-party brand assets are
  **content, not chrome**: use the real assets in their own colors, never
  recolor them to Tatum roles, and keep the surrounding chrome tokenized
  (`patterns.md` → When explicit values are allowed).

## Icon style

- Tatum uses the **Untitled UI icon set** — line-first, consistent stroke
  weight, geometric. The free set is sufficient. Where Untitled UI isn't
  available, **Lucide** is an acceptable open alternative with matching line
  anatomy — but don't mix the two families in one surface.
- Color icons with the foreground roles, not text roles:
  `text-fg-quaternary` is the default utility-icon color; raise through
  `text-fg-tertiary`/`text-fg-secondary` when an icon must read stronger;
  status icons take `text-fg-{error,warning,success}-primary`; icons on solid
  fills take `text-fg-white`.
- Sizing rhythm: `size-4` in dense rows and inputs, `size-5` for default app
  chrome, `size-6` for feature/empty-state icons.
- Decorative icons are hidden from assistive tech; meaningful icons get an
  accessible label. Never rely on an icon (or color) alone to convey state.
- Don't introduce off-family or novelty icons for ordinary actions, status, or
  navigation, and don't hand-draw one-off SVGs for common concepts.

Exact icon components and import mechanics belong to the `tds/` sub-guide; this
manual governs how brand elements should look and read.
