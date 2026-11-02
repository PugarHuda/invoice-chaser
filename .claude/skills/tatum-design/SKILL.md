---
name: tatum-design
description: Tatum's brand and visual-design system plus its React component library (TDS, @tatum-io/tatum-design-system). Covers design tokens (color, type, spacing, radius, elevation), logo and brand basics, and layout grammar for building anything that should look Tatum — dashboards, product UI, websites, docs — in any stack, with or without the component package. Use for visual language, tokens, layout, brand and logo rules, and turning raw hex/px mockups into Tatum tokens. Ships light and dark token values as CSS variables and Tailwind classes so it works package-free. When the package is installed and you're writing React, it also covers operating the component library — component selection, exact APIs, install, and Tailwind-merge setup (see the tds/ sub-guide). Apply proactively for UI in a TDS-consuming project even when unmentioned — add a modal, build a settings page, implement this figma design, add a form field, make a table. Composes with any available Figma skill.
---

# Tatum design manual

The stack-agnostic authority for what Tatum looks like: the tokens, the visual
language, the layout grammar, and the brand basics. Everything here is designed
to work **with or without** the React component package — the token values ship
inside this skill as CSS variables and Tailwind classes.

**This file is the vocabulary and the index, not the component manual.** It
carries every class name that exists, the state set, and the geometry rules under
"Build rules" — enough to get a styled shell on screen and to never write a class
that does not resolve.

How a component is actually built is a file per component under
`guidelines/components/`, and page composition and cross-cutting patterns are
their own files. **Open one for every component you put on screen.** A real page
is five to fifteen of them, and reading them is the job, not an optional extra: a
screen built without them has the right colours on the wrong shapes. "Which file
to open" is the index.

## Two rules that govern everything here

1. **One source of values.** Concrete values (hex, px, shadows) live only in
   `tokens/` (and the generated `DESIGN.md` frontmatter). They are
   generated from the token source (in the source workspace) — never hand-edited.
2. **Prose names tokens, never values.** Guidelines, recipes, and brand rules
   refer to token **roles and class names** (`bg-primary`, `rounded-md`,
   `text-heading-xs`) — never raw hex, px, rgb, arbitrary `[…]` values, or
   generic Tailwind color scales (`bg-gray-<n>` and the like). Lint gates in
   the manual's source workspace enforce this.

## Pick your path first

**Writing React in a repo that already has `@tatum-io/tatum-design-system`?**
Read **`tds/README.md`** — it routes you to the published TDS package guide
(component-first selection, exact prop discovery, install/setup, the
Tailwind-merge setup, Figma→TDS translation) and carries an offline
fallback. Use the guidelines here for the *visual language*: layout
grammar, brand rules, token roles, and dark-mode behavior. Do **not** load this
skill's `tokens/tailwind.tokens.js` in that repo — the package's own
Tailwind plugin already defines these classes; loading both double-defines them.
The semantic color classes are identical either way, and the package also
exposes the clean spacing/radius/type class names the guidelines use (as
value-identical twins of its long-standing `tatum-*` classes), so recipes here
read correctly against the package.

**Building package-free** (a plain site, a document, another stack, a prototype)?
This skill is self-sufficient. Consume the tokens directly:
- `tokens/tokens.css` — CSS variables for light (`:root`) and dark
  (`[data-theme="dark"]` / `.dark`). Load it and you have the palette.
- `tokens/tailwind.tokens.js` — a Tailwind v3.4+ `theme.extend` giving the
  clean classes (`bg-primary`, `p-xl`, `rounded-md`, `text-heading-xs`).
- `tokens/mapping.md` — the resolver: each token's role → class → CSS var →
  light value → dark value → intent. Use it to look up any value by hand.

## The vocabulary, in full

**These lists are complete and closed.** A name that is not on them does not
exist, emits no CSS, and renders as nothing — no colour, no padding, default
size — with no error anywhere. Do not extend a list by analogy; look it up.

| Property | Prefix | Every name that exists |
| --- | --- | --- |
| Background | `bg-` | `primary` `primary-hover` `primary-solid` `secondary` `secondary-hover` `tertiary` `overlay` `brand-solid` `brand-solid-hover` `error-primary` `warning-primary` `success-primary` `error-secondary` `warning-secondary` `success-secondary` `disabled-subtle` |
| Text | `text-` | `primary` `secondary` `tertiary` `quaternary` `primary-on-brand` `placeholder` `disabled` `brand-primary` `error-primary` `warning-primary` `success-primary` |
| Icon foreground | `text-` | `fg-primary` `fg-secondary` `fg-tertiary` `fg-quaternary` `fg-quaternary-hover` `fg-brand-primary` `fg-error-primary` `fg-warning-primary` `fg-success-primary` `fg-disabled` `fg-white` |
| Border | `border-` | `primary` `secondary` `brand` `error-subtle` |
| Focus ring | `ring-` | `focus-ring` `focus-ring-error` |
| Spacing | `p- px- py- pt- pr- pb- pl- m- mx- my- mt- mr- mb- ml- gap- gap-x- gap-y- space-x- space-y-` | `none` `xxs` `xs` `sm` `md` `md-lg` `lg` `lg-xl` `xl` `2xl` `3xl` `4xl` `5xl` `6xl` `7xl` `8xl` `9xl` `10xl` `11xl` |
| Radius | `rounded-` | `none` `xxs` `xs` `sm` `md` `lg` `xl` `2xl` `3xl` `4xl` `full` |
| Type | `text-` | `xs` `sm` `md` `lg` `xl` `heading-xs` `heading-sm` `heading-md` `heading-lg` `heading-xl` `heading-2xl` |
| Weight | `font-` | `regular` `medium` `semibold` `bold` |
| Elevation | `shadow-` | `xs` `sm` `md` `lg` `xl` `2xl` `3xl` `inner` |
| Typeface | `font-` | `sans` (Poppins) |
| Tints — badges, alerts, chips | `bg- border- text-` | `utility-<family>-<step>` where family is `gray` `brand` `success` `warning` `error` and step is `50` (surface) `200` (border) `600`/`700` (text on that surface) |

