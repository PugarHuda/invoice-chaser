# Dropdown menu

Anatomy: trigger + floating menu of items.

```html
<div class="min-w-40 rounded-lg border border-secondary bg-primary p-xs shadow-lg">
  <button class="flex w-full items-center gap-md rounded-md p-md text-md font-semibold text-secondary hover:bg-secondary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
    Edit
  </button>
  <button class="flex w-full items-center gap-md rounded-md p-md text-md font-semibold text-error-primary hover:bg-secondary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
    Delete
  </button>
</div>
```

- Floating surface `bg-primary` + `border-secondary` + `shadow-lg`. Items are
  `text-md font-semibold text-secondary` with `hover:bg-secondary-hover`;
  destructive items `text-error-primary`, ideally separated.
- Menu triggers and icon-only buttons carry a specific accessible label; icon
  triggers lift on hover via `hover:text-fg-quaternary-hover`.
