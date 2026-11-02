# Card

Anatomy: surface container, optional header, body.

```html
<section class="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
  <p class="text-sm text-tertiary">Requests today</p>
  <p class="mt-md text-heading-xs font-semibold text-primary">1.24M</p>
</section>
```

- Default surface `bg-primary` + `border-secondary`; grouped/quiet regions
  `bg-secondary`. Padding `p-xl`–`p-2xl`. Radius `rounded-xl`.
- Elevate only when useful (`shadow-xs`). No gradients, glows, giant
  illustrations, or **nested cards** — group with dividers, columns, or a subtle
  surface change instead.
