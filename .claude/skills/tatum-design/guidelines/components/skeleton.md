# Skeleton

Anatomy: a pulsing placeholder that reserves the final layout.

```html
<div class="h-4 w-full animate-pulse rounded-xs bg-tertiary"></div>
```

- `bg-tertiary` + `animate-pulse` + `rounded-xs` — quiet, no bright shimmer.
- Skeletons **preserve the final dimensions** of what they stand in for (the
  state model depends on this); sketch the real shape — a text line, an avatar
  circle, a card block — not a generic gray box.