**Reach for a tint whenever you want a "subtle coloured surface".** A badge, a
chip, a status pill, an inline alert: `bg-utility-brand-50` +
`border-utility-brand-200` + `text-utility-brand-700`, and the same shape in
gray, success, warning or error. These are theme-aware, so they stay correct in
dark mode. This is the row people miss, and missing it is what leads to a
transparency modifier on a solid role (see the opacity note below) — that
renders as nothing, where the tint renders as intended.

**The lists are deliberately not parallel, and that is where classes die.** Each
of these is a real name on one row and nothing on another:

- `error-secondary` / `success-secondary` / `warning-secondary` are
  **backgrounds only**. A border in an error state is `border-error-subtle` —
  there is no `border-error-secondary`, and no border role for success or
  warning at all. Carry the state on the background and the text instead.
- `fg-*` belongs to **text and icons only**. `bg-fg-success-primary` is not a
  darker variant of anything; it is nothing.
- Brand text is `text-brand-primary`. There is no `text-brand-secondary`.
- The focus ring is `ring-focus-ring` (or `ring-focus-ring-error`). Not
  `ring-brand`, not `ring-brand-primary`.
- Body type stops at `text-xl`, headings start at `text-heading-xs`. There is
  no display scale: `text-display-*`, `text-2xl`, `text-3xl` and `text-base`
  are not part of this system. For anything larger than body text, reach for a
  `heading-` size.
- **No opacity modifier — this is the most common way to kill a class here.**
  These colours are `var(--…)` strings, not channel values, so `bg-brand-solid/10`,
  `bg-secondary/40`, `border-primary/50` and every other `/<n>` form produces
  nothing at all. When you catch yourself wanting one you almost always want a
  **tint**: `bg-utility-brand-50` instead of `bg-brand-solid/10`. Otherwise use
  the role that already means it (`bg-overlay` for a scrim, `bg-disabled-subtle`
  for a muted control), or put `opacity-*` on the element.
- **A variant is a `:` prefix, not a word.** `placeholder:text-placeholder`,
  `hover:bg-primary-hover`, `focus:ring-focus-ring`. Written as
  `placeholder-text-placeholder` it is one unknown name and renders as nothing.
- Spacing, radius, type and elevation are **named, never numeric**. `p-4`,
  `gap-6`, `rounded-2xl`-as-Tailwind and `text-sm`-as-Tailwind all *resolve*,
  which is worse than failing: they render plausibly at the wrong value.
  Purely structural sizing (`size-5` on an icon, `w-full`, `max-w-3xl`,
  `min-h-screen`, grid and flex utilities) stays on the framework's own
  utilities — that is not part of this vocabulary and needs no token.

If a role you want is genuinely absent, it is absent by design. Compose from
what is on the table rather than inventing a name, and if you still cannot
express it, look it up in `tokens/mapping.md`.

## Which file to open

Match what you are building to a row and open that file, once the first screen is
up and before you call the work done — not earlier, because it costs time on
screen. **This table is the index.** The `<skill_files>` list you were handed is
sampled and shows about ten of thirty-odd files, so most of these never appear in
it. Do not conclude a file is absent because it is not in that list; the paths
here are real.

**Read each file whole.** They are small on purpose — a component recipe is
15-35 lines. Reading part of one gets you a component built half to spec.

