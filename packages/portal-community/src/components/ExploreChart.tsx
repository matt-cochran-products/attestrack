import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

// Modular registration (P4.2 bundle sanity): only the EXP.8 chart types the
// Explore surface offers — line/bar/area (LineChart)/scatter/pie/heatmap.
echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  PieChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  SVGRenderer,
]);

/**
 * ECharts renderer for Explore results (EXP.8). Loaded via `React.lazy` so the
 * echarts bundle stays in an async chunk — the portal shell never pays for it.
 * SVG renderer: crisper at the portal's small sizes and jsdom-friendlier.
 */
export interface ExploreChartProps {
  option: Record<string, unknown>;
  height?: number;
  ariaLabel?: string;
}

export default function ExploreChart({ option, height = 280, ariaLabel }: ExploreChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = echarts.init(host, null, { renderer: 'svg', height });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={ariaLabel ?? 'Query result chart'}
      style={{ width: '100%', height }}
    />
  );
}
