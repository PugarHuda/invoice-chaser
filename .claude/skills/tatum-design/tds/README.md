# Operating the TDS React package

When the repo has `@tatum-io/tatum-design-system` installed and you're writing
React, read the **published TDS package guide**. It's maintained in the
design-system repo and stays in sync with the package — component-first
selection, exact prop discovery, install/setup, the `withTds` Tailwind-merge
setup, and Figma→TDS translation:

**https://tatum-desing-system-ed3d1a.gitlab.io/skill/SKILL.md**

That's the entry point — it indexes and links its own reference files
(`references/component-index.md`, `references/tokens.md`,
`references/workflows.md`), so start there and follow them as needed.

(The `desing` spelling is the real GitLab Pages domain — not a typo; don't
"correct" it.)

Use the guidelines here (`../guidelines/`) for the **visual language** — layout,
brand, token roles, dark mode — which applies with or without the package.

If you can't reach that URL, the same guide ships inside the installed package at
`node_modules/@tatum-io/tatum-design-system/skills/tds/` (`SKILL.md` +
`references/`) — version-matched to what's installed. Failing that, inspect the
package's component type declarations and Tailwind plugin under
`node_modules/@tatum-io/tatum-design-system/dist/`.
