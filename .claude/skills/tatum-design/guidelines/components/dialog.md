# Dialog / Modal

Anatomy: overlay + centered panel with header, scrollable body, pinned footer.

```html
<div class="fixed inset-0 bg-overlay opacity-70"></div>
<div class="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg bg-primary shadow-2xl">
  <header class="flex items-start justify-between gap-lg border-b border-secondary p-xl">
    <h2 class="text-lg font-semibold text-primary">Delete gateway</h2>
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto p-xl text-sm text-secondary">…</div>
  <footer class="flex justify-end gap-sm border-t border-secondary p-xl">…</footer>
</div>
```

- Backdrop: `bg-overlay` at `opacity-70` — never an invented black scrim.
- Panel: `bg-primary`, `rounded-lg`, `shadow-2xl` above the document.
- Header compact; body scrolls; footer pinned. Close control has an accessible
  label. Use a modal for blocking decisions; use a drawer for inspection that
  should preserve route context (drawer recipe: `layout-dashboard.md` →
  Drawers and side panels).