| What you are putting on the screen | Open |
| --- | --- |
| anything clickable that performs an action | `guidelines/components/button.md` |
| somewhere to type — a search box, an address field, a form input, with its label and error text | `guidelines/components/input.md` |
| a bordered panel grouping related content — a summary tile, a stat, a section container | `guidelines/components/card.md` |
| a short status pill or label — verified, active, failed, a count, a tag | `guidelines/components/badge.md` |
| rows and columns of data — a list of holdings, transactions, tokens | `guidelines/components/table.md` |
| a value over time, a trend, price history, a sparkline, a graph, a plot | `guidelines/components/charts.md` |
| something that interrupts — a modal, an overlay, a confirm step | `guidelines/components/dialog.md` |
| switching between views inside one panel | `guidelines/components/tabs.md` |
| a message that needs attention in place — success, warning, error banner | `guidelines/components/alert.md` |
| a transient confirmation that appears then disappears | `guidelines/components/toast.md` |
| a loading placeholder that has to hold the layout still | `guidelines/components/skeleton.md` |
| more rows than fit, page controls, next/previous | `guidelines/components/pagination.md` |
| how far along something is — a percentage, a quota, a filling bar | `guidelines/components/progress-bar.md` |
| an on/off setting | `guidelines/components/switch.md` |
| pick exactly one from a few | `guidelines/components/radio-group.md` |
| pick several, or accept terms | `guidelines/components/checkbox.md` |
| pick one from a long list, a dropdown input | `guidelines/components/select.md` |
| actions behind a button — an overflow or kebab menu | `guidelines/components/dropdown-menu.md` |
| explaining an icon or a truncated value on hover | `guidelines/components/tooltip.md` |
| a decorative icon in an empty state or feature callout | `guidelines/components/featured-icon.md` |
| a product or dashboard page — app shell, sidebar, nav, page header, section rhythm | `guidelines/layout-dashboard.md` |
| a landing page, hero, pricing or feature section, footer | `guidelines/layout-marketing.md` |
| dark mode, hover/focus/disabled/loading/empty/error states, responsive rules, accessibility | `guidelines/patterns.md` |
| a whole page start to finish, or you want a worked example to adapt | `guidelines/examples.md` |
| a logo, icon choice, imagery, or what a brand colour means | `guidelines/brand.md`, then `assets/assets.md` |
| a raw value, because the target has no Tailwind (a doc, an email, another stack) | `tokens/mapping.md`, `tokens/tokens.css` |
| React in a repo with `@tatum-io/tatum-design-system` | `tds/README.md` |

`DESIGN.md` is a shareable one-page summary — light-only and
**non-authoritative**, for interop and handoff. Build tasks follow this file and
the guidelines, never that one.

## The state set

Every interactive component carries these, and none of them should shift layout:

`default` · `hover` · `focus` (keyboard) · `active/selected` · `disabled` ·
`loading` · and, where the component owns data, `empty` and `error`.

Focus is always a visible ring: `focus-visible:ring-2 focus-visible:ring-focus-ring`.
It lives here rather than in each recipe because every component assumes it.

## Build rules

Colour is a lookup; **geometry is a contract**. Most of what reads as sloppy in
a generated screen is geometry, not palette — controls in a row that don't line
up, an icon at the wrong size, padding that silently did nothing.

**1. Know your target before you write a class.** These names only exist where
something defines them:

| target | what to do |
| --- | --- |
| A repo with `@tatum-io/tatum-design-system` | Use TDS components; don't hand-roll a control the package ships. The unprefixed twins (`p-xl`, `text-md`) need a recent TDS — confirm one resolves before relying on them. |
| A Tailwind project loading `tokens/tailwind.tokens.js` | The recipes work verbatim. |
| Anywhere else — a plain page, another stack, a sandboxed preview | **None of these class names exist.** Load `tokens/tokens.css` (self-contained, no external references) and use the CSS-variable form in `examples.md`. |

A class that doesn't resolve fails **silently** — no padding, no colour, default
size. Worse, a few names (`rounded-md`, `rounded-lg`, `text-xs`) also exist in
plain Tailwind at *different* values, so they render plausibly and wrongly. If
you can compile or inspect, confirm your classes emit something; if you can't,
use the variable form. A sandboxed page may also be unable to fetch Poppins —
`font-sans` then falls back, which is a known limit to state, not to paper over
with a substitute family.

**2. Height is arithmetic, not taste.** A control's height is its vertical
padding twice, plus its line-height, plus its border twice. Before writing a row
of controls, state those parts for each one and confirm they agree. They can
only disagree if the padding, the type size, or the border differs.

**3. Every control carries a border — filled ones included.** Put
`border border-transparent` on a solid button. A borderless control is shorter
than its bordered neighbour by exactly two edges. If a project uses an inset
ring for control outlines instead, use that on every control and never mix the
two — an inset ring and a focus ring occupy the same property and will fight.

**4. Align a row by its anatomy.** Use `items-center` when every child is a bare
control; `items-end` when a labelled field sits beside a bare one, because the
label makes that column taller; `items-stretch` for attached groups. State it —
don't leave the default, which quietly equalises mismatched controls so the row
looks right until something changes. Link-styled buttons, icon-only row actions,
badges and avatars are exempt: they align to a neighbour's text, not its box.

**5. Size the icon, not a wrapper.** Width and height don't apply to an inline
element, and an icon carrying its own dimensions overflows a correctly sized box
anyway — so put the size on the icon itself. In React with an icon component,
pass its size prop rather than a class. Give every icon `shrink-0`, and in
repeated rows give the icon slot a fixed width so columns line up across rows.
Match the icon to its control: the small size in dense rows and inputs, the
default in ordinary chrome, the large one for feature and empty-state icons.

<!-- GENERATED ARTIFACT — do not edit this copy. It is built from the tatum-design source workspace (prose + generated token values) and copied here; direct edits are overwritten on the next build. -->
