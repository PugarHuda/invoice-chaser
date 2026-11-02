# Tabs

Anatomy: a tab list on a baseline divider + one visible panel.

```html
<div class="flex gap-lg border-b border-secondary">
  <button class="border-b-2 border-brand px-md py-sm text-sm font-semibold text-brand-primary">Overview</button>
  <button class="border-b-2 border-transparent px-md py-sm text-sm font-semibold text-tertiary hover:text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring">Logs</button>
</div>
```

- The list sits on `border-secondary`; the selected tab carries
  `text-brand-primary` + a `border-brand` underline; inactive tabs are
  `text-tertiary` with a `hover:text-secondary` lift. Keep the underline
  slot reserved (`border-transparent`) so selection doesn't shift layout.
- Tabs switch **contexts of the same entity** — not sequential steps (that's a
  stepper) and not navigation between routes (that's the nav).
- Keyboard: arrow keys move through the list; the panel is labeled by its tab.
