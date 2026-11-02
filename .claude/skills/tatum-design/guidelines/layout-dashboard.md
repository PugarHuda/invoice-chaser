# Dashboard layout

Product/dashboard surfaces are operational: compact, scannable, stable, calm.
The user should understand where they are, what changed, what needs attention,
and what the next action is — without reading marketing copy. Cross-surface
rules (states, dark mode, accessibility, don'ts) live in `patterns.md`;
component recipes in `components/`.

## Default hierarchy

Every product screen reads in this order:

1. App shell / route context.
2. Page header and the primary action.
3. Controls that affect the content directly below them.
4. Summary cards or key readouts.
5. Tables, logs, charts, detail drawers, secondary panels.
6. Toasts/inline feedback — as confirmation only, never the only visible
   state change.

## App shell

Product screens sit inside a stable shell — don't rebuild the frame per screen:

- Left sidebar or a responsive collapsed rail; collapsed navigation preserves
  accessible labels/tooltips.
- Optional top/header region where the route uses one.
- A padded main content container: comfortable side padding (`p-xl` mobile,
  `p-4xl` desktop) and `gap-3xl`–`gap-4xl` between major sections.

Surfaces layer with `bg-primary` (canvas), `bg-secondary` (grouped regions),
and `border-secondary` (separators). Keep the layering shallow.

## Page header

Title, optional description, and the primary action for the screen:

```html
<header class="flex flex-col gap-lg border-b border-secondary bg-primary p-xl lg:flex-row lg:items-start lg:justify-between">
  <div class="min-w-0">
    <h1 class="text-heading-xs font-semibold text-primary">RPC Gateway</h1>
    <p class="mt-xs text-sm text-tertiary">Monitor gateway usage and routing health.</p>
  </div>
  <div class="flex flex-wrap gap-lg">…actions…</div>
</header>
```

- Title `text-heading-xs` for primary route titles; `text-xl` for dense nested
  pages. Description `text-sm text-tertiary`.
- One primary action per decision area; right-side actions wrap on mobile.
- Keep titles specific and product-first, not campaign copy.

## Surface archetypes

Use a small set of repeated layouts:

**Overview page:** header → optional filter/control bar → 2–4 metric cards or
key readouts → the primary table/log/list → secondary insight only when
actionable.

**Detail page:** breadcrumbs or a back affordance → a header card with the
entity's identity, status, and actions → tabs for major contexts → two-column
composition when inspection benefits from summary + table → a sticky/save
footer for long edit flows.

**Create/edit flow:** a stepper or clearly scoped sections, grouped by the
user's mental model (not the API's shape) → footer actions pinned when the form
is long → disabled/loading/error states preserved without changing the layout
footprint.

**Observability/logs page:** the verdict or issue summary first when the screen
is about diagnosis → filters directly above the affected table/stream → rows
comfortable and consistent in height — taller than a compact list row → a detail drawer for
row drilldown rather than navigating away per row.

## Filter bars

Filters sit directly above the data they affect — never detached.

- Horizontal row on desktop; wraps on medium widths; moves into a drawer or
  stacked groups on small widths when filters exceed the row.
- Search inputs carry a leading icon (`size-4`/`size-5 text-fg-quaternary`).
- Don't let filters scroll horizontally unless the whole table already does.

## Tables and logs in the layout

The table recipe is in the skill's SKILL.md; placing it well:

- Container `rounded-xl` + `border-secondary`, overflow hidden; wide tables get
  a sensible min width and scroll horizontally **inside** their container.
- Header row is sticky (`sticky top-0` on the header with `bg-secondary`) so
  dense lists stay scannable.
- Technical identifiers — addresses, endpoints, IDs — use the monospace face
  (`font-mono`) when it improves scanning.
- Row actions collapse into an action menu (labeled trigger) instead of a row
  of inline icon buttons; destructive actions separated inside the menu.
- Truncate long values (with the full value accessible) rather than letting
  wrapping change row heights.
- Tatum tables paginate by default with a small page size — budget for the
  pagination row (`components/pagination.md`) in the layout.

## Drawers and side panels

For detail inspection, row drilldown, edit forms, and advanced filters — when
the user should keep their route context. Use a modal instead only for blocking
decisions.

```html
<aside class="flex h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-secondary bg-primary shadow-xl">
  <header class="flex items-start justify-between gap-lg border-b border-secondary p-xl">
    <div>
      <h2 class="text-lg font-semibold text-primary">Gateway details</h2>
      <p class="mt-xs text-sm text-tertiary">Inspect routing, limits, and recent activity.</p>
    </div>
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto p-xl">…</div>
  <footer class="flex justify-end gap-sm border-t border-secondary p-xl">…</footer>
</aside>
```

- Surface `bg-primary`, `rounded-xl` when floating, `shadow-xl` above the
  document (modals use `shadow-2xl`).
- Header compact; body scrolls; footer pinned for long forms; the close control
  has an accessible label.
- Keep the source row selected/visible while its drawer is open — don't hide
  the relationship.

## Responsive behavior

- Content never clips or overlaps at mobile widths.
- Header actions wrap below the title.
- Wide tables scroll horizontally inside their own rounded container.
- Card grids collapse to a single column; filter rows wrap or move into a
  drawer.

## Dashboard don'ts

- Don't build marketing heroes or campaign copy into dashboard surfaces.
- Don't over-space product screens like landing pages — dashboards are compact.
- Don't make every card interactive when only one area is actionable.
- Don't bury filters far from the table/list they affect.
- Don't navigate away for every row when a drawer preserves context.
