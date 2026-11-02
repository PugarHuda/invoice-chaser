# Select

Anatomy: input-shaped trigger + the dropdown-menu surface.

```html
<button class="flex w-full items-center justify-between gap-sm rounded-md bg-primary px-lg py-sm text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring">
  Ethereum mainnet
  <svg class="size-4 shrink-0 text-fg-quaternary" aria-hidden="true"><!-- chevron icon --></svg>
</button>
<!-- open state reuses the Dropdown menu recipe for the floating list -->
```

- The trigger reads as an input: `bg-primary` + `border-primary` +
  `rounded-md`; the chevron is `text-fg-quaternary`; the value is
  `text-primary`, or `text-placeholder` while empty.
- The open list is the Dropdown menu recipe; the selected option gets
  `text-brand-primary` and/or a leading check mark.
- States as everywhere: error `border-error-subtle` +
  `focus-visible:ring-focus-ring-error`; disabled `bg-disabled-subtle` +
  `text-disabled`.
- Use a Select for one-of-many past ~5 options; below that, prefer a radio
  group so the choices stay visible.
