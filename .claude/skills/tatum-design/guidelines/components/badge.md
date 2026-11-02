# Badge

Anatomy: optional dot/icon + short label pill.

```html
<span class="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-xs font-medium text-utility-success-700">
  Healthy
</span>
```

- The Tatum badge is a **tinted pill**: `bg-utility-{color}-50` surface,
  `border-utility-{color}-200`, `text-utility-{color}-700` label. The utility
  scale is theme-aware, so the tint reads correctly in dark too.
- Status → family: `utility-gray` (neutral/metadata), `utility-brand`
  (selected/product-owned), `utility-success`, `utility-warning`,
  `utility-error`. Don't invent one-off badge colors.
- A neutral pill (`bg-secondary`) with a colored dot is an acceptable quieter
  alternative, but the tinted pill is the shipped default. Never color alone —
  the label carries the meaning.
