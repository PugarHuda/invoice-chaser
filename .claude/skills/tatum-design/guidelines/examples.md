# Examples

End-to-end recipes to adapt. Keep the grammar: semantic roles, the named
scales, compact density, shell rhythm, and a full state set. All classes resolve
via the package plugin or this skill's `tokens/tailwind.tokens.js`; every
recipe stays value-free — the manual's lint gates enforce this.

## Overview page skeleton

```html
<main class="flex flex-col gap-3xl bg-primary p-xl lg:p-4xl">
  <header class="flex flex-col gap-lg lg:flex-row lg:items-start lg:justify-between">
    <div class="min-w-0">
      <h1 class="text-heading-xs font-semibold text-primary">RPC Gateway</h1>
      <p class="mt-xs text-sm text-tertiary">Monitor gateway usage and routing health.</p>
    </div>
    <button class="rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
      Create gateway
    </button>
  </header>

  <section class="grid grid-cols-1 gap-xl sm:grid-cols-2 lg:grid-cols-4">
    <!-- metric cards -->
  </section>

  <section class="overflow-hidden rounded-xl border border-secondary bg-primary">
    <!-- table -->
  </section>
</main>
```

## Settings page

```html
<main class="mx-auto flex max-w-3xl flex-col gap-3xl bg-primary p-xl lg:p-4xl">
  <div>
    <h1 class="text-heading-xs font-semibold text-primary">Settings</h1>
    <p class="mt-xs text-sm text-tertiary">Manage your workspace and preferences.</p>
  </div>

  <section class="rounded-xl border border-secondary bg-primary p-xl">
    <h2 class="text-md font-semibold text-primary">Profile</h2>
    <p class="mt-xs text-sm text-tertiary">This information is shown to your team.</p>

    <div class="mt-xl flex flex-col gap-lg">
      <div class="flex flex-col gap-sm">
        <label class="text-sm font-medium text-secondary">Display name</label>
        <input class="rounded-md bg-primary px-lg py-sm text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
      </div>
    </div>

    <div class="mt-xl flex justify-end gap-sm border-t border-secondary pt-lg">
      <button class="rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Cancel</button>
      <button class="rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Save</button>
    </div>
  </section>
</main>
```

Use when: a top-level configuration screen. One primary action; grouped
sections; states preserved.

## Metric card

```html
<section class="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
  <p class="text-sm font-medium text-tertiary">Requests today</p>
  <p class="mt-md text-heading-xs font-semibold text-primary">1.24M</p>
  <p class="mt-sm text-xs text-tertiary">Compared with the previous 24h window.</p>
</section>
```

Avoid: decorative gradients, giant icon tiles, nested cards, brand-colored
deltas.

## Filter bar

```html
<div class="flex flex-col gap-lg rounded-xl border border-secondary bg-primary p-lg sm:flex-row sm:flex-wrap sm:items-center">
  <label class="relative min-w-0 flex-1">
    <span class="sr-only">Search gateways</span>
    <input class="w-full rounded-md bg-primary px-lg py-sm text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" placeholder="Search by gateway, chain, or endpoint" />
  </label>
  <button class="rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Filters</button>
</div>
```

Use when: controls affect the immediately following table/list.

## Empty state inside a panel

```html
<div class="flex flex-col items-center justify-center rounded-xl border border-secondary bg-primary p-4xl text-center">
  <div class="flex size-12 items-center justify-center rounded-full border border-secondary bg-primary shadow-xs">
    <svg class="size-6 shrink-0 text-fg-quaternary" aria-hidden="true"><!-- icon --></svg>
  </div>
  <h2 class="mt-lg text-md font-semibold text-primary">No alerts yet</h2>
  <p class="mt-xs max-w-sm text-sm text-tertiary">Create an alert to get notified when gateway activity needs attention.</p>
  <button class="mt-xl rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Create alert</button>
</div>
```

Use when: a table/card/panel has no data and the user can create something.

## Error state inside a panel

```html
<div class="flex gap-lg rounded-xl bg-utility-error-50 p-xl">
  <svg class="mt-xxs size-5 shrink-0 text-utility-error-600" aria-hidden="true"><!-- status icon --></svg>
  <div class="min-w-0">
    <h2 class="text-sm font-semibold text-utility-error-600">Could not load gateway logs</h2>
    <p class="mt-xs text-sm text-tertiary">The request timed out. Retry, or narrow the time range.</p>
    <button class="mt-lg rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Retry</button>
  </div>
</div>
```

Use when: content failed to load or a mutation failed; the state model requires
it. Avoid: red-dominant full-screen treatment unless the whole route is blocked.

## Table row with status

