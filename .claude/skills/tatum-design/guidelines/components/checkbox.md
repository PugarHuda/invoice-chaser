# Checkbox

Anatomy: box, mark, label, optional hint.

```html
<label class="flex items-start gap-sm">
  <span class="mt-xxs flex size-4 shrink-0 items-center justify-center rounded-xs border border-primary bg-primary focus-visible:ring-2 focus-visible:ring-focus-ring">
    <!-- checked: swap to bg-brand-solid border-brand, with a text-fg-white check icon -->
  </span>
  <span class="flex flex-col gap-xxs">
    <span class="text-sm font-medium text-secondary">Enable request logging</span>
    <span class="text-xs text-tertiary">Stores request metadata for 30 days.</span>
  </span>
</label>
```

- Unchecked: `bg-primary` + `border-primary`, `rounded-xs`, `size-4`.
- Checked: `bg-brand-solid` + `border-brand` with a `text-fg-white` check mark.
- Indeterminate uses the same fill with a dash mark. Disabled:
  `bg-disabled-subtle` + `text-fg-disabled` mark + `text-disabled` label.
- The label is part of the hit area; hint text `text-xs text-tertiary`.
