/**
 * Chart color tokens for the portal's dark surface (`--bg-shell: #0a0a0a`).
 *
 * The categorical series palette was validated against that surface with the
 * dataviz six-checks validator (OKLCH lightness band 0.48–0.67 dark, chroma
 * floor >= 0.10, adjacent-pair CVD dE >= 8, normal-vision floor >= 15,
 * contrast >= 3:1 — all PASS). Assign hues in FIXED order, never cycled;
 * a 7th+ series folds into "OTHER" server-side (curated) or is capped.
 */
export const CHART_SERIES_COLORS = [
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300' // 6 green
] as const

export function seriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] as string
}

/** Sequential ramp endpoints (single hue) for heatmap cells on the dark surface. */
export const CHART_SEQUENTIAL_RANGE = ['rgba(57, 135, 229, 0.15)', '#3987e5'] as const

/** Recessive chart chrome — grid/axis/text stay quieter than the data ink. */
export const CHART_GRID_COLOR = 'rgba(245, 242, 236, 0.08)'
export const CHART_AXIS_COLOR = 'rgba(245, 242, 236, 0.35)'
export const CHART_TEXT_COLOR = 'rgba(245, 242, 236, 0.55)'
export const CHART_TOOLTIP_BG = '#1c1c1c'