```html
<tr class="border-b border-secondary hover:bg-secondary-hover">
  <td class="px-3xl py-xl">
    <div class="min-w-0">
      <p class="truncate text-md font-medium text-primary">Ethereum mainnet</p>
      <p class="truncate font-mono text-xs text-tertiary">eth-mainnet.gw.tatum.io</p>
    </div>
  </td>
  <td class="px-3xl py-xl">
    <span class="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-xs font-medium text-utility-success-700">Healthy</span>
  </td>
  <td class="px-3xl py-xl text-right">
    <button aria-label="Open gateway actions" class="inline-flex items-center justify-center rounded-md p-xs text-fg-quaternary hover:bg-secondary-hover hover:text-fg-quaternary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
      <svg class="size-5 shrink-0" aria-hidden="true"><!-- dots icon --></svg>
    </button>
  </td>
</tr>
```

Use when: an operational row carries identity, status, and row actions.

Avoid: color-only status, unlabeled icon buttons, actions that change row
height.

## Marketing hero (split)

Composition rules in `layout-marketing.md`. Same
tokens, larger rhythm:

```html
<section class="bg-primary py-7xl lg:py-8xl">
  <div class="mx-auto flex max-w-6xl flex-col gap-4xl px-xl lg:flex-row lg:items-center lg:px-4xl">
    <div class="flex flex-col gap-xl lg:w-1/2">
      <span class="inline-flex w-fit items-center gap-sm rounded-full border border-secondary bg-primary px-md py-xxs text-xs font-medium text-secondary shadow-xs">
        <span class="size-2 rounded-full bg-brand-solid" aria-hidden="true"></span>
        New: RPC gateway alerts
        <svg class="size-4 shrink-0 text-fg-quaternary" aria-hidden="true"><!-- arrow icon --></svg>
      </span>
      <h1 class="text-heading-md font-semibold text-primary lg:text-heading-xl">Web3 infrastructure that just works</h1>
      <p class="max-w-lg text-lg text-tertiary lg:text-xl">Build, test, and run blockchain apps on 100+ networks with one API.</p>
      <div class="flex flex-col gap-sm sm:flex-row">
        <input class="rounded-md bg-primary px-lg py-md text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring sm:w-72" placeholder="Enter your email" />
        <button class="rounded-lg border border-transparent bg-brand-solid px-xl py-md text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Get started</button>
      </div>
    </div>
    <div class="overflow-hidden rounded-2xl border border-secondary lg:w-1/2">
      <!-- real product/brand artwork, meaningful alt text -->
    </div>
  </div>
</section>
```

Use when: website hero, landing/acquisition section.

Avoid: gradient blobs or glass instead of real artwork, several primary CTAs,
dashboard compactness, campaign copy in product screens.

## Package-free (Tailwind)

Wiring the tokens into a fresh Tailwind v3.4+ project:

```js
// tailwind.config.js
const tokens = require('./tokens/tailwind.tokens.js')

module.exports = {
  content: ['./src/**/*.{html,js,jsx,ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: { extend: tokens.theme.extend },
}
```

`tailwind.tokens.js` is CommonJS (`module.exports`). In an ESM project
(`"type": "module"`), load it from a `tailwind.config.cjs` or import it with
`await import(...)` — the manual ships no package.json, so the consumer owns
that choice.

Plus two imports: the token variables and the typeface.

```css
/* app.css */
@import './tokens/tokens.css'; /* the CSS variables, light + dark */
/* load Poppins via Google Fonts or self-hosted @font-face */
```

That's the whole setup — every class in this manual now works, and dark mode
follows the `data-theme`/`.dark` scope.

## Package-free (plain CSS)

No Tailwind? Load `tokens/tokens.css` and reference the variables directly.
Dark mode comes from the `[data-theme="dark"]` scope in that file — never a
second hand-picked color. Load the Poppins font yourself (Google Fonts or
self-hosted); `--font-family-sans` names it but doesn't bundle the files.

```css
body {
  font-family: var(--font-family-sans);
  background: var(--color-bg-primary);
  color: var(--color-text-secondary);
}
.button-primary {
  background: var(--color-bg-brand-solid);
  color: var(--color-text-primary-on-brand);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-lg);
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-xs);
}
.card {
  background: var(--color-bg-primary);
  border: thin solid var(--color-border-secondary);
  border-radius: var(--radius-xl);
  padding: var(--space-xl);
}
```

The same variables resolve to their dark values automatically inside a
`[data-theme="dark"]` container — style once, get both themes.

## Extending to new surfaces

Marketing layout grammar lives in `layout-marketing.md`; the hero above is its first
recipe. Email, slides, and a fuller marketing template set arrive as
`surfaces/<domain>/` folders that reference these global tokens and foundations
— never duplicating them. The brand stays one source; surfaces add composition
on top.
