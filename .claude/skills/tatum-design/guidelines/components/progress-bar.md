# Progress bar

Anatomy: track + fill, plus a visible value when precision matters.

```html
<div class="h-2 w-full overflow-hidden rounded-full bg-tertiary">
  <div class="h-full w-1/2 rounded-full bg-brand-solid"></div>
</div>
```

- Track `bg-tertiary`, fill `bg-brand-solid`, both `rounded-full`. Use status
  fills (`bg-{status}-primary` solids) only when the bar itself communicates
  state (e.g. quota nearly exceeded → warning).
- Pair with a `text-sm text-tertiary` label/value; never color alone.
