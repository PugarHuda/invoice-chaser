# Table

Anatomy: rounded container, sticky header, rows.

```html
<div class="overflow-hidden rounded-xl border border-secondary bg-primary">
  <table class="w-full">
    <thead class="sticky top-0 z-10 bg-secondary">
      <tr class="border-b border-secondary text-left">
        <th class="px-3xl py-md text-sm font-semibold text-quaternary">Gateway</th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-b border-secondary hover:bg-secondary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
        <td class="px-3xl py-xl text-md text-tertiary">Ethereum mainnet</td>
      </tr>
    </tbody>
  </table>
</div>
```

- Container `rounded-xl` + `border-secondary` + `bg-primary`, overflow hidden.
- Header `bg-secondary`, semibold `text-quaternary`. Rows divided by
  `border-secondary`, hover `bg-secondary-hover`. Default cell text is
  `text-md text-tertiary` with comfortable `px-3xl py-xl` padding (rows land
  taller than compact lists — keep them consistent); the lead cell raises to
  `text-primary font-medium`.
- Tatum tables **paginate by default** with a small page size — plan for the
  pagination row (`pagination.md`) rather than an endless scroll.
- Give wide tables a sensible min width and let them scroll inside their rounded
  container; keep row height stable (truncate rather than wrap unpredictably).
- Placement, density, mono identifiers, and row-action rules:
  `layout-dashboard.md` → Tables and logs.
