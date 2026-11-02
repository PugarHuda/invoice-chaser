# Radio group

Anatomy: circle, dot, label — one choice among a few.

```html
<label class="flex items-center gap-sm">
  <span class="flex size-4 shrink-0 items-center justify-center rounded-full border border-primary bg-primary focus-visible:ring-2 focus-visible:ring-focus-ring">
    <!-- selected: swap border to border-brand and show the inner dot -->
    <span class="size-2 rounded-full bg-brand-solid" aria-hidden="true"></span>
  </span>
  <span class="text-sm font-medium text-secondary">Mainnet</span>
</label>
```

- Same geometry as the checkbox but `rounded-full`; selected state is
  `border-brand` + a `bg-brand-solid` inner dot.
- Radios come in groups of 2–5 with one selected by default where sensible;
  more options than that wants a Select instead.
- Disabled matches the checkbox treatment; the state set (focus ring, disabled,
  error via `border-error-subtle`) applies as everywhere else.
