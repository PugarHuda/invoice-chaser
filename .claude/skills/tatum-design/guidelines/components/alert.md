# Alert

Anatomy: status icon, title, message, optional action.

```html
<div class="flex gap-lg rounded-xl bg-utility-error-50 p-xl">
  <svg class="mt-xxs size-5 shrink-0 text-utility-error-600" aria-hidden="true"><!-- status icon --></svg>
  <div>
    <p class="text-sm font-semibold text-utility-error-600">Could not load gateway logs</p>
    <p class="mt-xxs text-sm text-tertiary">The request timed out. Retry, or narrow the time range.</p>
  </div>
</div>
```

- The Tatum alert is a **tinted callout**: `bg-utility-{color}-50` surface with
  the icon and title in `text-utility-{color}-600`. The utility scale is
  theme-aware, so the tint holds in dark. Families: `error`, `warning`,
  `success`, and `brand` for informational.
- A **neutral variant** (`bg-primary` + `border-secondary` with a
  `text-fg-{status}-primary` icon accent) is the quieter option for inline,
  low-emphasis notices.
- The plain status surfaces (`bg-{status}-primary` / `-secondary`) are tints in
  light but **saturated solids** in dark — don't use them as callout
  backgrounds; that's what the utility tints are for. Reserve status-dominant
  fills for genuinely blocking states.
