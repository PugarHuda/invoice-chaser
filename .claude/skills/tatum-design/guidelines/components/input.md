# Input & Field

Anatomy: label, control, hint/error text.

```html
<div class="flex flex-col gap-sm">
  <label class="text-sm font-medium text-secondary">Gateway name</label>
  <input class="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" placeholder="e.g. production-eth" />
  <p class="text-xs text-tertiary">Shown in your dashboard and API responses.</p>
</div>
```

- Control surface `bg-primary` + `border-primary`; placeholder
  `text-placeholder`; hint text `text-tertiary`.
- **Error state:** border becomes `border-error-subtle`, focus ring becomes
  `focus-visible:ring-focus-ring-error`, and the hint becomes
  `text-error-primary`. Keep the field's height stable between valid and error.
- **Disabled:** `bg-disabled-subtle` surface with `text-disabled` label/value
  and a disabled cursor; layout footprint unchanged.
- Group fields by the user's mental model, not by API shape.
