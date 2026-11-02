# Switch

Anatomy: track + sliding thumb — an instant on/off (unlike a checkbox, which
submits with a form).

```html
<button role="switch" aria-checked="false" class="flex h-5 w-9 items-center rounded-full bg-tertiary p-xxs focus-visible:ring-2 focus-visible:ring-focus-ring">
  <!-- checked: track swaps to bg-brand-solid, thumb slides right -->
  <span class="size-4 rounded-full bg-primary shadow-xs" aria-hidden="true"></span>
</button>
```

- Track: `bg-tertiary` off, `bg-brand-solid` on; thumb `bg-primary` +
  `shadow-xs`. Disabled: `bg-disabled-subtle` track, `text-disabled` label.
- Use a switch for immediate effect, a checkbox for choices submitted later.
