import { useEffect, useMemo, useState } from 'preact/hooks';
import type uPlot from 'uplot';

import { CHANNELS, type HistoryResult } from '../../shared/model';
import { type ChartSeries, TimeChart } from '../components/chart';
import { Button, Card, Empty, Field, Lid, PageHead, Toggle } from '../components/ui';
import { formatChannel, formatSpan } from '../format';
import { call, toast } from '../store';
import { SERIES_COLORS } from './dashboard';

const PRESETS = [
  { label: '1 hora', ms: 3_600_000 },
  { label: '6 horas', ms: 6 * 3_600_000 },
  { label: '24 horas', ms: 86_400_000 },
  { label: '7 dias', ms: 7 * 86_400_000 },
  { label: '30 dias', ms: 30 * 86_400_000 },
];

function toInput(ms: number): string {
  const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function fromInput(value: string): number {
  return new Date(value).getTime();
}

function colorOf(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token.slice(4, -1)).trim() || '#777';
}

export function History() {
  const [range, setRange] = useState(() => ({ from: Date.now() - 3_600_000, to: Date.now() }));
  const [preset, setPreset] = useState<number | null>(3_600_000);
  const [channels, setChannels] = useState<number[]>([0, 2]);
  const [showBand, setShowBand] = useState(false);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [version, setVersion] = useState(0);
  const load = async (from = range.from, to = range.to) => {
    const value = await call(window.malha.history({ from, to, buckets: 800 }));
    if (value) {
      setResult(value);
      setVersion((current) => current + 1);
    }
  };
  useEffect(() => {
    void load();
  }, [range.from, range.to]);
  const choosePreset = (ms: number) => {
    const to = Date.now();
    setPreset(ms);
    setRange({ from: to - ms, to });
  };
  const plotted = useMemo(() => {
    const list: { channel: number; kind: 'avg' | 'min' | 'max' }[] = [];
    for (const channel of channels) {
      list.push({ channel, kind: 'avg' });
      if (showBand) {
        list.push({ channel, kind: 'min' }, { channel, kind: 'max' });
      }
    }
    return list;
  }, [channels.join(','), showBand]);
  const chartSeries: ChartSeries[] = plotted.map((item) => {
    const spec = CHANNELS[item.channel];
    return {
      label: item.kind === 'avg' ? spec.name : `${spec.name} (${item.kind === 'min' ? 'mín' : 'máx'})`,
      color: colorOf(SERIES_COLORS[item.channel]),
      unit: spec.unit,
      digits: spec.digits,
      dash: item.kind === 'avg' ? undefined : [4, 4],
      scale: spec.unit === '%' ? '%' : spec.unit || 'estado',
      step: spec.key === 'presence',
    };
  });
  const data = [
    (result?.points ?? []).map((point) => point.t / 1000),
    ...plotted.map((item) => (result?.points ?? []).map((point) => point[item.kind][item.channel])),
  ] as unknown as uPlot.AlignedData;
  const summary = CHANNELS.map((channel) => {
    const values = (result?.points ?? []).map((point) => point.avg[channel.id]).filter((value): value is number => value !== null);
    const mins = (result?.points ?? []).map((point) => point.min[channel.id]).filter((value): value is number => value !== null);
    const maxs = (result?.points ?? []).map((point) => point.max[channel.id]).filter((value): value is number => value !== null);
    return {
      channel,
      avg: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      min: mins.length ? Math.min(...mins) : null,
      max: maxs.length ? Math.max(...maxs) : null,
    };
  });
  const exportCsv = async () => {
    const value = await call(window.malha.exportCsv('telemetry', range.from, range.to));
    if (value?.saved) {
      toast('ok', `${value.rows.toLocaleString('pt-BR')} medições exportadas para ${value.path}.`);
    }
  };
  return (
    <div class="view">
      <PageHead
        eyebrow="Operação"
        title="Histórico"
        description="Medições gravadas neste computador, agregadas por intervalo para o gráfico. A exportação leva todas as leituras do período."
        actions={
          <>
            <Button onClick={() => void load()}>Atualizar</Button>
            <Button variant="primary" onClick={() => void exportCsv()}>
              Exportar CSV do período
            </Button>
          </>
        }
      />
      {result && result.points.length > 0 && (
        <Lid
          eyebrow={`Medições no período · ${formatSpan(range.to - range.from)}`}
          number={result.samples.toLocaleString('pt-BR')}
          sentence={`${result.points.length} intervalos de ${formatSpan(result.bucketMs)} no gráfico.`}
          figures={summary.map((item) => ({
            label: item.channel.name,
            value: item.channel.key === 'presence' ? `${item.avg === null ? '—' : Math.round(item.avg * 100)}% do tempo` : formatChannel(item.channel.id, item.avg),
            note: item.channel.key === 'presence' ? 'com presença' : `${formatChannel(item.channel.id, item.min)} a ${formatChannel(item.channel.id, item.max)}`,
          }))}
        />
      )}
      <Card>
        <div class="toolbar">
          <div class="segmented" role="group" aria-label="Período">
            {PRESETS.map((item) => (
              <button key={item.ms} type="button" class={preset === item.ms ? 'is-active' : ''} onClick={() => choosePreset(item.ms)}>
                {item.label}
              </button>
            ))}
          </div>
          <Field label="De">
            <input
              class="input mono"
              type="datetime-local"
              value={toInput(range.from)}
              onChange={(event) => {
                const from = fromInput(event.currentTarget.value);
                if (Number.isFinite(from) && from < range.to) {
                  setPreset(null);
                  setRange({ ...range, from });
                }
              }}
            />
          </Field>
          <Field label="Até">
            <input
              class="input mono"
              type="datetime-local"
              value={toInput(range.to)}
              onChange={(event) => {
                const to = fromInput(event.currentTarget.value);
                if (Number.isFinite(to) && to > range.from) {
                  setPreset(null);
                  setRange({ ...range, to });
                }
              }}
            />
          </Field>
          <Toggle checked={showBand} onChange={setShowBand} label="Mostrar mínimo e máximo" />
        </div>
        <div class="chips-row">
          {CHANNELS.map((channel) => {
            const active = channels.includes(channel.id);
            return (
              <button
                key={channel.id}
                type="button"
                class={`series-chip${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => setChannels(active ? channels.filter((id) => id !== channel.id) : [...channels, channel.id].sort())}
              >
                <i class="dot" style={{ background: SERIES_COLORS[channel.id] }} />
                {channel.name}
              </button>
            );
          })}
        </div>
        {!result || result.points.length === 0 ? (
          <Empty title="Sem medições no período" text="Conecte um dispositivo para começar a gravar ou escolha outro período." />
        ) : channels.length === 0 ? (
          <p class="muted">Escolha ao menos um canal.</p>
        ) : (
          <TimeChart data={data} series={chartSeries} version={version} height={340} />
        )}
      </Card>
    </div>
  );
}
