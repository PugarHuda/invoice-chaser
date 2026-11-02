# Button

Anatomy: label, optional leading/trailing icon, container.

```html
<!-- primary -->
<button class="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50">
  Create gateway
</button>

<!-- secondary -->
<button class="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
  Export
</button>
```

- **Variants:** primary (`bg-brand-solid`, one per decision area), secondary
  (neutral surface + `border-primary`), tertiary (no border/fill; text-only),
  and destructive equivalents (pair with `text-error-primary` /
  `bg-error-primary`).
- **States:** loading keeps footprint (swap label for a spinner, don't resize);
  disabled uses `opacity-50` and a disabled cursor — or, for a filled disabled
  treatment, `bg-disabled-subtle` with `text-disabled`. Button icons on the
  brand fill take `text-fg-white`.
- Don't use brand fill for secondary actions just because they feel important.
