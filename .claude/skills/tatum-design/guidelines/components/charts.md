# Charts

Anatomy: a Card-recipe panel with title and current value/summary, then plot
area, axes/gridlines, series, legend, tooltip.

The manual doesn't mandate a chart library — use whatever your stack already
renders charts with. The brand lives in the colors, surfaces, and restraint,
not the library.

- **Series color carries meaning or hierarchy, never decoration.** Primary
  series: the brand fill (`--color-bg-brand-solid`). Series with status
  meaning: the status roles. Context/comparison series: gray text/border
  roles. No rainbow palettes, no gradient fills, no glow.
- **Chart chrome wears the same roles as everything else:** axis and tick
  labels `text-xs text-tertiary`; gridlines use the `border-secondary` color;
  legend entries `text-sm text-secondary` with series-colored dot markers; the
  hover tooltip is the Tooltip recipe (inverted).
- **Theme-aware rendering:** canvas-based chart libraries can't parse a CSS
  `var()` reference as a color — resolve variables to computed values at
  render time (`getComputedStyle`) and re-render on theme change; otherwise
  the chart draws black and ignores dark mode.
- **States:** loading is a Skeleton block preserving the chart's final height;
  empty is the empty-state recipe, not a bare axis grid; error is the error
  recipe. The panel footprint stays stable across all three.
- Series geometry (widths, positions, points) is data-driven — inline values
  there are expected (`patterns.md` → When explicit values are allowed). If
  you need more distinguishable series than the semantic roles offer, extend
  deliberately from the brand/status/gray values and keep the series order
  consistent across screens — there is no approved categorical chart palette
  yet (a pending design-system token request).
