# Patterns

The cross-surface grammar: the state model every data surface owes, dark mode,
responsive fundamentals, accessibility, and the anti-slop "don'ts". These apply
to **every** surface. Per-surface composition lives in `layout-dashboard.md`
and `layout-marketing.md` (new surfaces add their own `layout-<surface>.md`).

## The state model

Every data-owning surface supports the relevant states, and none of them changes
the layout footprint:

| State | Treatment |
| --- | --- |
| `default` | Fully populated, realistic content |
| `loading` | Skeletons that preserve final dimensions; quiet surfaces, no bright shimmer |
| `empty` | Neutral, helpful message + one next action when the user can resolve it |
| `error` | Specific failure, minimal emphasis (`text-error-primary` accent), a retry/recover action |
| `disabled` | `bg-disabled-subtle` surface / `text-disabled` labels (or `opacity-50`), disabled cursor, preserved layout |
| `permission-limited` | Explain the access limit and the path to resolve it |
| `plan-limited` | Explain the plan gate and offer an upgrade/contact path |
| hover / active / focus | Tokenized surface/text/border change (`hover:bg-secondary-hover`, `focus-visible:ring-2 focus-visible:ring-focus-ring`); no layout jump |

## Dark mode

Dark mode is automatic when you use semantic roles — do **not** hand-code a
second palette. Toggle it by scoping `[data-theme="dark"]` (or `.dark`) on a
container, exactly as `tokens/tokens.css` defines. Every `bg-*`, `text-*`,
`text-fg-*`, `border-*`, and `ring-*` role already carries its dark value. If
you find yourself writing a second color for dark, you've reached past the
vocabulary — use the role instead. Verify against the dark column in
`tokens/mapping.md`.

## Responsive fundamentals

Design mobile-first and enhance upward at the framework's standard breakpoints
(`sm:`, `md:`, `lg:`, `xl:`) — the recipes in this manual use exactly those.
Content never clips or overlaps at mobile widths; interactive targets stay
comfortably tappable. Surface-specific behavior (tables, filter rows, nav
collapse) is covered in the layout files.

## Stacking order

Overlay layers stack in one consistent order, back to front: sticky table
headers → dropdowns/popovers → drawers → modal overlays → toasts → tooltips.
The concrete z-index integers are your project's choice — the ordering isn't.

## Accessibility

- **Contrast comes from the vocabulary.** The semantic pairings in this manual
  (text roles on their intended surfaces) hold up in both themes — inventing
  values or crossing pairings is how contrast breaks. Target WCAG 2.1 AA
  (4.5:1 for body text); treat the lowest-emphasis roles (`text-quaternary`)
  as body-text-unsafe on anything but the neutral surfaces.
- **Keyboard:** every interactive element is reachable and shows a visible
  focus ring (`focus-visible:ring-2 focus-visible:ring-focus-ring`, the error
  variant on invalid controls).
- **Labels:** icon-only buttons and menu triggers carry a specific accessible
  name; decorative icons are hidden from assistive tech.
- **Status:** never color alone — pair with a label or icon.
- **Motion:** respect reduced-motion preferences.

## Anti-slop: the don'ts

- **No raw values in static styling.** No hex, px, rgb, arbitrary `[…]`
  values, or generic Tailwind color scales. Reach for a role; look it up in
  `mapping.md` if unsure. (The allowed cases are defined below.)
- **No decoration for its own sake.** No gradients, glows, glassmorphism, or
  giant illustrations unless a source design requires it.
- **No nested cards.** Group inside a card with dividers, columns, or a subtle
  surface change — not another bordered card.
- **No brand-color spray.** Brand purple marks action and emphasis, not every
  icon, hover, or accent.
- **No color-only status.** Always pair status color with a label or icon.
- **No layout jump between states.** Loading/disabled/error keep the footprint.
- **No toast-only feedback.** A toast confirms; it isn't the only evidence that
  data changed.
- **No composition bleed.** Dashboard screens don't get marketing spacing and
  heroes; marketing pages don't get dashboard tables as decoration.

## When explicit values are allowed

The no-raw-values rule governs **static styling of Tatum's own interface**.
Three questions sort every case:

1. **Did data or measurement produce the value?** Inline it — chart series
   geometry, a progress fill's width, measured popover positions, animated
   transforms. Nobody designed that number; it's computed.
2. **Is it Tatum-owned UI chrome?** Then it must be a token role. A missing
   role is a **token request** to the design system — never an invented value
   or a near-enough neighbor.
3. **Does the color belong to the content?** Third-party brand marks (chain
   and network logos, payment marks), artwork, extra data-visualization
   series, user-chosen label colors — use the real value; forcing it through
   Tatum semantics would be wrong. The rule here is **containment**: the
   foreign color stays inside the content element, and the chrome around it
   (card, borders, labels) stays tokenized. If a contained exception starts
   repeating across screens, that's a pattern — document it or promote it to
   a token request.

## Audit checklist

Before calling a Tatum surface done:

- [ ] Colors, spacing, radius, type, and shadows use semantic roles and the
      named scales — raw values only in the allowed cases above.
- [ ] Every relevant state exists (loading / empty / error / disabled / hover /
      focus) and none of them shifts the layout footprint.
- [ ] One primary action per decision area.
- [ ] Dark mode holds — roles only, verified against `tokens/mapping.md`
      when unsure.
- [ ] Focus rings are visible; icon-only controls have accessible names;
      status is never color alone.
- [ ] Composition matches the surface's layout file — no dashboard/marketing
      bleed in either direction.
- [ ] Controls sharing a row resolve to the same height, and the row states its
      alignment rather than relying on the default.
- [ ] Filled and outlined variants of the same control carry the same border,
      so they measure the same.
- [ ] Icons carry their own size and `shrink-0`; repeated rows use fixed-width
      icon slots so columns align.
- [ ] Every class used actually resolves in the target environment — a name that
      doesn't exist fails silently.
