# Pagination

Anatomy: a footer row under a table/list — page context + prev/next.

```html
<div class="flex items-center justify-between border-t border-secondary px-3xl py-md">
  <p class="text-sm text-tertiary">Page 1 of 12</p>
  <div class="flex gap-sm">
    <button class="rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Previous</button>
    <button class="rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Next</button>
  </div>
</div>
```

- Sits inside the table container on a `border-secondary` divider; page context
  `text-sm text-tertiary`; controls are secondary buttons.
- Tatum tables paginate by default — include this row whenever a table is
  longer than one small page; disable (don't hide) prev/next at the ends.
