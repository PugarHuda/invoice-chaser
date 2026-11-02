# Foundations

The token roles and how to reach for them. Everything here names **roles and
classes** — look up concrete values in `tokens/mapping.md`, and never
invent a hex or an arbitrary `[…]` value.

## Identity

Tatum product UI is a precision canvas: quiet, exact, compact-comfortable, built
for repeated operational use. It should feel closer to a production workbench
than a showpiece. Structure and density lead; brand shows through restraint.

Component structure and density follow **Untitled UI anatomy** — for a
component this manual has no recipe for, borrow Untitled UI's geometry,
accessibility behavior, and sizing rhythm, then swap the colors to these
token roles.

## Color is semantic

Use **role** classes, not swatches. Each role carries a light **and** a dark
value, so reaching for the role gives correct dark mode automatically.

| Role | Class | Use |
| --- | --- | --- |
| Page / canvas, default card | `bg-primary` | Dominant reading surface |
| Hovered canvas/control | `bg-primary-hover` | Secondary-button and control hover |
| Grouped / quiet region | `bg-secondary` | Cards-in-context, table headers |
| Hovered grouped surface | `bg-secondary-hover` | Table row and menu-item hover |
| Subtle raised surface | `bg-tertiary` | Nested panels, skeleton/track fills |
| Inverted solid surface | `bg-primary-solid` | Tooltips, dark chips (dark in both themes) |
| Backdrop scrim | `bg-overlay` | Modal/drawer overlay (pair with `opacity-70`) |
| Primary text | `text-primary` | Titles, key values |
| Secondary text | `text-secondary` | Body, labels |
| Tertiary text | `text-tertiary` | Helper copy, metadata |
| Quaternary text | `text-quaternary` | Lowest-emphasis text |
| Text on brand fill | `text-primary-on-brand` | Labels on `bg-brand-solid` |
| Placeholder | `text-placeholder` | Input placeholder text |
| Disabled text | `text-disabled` | Labels in disabled controls |
| Disabled surface | `bg-disabled-subtle` | Disabled control fills |
| Strong border | `border-primary` | Inputs, cards, strong dividers |
| Soft border | `border-secondary` | Row dividers, separators |
| Brand action fill | `bg-brand-solid` | Primary CTA |
| Brand action hover | `bg-brand-solid-hover` | Primary CTA hover |
| Brand text | `text-brand-primary` | Links, selected text, emphasis |
| Brand outline | `border-brand` | Selected/emphasised outline |
| Focus ring | `ring-focus-ring` | Keyboard focus |
| Error focus ring | `ring-focus-ring-error` | Keyboard focus on invalid controls |

### Icon colors

Icons have their own foreground family — don't color them with text roles:

- `text-fg-quaternary` — the default utility-icon color.
- `text-fg-primary` / `text-fg-secondary` / `text-fg-tertiary` — icon emphasis
  hierarchy when an icon must read stronger.
- `text-fg-brand-primary` — brand-emphasised icons.
- `text-fg-{error,warning,success}-primary` — status icons.
- `text-fg-disabled` — icons in disabled controls.
- `text-fg-white` — icons sitting on solid brand/status fills.

### Brand color

Brand purple is for primary actions, selected states, focused controls, and
explicit brand emphasis — **not** general decoration, every icon, or every
hover. Know where the hue actually lives: `bg-brand-solid`, `border-brand`, and
`text-fg-brand-primary` stay purple in **both** themes; `text-brand-primary`
(links, selected text) is purple in light but **neutralizes to near-white in
dark** — the role is emphasis, not the hue. Don't build anything that assumes
purple link text in dark mode.

### Status color

Use the status roles for meaning, and never color alone — always pair with a
label or icon:

- `success` — healthy, enabled, delivered, complete.
- `warning` — degraded, attention, approaching a limit.
- `error` — failed, invalid, destructive, blocked.
- neutral (`text-tertiary`/`text-quaternary`) — metadata, informational, unknown.
- brand — selected / product-owned, **not** a generic status.

Each status has:

- a **text role** (`text-error-primary`, …) and an **icon role**
  (`text-fg-error-primary`, …) for accents;
- **surface roles** `bg-{status}-primary` and `bg-{status}-secondary`. Both are
  theme-asymmetric: pale tints in light, **saturated solids** in dark (the
  `-secondary` one a step deeper). No single text pairing sits safely on them in
  both themes, so treat them as deliberate fills with per-theme pairing — for
  callouts and alerts, the theme-safe default is a **neutral surface with a
  colored icon/title accent** (see `components/alert.md`);
