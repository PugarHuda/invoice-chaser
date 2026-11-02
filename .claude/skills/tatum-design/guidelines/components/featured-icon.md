# Featured icon

Anatomy: an icon in a soft circular frame — empty states, modal/drawer
headers, status summaries.

```html
<span class="flex size-12 items-center justify-center rounded-full bg-secondary">
  <svg class="size-6 shrink-0 text-fg-secondary" aria-hidden="true"><!-- icon --></svg>
</span>
```

- Sizes: `size-8` (sm, icon `size-4`), `size-10` (md, icon `size-5`),
  `size-12` (lg, icon `size-6`), `size-14` (xl).
- Neutral treatment (`bg-secondary` + `text-fg-secondary`) by default; a status
  version pairs a `bg-utility-{color}-50` frame with
  `text-utility-{color}-600`.
- Don't use oversized icon tiles inside dense dashboard cards.
