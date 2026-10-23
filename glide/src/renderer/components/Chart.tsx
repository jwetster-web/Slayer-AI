import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../lib/hooks';
import { useStore } from '../lib/store';

echarts.use([LineChart, BarChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer]);

/** Categorical palette validated for the dark chart surface (see docs/DESIGN.md); fixed order, never cycled. */
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export function chartTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const light = document.documentElement.dataset.theme === 'light';
  return { ink: v('--g-ink'), ink2: v('--g-ink2'), ink3: v('--g-ink3'), grid: v('--g-grid'), accent: v('--g-accent'), series: light ? SERIES_LIGHT : SERIES_DARK, light, tooltipBg: light ? '#ffffff' : '#111628' };
}

export function baseOption() {
  const t = chartTheme();
  return {
    textStyle: { fontFamily: 'Inter', color: t.ink2 },
    color: t.series,
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: 'rgba(140,160,255,0.25)',
      textStyle: { color: t.ink, fontFamily: 'Inter', fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 12px 30px -10px rgba(0,0,0,.5);',
    },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: { axisLine: { lineStyle: { color: t.grid } }, axisTick: { show: false }, axisLabel: { color: t.ink3, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink3, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
  };
}

export function EChart({ option, height = 280, onClick, className }: { option: Record<string, unknown>; height?: number; onClick?: (p: any) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const reduced = usePrefersReducedMotion();
  const theme = useStore((s) => s.settings?.theme);
  useEffect(() => {
    chart.current = echarts.init(ref.current!, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current!);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption({ animation: !reduced, animationDuration: 700, ...option }, true);
  }, [option, reduced, theme]);
  useEffect(() => {
    const c = chart.current;
    if (!c || !onClick) return;
    c.on('click', onClick);
    return () => {
      c.off('click', onClick);
    };
  }, [onClick]);
  return <div ref={ref} className={className} style={{ height, width: '100%' }} />;
}