- an **error border** (`border-error-subtle`) for invalid inputs and outlined
  callouts, plus `ring-focus-ring-error` for focus on invalid controls.

### The tinted utility scale

Badges and alerts don't use the roles above — they use the **theme-aware
tinted scale**: `utility-{gray,brand,success,warning,error}-{50,200,600,700}`,
valid behind any color prefix (`bg-`, `text-`, `border-`). The grammar:
`-50` is the tinted surface, `-200` the tinted border, `-600`/`-700` the
accent text sitting on the tint (alerts use 600, badges 700). These tints stay
tints in dark (deep, muted versions) — they're the safe way to put color
behind text.

## Typography

### Typeface

Tatum's typeface is **Poppins**. It ships as the `font-sans` token
(`--font-family-sans`), so the default sans class *is* the brand font — set it
once on the document root and never override it with another family. Don't
substitute Inter, Roboto, Arial, or a novelty display face.

- **Package-free consumers:** `tokens.css` defines the family but does not
  bundle the font files — load Poppins yourself (Google Fonts or self-hosted)
  and the token resolves correctly.
- **Code and technical metadata** (addresses, endpoints, IDs) use a monospace
  face — Geist Mono in current product surfaces. Not yet a token; pick your
  platform's mono stack and keep it consistent.

### Sizes and weights

- **Body sizes:** `text-xs` (captions, dense metadata), `text-sm` (controls,
  table cells, dense body), `text-md` (default readable body), `text-lg`
  (larger descriptions, modal body).
- **In-between:** `text-xl` — dense page headings where the heading scale is
  too large.
- **Headings:** `text-heading-xs` (default dashboard page title, card hero
  value) up through `text-heading-2xl` for display. Product UI mostly lives at
  `text-heading-xs`; larger headings are for docs and marketing.
- **Weights:** `font-regular` body, `font-medium` control text and table
  emphasis, `font-semibold` headings and important values, `font-bold`
  sparingly — don't shout in dashboard surfaces.

Each `text-*` size ships its paired line-height automatically.

## Spacing and density

Spacing is a **named scale**, not arbitrary values. Use it for padding, gaps,
and margins:

- Tightest control insets: `p-xs`, `p-sm`.
- Comfortable control padding: `p-lg`.
- Default card / container padding: `p-xl`; roomy cards `p-2xl`.
- Section padding and gaps between major regions: `p-3xl`, `gap-3xl`, `p-4xl`.
- Marketing / editorial rhythm: `p-5xl` and up.
- Control gaps: `gap-sm`–`gap-lg`. Header action groups: `gap-lg`.

Keep dashboards compact and calm; don't over-space product screens like landing
pages.

## Radius

Corner radius is a named scale — match the component pattern, don't sharpen or
soften by eye:

- `rounded-sm` — compact controls.
- `rounded-md` — inputs, badges, tooltips, menu items, compact controls.
- `rounded-lg` — buttons, dialogs/modals, floating menus.
- `rounded-xl` — cards, tables, panels, alerts, drawers, and large surfaces.
- `rounded-full` — pills, avatars, circular controls.

## Elevation

Tatum is mostly flat — prefer a border plus a surface change over a shadow.

- Resting cards: border only, or `shadow-xs` when a slight lift helps.
- Raised interactive surfaces: `shadow-sm`–`shadow-md`.
- Overlays that float above the document (menus, popovers, dropdowns):
  `shadow-lg`; drawers `shadow-xl`; modals `shadow-2xl`.
- Don't add heavy shadows to make static cards feel designed.

## Motion

Motion is feedback, not decoration. There are no duration tokens yet, so these
ranges are the convention:

- Base controls: 100–150ms state feedback <!-- lint-ok: durations have no token yet -->
  on background, border, color, and opacity.
- Overlays, drawers, modals, popovers: 180–240ms <!-- lint-ok: durations have no token yet -->
  enter/exit; prefer opacity and transform.
- Easing: ease-out on enter, ease-in on exit; your framework's standard curve
  is fine. Like durations, easing has no token yet — convention, not values to
  invent per component.
- Respect reduced-motion preferences.
- Avoid decorative animation in dashboard chrome.

## Looking up values

When you need the concrete value — or aren't sure a class exists — read
`tokens/mapping.md`: it lists every role → class → CSS variable → light
value → dark value → intent. Package-free consumers resolve everything from
there and `tokens/tokens.css`. Do not guess values or reach past the
vocabulary; if something seems missing, it's a token request, not an arbitrary
value.
