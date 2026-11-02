# Marketing layout

Website, landing pages, hero/header sections, acquisition and docs-marketing
surfaces. Marketing uses the **same tokens, typeface, and brand assets** as
product UI — what changes is the composition: more spacious, more image-led,
larger type. It must still feel precise and systemized; every rule in
`patterns.md` applies in full. Don't apply marketing composition to
repeated-use dashboard screens (see `layout-dashboard.md`).

## Principle

Tatum marketing = systemized structure + Tatum tokens + real Tatum assets.
Avoid generic SaaS slop: vague purple gradients, glass blobs, random cards, and
interchangeable copy blocks.

> **Dark/inverted marketing sections** (the deep-navy panels on the website)
> are part of the brand but not yet expressible in this token set — there is
> no navy surface role. Treat them as a pending design-system token request;
> don't approximate with near-black neutrals or invented values.

## Rhythm and typography

- Sections breathe with the large end of the spacing scale (`py-7xl` and up).
- Hero headings use the display sizes: `text-heading-md` on mobile up to
  `text-heading-xl` on desktop. Section headings `text-heading-xs` to
  `text-heading-md`, by density.
- Hero body copy: `text-lg`–`text-xl` with `text-tertiary`; dense sections drop
  to `text-sm`/`text-md`. Keep copy columns readable (roughly 60–70
  characters), not full-bleed.
- Keep Poppins (`font-sans`). Don't add a novelty display face.

## Header navigation

A contained row: `mx-auto` with `px-xl` mobile, `lg:px-4xl` desktop.

- The theme-aware Tatum wordmark (`assets/logo/`) on the left.
- A few short nav labels — Products, Pricing, Resources, About — styled
  `text-sm font-semibold text-secondary`; a chevron icon (not a custom mark)
  for dropdown affordances.
- Auth actions on the right: one secondary login + one primary signup.
- Mobile: collapse to a labeled menu button with the expanded state announced;
  nav and actions stack full-width.

## Hero (split) pattern

The default Tatum hero/header section:

1. Marketing header above.
2. Two columns on desktop: copy and CTA/form left, artwork right; mobile
   stacks copy first.
3. Optional announcement badge above the heading.
4. Primary CTA or email capture directly under the body copy.
5. Artwork sits in a contained frame (`rounded-2xl`, bordered) — real product
   or brand imagery, never a gradient blob.

Full markup in `examples.md` → Marketing hero.

## Announcement badges

More expressive than dashboard badges, still tokenized:

- Outer pill: `rounded-full border border-secondary bg-primary shadow-xs`.
- Label: `text-xs font-medium text-secondary`.
- Dot: `bg-brand-solid`.
- Trailing arrow icon: `size-4 text-fg-quaternary`.

For hiring, changelog, launch, or event news — not on every hero.

## Imagery

- Use real Tatum product imagery or controlled brand assets; images sit inside
  clear frames and don't become random decoration.
- Keep the surrounding UI neutral enough that the asset carries the visual
  moment.
- Meaningful `alt` text unless the image is purely decorative.

## CTA and forms

- One primary CTA per hero/section (`bg-brand-solid` +
  `text-primary-on-brand`); supporting actions are secondary or link-styled.
- Email capture: input + primary button, horizontal on desktop, stacked and
  full-width on mobile for tap targets.
- Privacy/helper text: `text-xs`–`text-sm text-tertiary`, with accessible link
  focus.

## Marketing ↔ dashboard boundary

Marketing **may** use: larger whitespace, display headings, image-led
composition, announcement badges, more narrative copy.

Marketing must **not** use: raw hex or arbitrary values, untokenized
shadow/radius/spacing, custom buttons/inputs/nav when a recipe exists, generic
gradient/glass effects detached from real Tatum assets, or dashboard
tables/cards as decoration.

And dashboards must not borrow marketing composition — that boundary runs both
ways.
