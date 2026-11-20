import { useEffect, useRef } from 'preact/hooks';
import uPlot from 'uplot';

export interface ChartSeries {
  label: string;
  color: string;
  unit: string;
  digits: number;
  dash?: number[];
  scale?: string;
  step?: boolean;
}

function timeLabels(plot: uPlot, splits: number[]): string[] {
  const min = plot.scales.x.min ?? 0;
  const max = plot.scales.x.max ?? 0;
  const span = max - min;
  return splits.map((value) => {
    const date = new Date(value * 1000);
    if (span > 2 * 86400) {
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
    if (span > 86400) {
      return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleTimeString('pt-BR', span < 600 ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  });
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function TimeChart(props: { data: uPlot.AlignedData; series: ChartSeries[]; height?: number; version: number; liveWindowS?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const signature = props.series.map((item) => `${item.label}${item.scale ?? ''}`).join('|');

  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    const axisColor = cssVar('--text-2');
    const gridColor = cssVar('--grid');
    const scales: uPlot.Scales = { x: { time: true } };
    for (const item of props.series) {
      scales[item.scale ?? item.unit ?? 'y'] = { auto: true };
    }
    const units = [...new Set(props.series.map((item) => item.scale ?? item.unit ?? 'y'))];
    const options: uPlot.Options = {
      width: element.clientWidth || 600,
      height: props.height ?? 280,
      legend: { live: true },
      cursor: { drag: { x: true, y: false } },
      scales,
      axes: [
        { stroke: axisColor, grid: { stroke: gridColor, width: 1 }, ticks: { stroke: gridColor }, values: timeLabels },
        ...units.slice(0, 2).map((unit, index) => ({
          scale: unit,
          side: index === 0 ? 3 : 1,
          stroke: axisColor,
          grid: { show: index === 0, stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor },
          size: 56,
          values: (_u: uPlot, values: number[]) => values.map((value) => `${value.toLocaleString('pt-BR')}${unit && unit !== 'y' ? ` ${unit}` : ''}`),
        })),
      ],
      series: [
        { label: 'Hora', value: (_u, value) => (value ? new Date(value * 1000).toLocaleString('pt-BR') : '—') },
        ...props.series.map((item) => ({
          label: item.label,
          stroke: item.color,
          width: 1.6,
          dash: item.dash,
          scale: item.scale ?? item.unit ?? 'y',
          spanGaps: false,
          points: { show: false },
          paths: item.step ? uPlot.paths.stepped?.({ align: 1 }) : undefined,
          value: (_u: uPlot, value: number | null) =>
            value === null || value === undefined ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: item.digits, minimumFractionDigits: item.digits })} ${item.unit}`,
        })),
      ],
    };
    plot.current = new uPlot(options, props.data, element);
    const observer = new ResizeObserver(() => {
      if (plot.current && element.clientWidth > 0) {
        plot.current.setSize({ width: element.clientWidth, height: props.height ?? 280 });
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [signature, props.height]);

  useEffect(() => {
    const instance = plot.current;
    if (!instance) {
      return;
    }
    instance.setData(props.data, !props.liveWindowS);
    if (props.liveWindowS) {
      const times = props.data[0] as number[];
      const last = times.length > 0 ? times[times.length - 1] : Date.now() / 1000;
      const first = times.length > 0 ? times[0] : last;
      instance.setScale('x', { min: Math.max(first, last - props.liveWindowS), max: Math.max(last, first + 10) });
    }
  }, [props.version, props.data, props.liveWindowS]);

  return <div class="chart" ref={host} />;
}

export function Sparkline(props: { values: (number | null)[]; version: number; min: number; max: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    element.width = width * ratio;
    element.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const points = props.values.slice(-120);
    const finite = points.filter((value): value is number => value !== null);
    if (finite.length < 2) {
      return;
    }
    const minimumSpan = (props.max - props.min) * 0.04 || 1;
    const center = (Math.min(...finite) + Math.max(...finite)) / 2;
    const span = Math.max(Math.max(...finite) - Math.min(...finite), minimumSpan);
    const low = center - span / 2;
    context.strokeStyle = cssVar('--text');
    context.lineWidth = 1.4;
    context.beginPath();
    let started = false;
    points.forEach((value, index) => {
      if (value === null) {
        started = false;
        return;
      }
      const x = (index / (points.length - 1)) * width;
      const y = height - ((value - low) / span) * (height - 4) - 2;
      if (started) {
        context.lineTo(x, y);
      } else {
        context.moveTo(x, y);
        started = true;
      }
    });
    context.stroke();
  }, [props.version]);
  return <canvas class="sparkline" ref={canvas} aria-hidden="true" />;
}
