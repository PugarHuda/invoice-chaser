# Toast

Anatomy: a small floating confirmation, stacked in a screen corner.

```html
<div class="flex items-start gap-sm rounded-lg border border-secondary bg-primary p-lg shadow-lg">
  <svg class="mt-xxs size-4 shrink-0 text-fg-success-primary" aria-hidden="true"><!-- status icon --></svg>
  <p class="text-sm text-secondary">Gateway created.</p>
</div>
```

- Quiet floating panel: `bg-primary` + `border-secondary` + `shadow-lg`,
  `rounded-lg`. Status is carried by the icon
  (`text-fg-success-primary` / `text-fg-error-primary` / `text-fg-warning-primary`).
- Copy confirms the interaction in a few words ("Gateway created", "Failed to
  save route") — a toast is confirmation, **never the only evidence** that data
  changed (see `patterns.md`).
- Success toasts auto-dismiss; error toasts persist until dismissed and offer a
  retry/recover path when one exists. Don't stack more than a few — collapse or
  drop the oldest.
