# Tooltip

Anatomy: small floating label anchored to its trigger.

```html
<div class="rounded-md bg-primary-solid px-lg py-md text-xs font-semibold text-fg-white">
  Copy endpoint URL
</div>
```

- The Tatum tooltip is **inverted**: `bg-primary-solid` (a solid dark surface
  in both themes) with `text-fg-white` and `font-semibold`, `rounded-md`. No
  border, no shadow needed — the inversion is the elevation.
- Keep copy to a few words — a tooltip names, it doesn't explain.
- Tooltips supplement, never replace, an accessible name; don't put essential
  actions or state behind hover alone.
