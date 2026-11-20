import { useMemo, useState } from 'preact/hooks';
import type uPlot from 'uplot';

import { CHANNELS, OUTPUTS, PWM_MAX, type RuleSlot, type Telemetry } from '../../shared/model';
import { type ChartSeries, Sparkline, TimeChart } from '../components/chart';
import { Button, Card, Chip, Empty, Lid, type LidFigureData, PageHead, severityTone, Toggle } from '../components/ui';
import { formatChannel, formatOutput, formatTime, severityName } from '../format';
import { call, isOnline, navigate, series, useStore } from '../store';

export const SERIES_COLORS = ['var(--s0)', 'var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

function resolveColor(token: string): string {
  const name = token.slice(4, -1);
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#777';
}

function windowStats(values: (number | null)[], count: number) {
  const recent = values.slice(-count).filter((value): value is number => value !== null);
  if (recent.length === 0) {
    return { min: null, max: null };
  }
  return { min: Math.min(...recent), max: Math.max(...recent) };
}

function presenceShare(values: (number | null)[], count: number): number {
  const recent = values.slice(-count).filter((value): value is number => value !== null);
  return recent.length === 0 ? 0 : Math.round((recent.filter((value) => value >= 0.5).length / recent.length) * 100);
}

function activeRules(rules: RuleSlot[], telemetry: Telemetry | null): RuleSlot[] {
  return rules.filter((slot) => slot.rule.enabled && telemetry && (telemetry.activeRules & (1 << slot.slot)) !== 0);
}

const FLAG_CLASS: Record<string, string> = { neutral: 'flag-ok', low: 'flag-low', high: 'flag-high', critical: 'flag-critical' };

export function DisconnectedHero() {
  const status = useStore((state) => state.status);
  return (
    <Card>
      <Empty
        title={status.state === 'reconnecting' ? 'Reconectando ao dispositivo' : status.state === 'connecting' ? 'Conectando…' : 'Nenhum dispositivo conectado'}
        text={
          status.state === 'disconnected'
            ? 'Conecte o ESP32 pelo cabo USB ou experimente agora com o simulador, que roda o mesmo firmware dentro do aplicativo.'
            : status.message
        }
      >
        <Button variant="primary" onClick={() => void call(window.malha.connect({ kind: 'simulator' }))}>
          Usar o simulador
        </Button>
        <Button onClick={() => navigate('device')}>Conectar um ESP32</Button>
      </Empty>
    </Card>
  );
}

function NowLid() {
  const telemetry = useStore((state) => state.telemetry);
  const rules = useStore((state) => state.rules);
  const active = activeRules(rules, telemetry);
  const watching = rules.filter((slot) => slot.rule.enabled).length;
  const temperature = telemetry?.values[0] ?? null;
  const flagFor = (channel: number) => {
    const rule = active.find((slot) => slot.rule.channel === channel);
    if (rule) {
      return <span class={`lid-flag ${FLAG_CLASS[severityTone(rule.rule.severity)]}`}>regra {rule.slot + 1}</span>;
    }
    if (telemetry && telemetry.values[channel] === null) {
      return <span class="lid-flag flag-critical">sem leitura</span>;
    }
    return undefined;
  };
  const figures: LidFigureData[] = CHANNELS.slice(1).map((channel) => ({
    label: channel.name,
    value: formatChannel(channel.id, telemetry?.values[channel.id] ?? null),
    note: flagFor(channel.id),
  }));
  const actions = active
    .map((slot) => slot.rule)
    .map((rule) => (rule.output === null ? 'alarme ativo' : `${OUTPUTS[rule.output].name} em ${formatOutput(rule.output, rule.onValue).toLowerCase()}`));
  const fault = telemetry !== null && temperature === null ? 'Sensor de temperatura sem leitura. ' : '';
  const sentence =
    active.length > 0
      ? `${fault}${active.length} regra${active.length > 1 ? 's' : ''} atuando: ${actions.join(', ')}.`
      : watching > 0
        ? `${fault}Tudo dentro dos limites, com ${watching} regra${watching > 1 ? 's' : ''} vigiando.`
        : `${fault}Nenhuma regra configurada. As leituras seguem ao vivo.`;
  return (
    <Lid
      eyebrow="Temperatura agora"
      number={temperature === null ? '—' : formatChannel(0, temperature, false)}
      unit={temperature === null ? undefined : '°C'}
      sentence={sentence}
      figures={figures}
    />
  );
}

function Outputs() {
  const telemetry = useStore((state) => state.telemetry);
  const rules = useStore((state) => state.rules);
  const [fanDraft, setFanDraft] = useState<number | null>(null);
  const online = useStore(isOnline);
  const set = (output: number, value: number) => void call(window.malha.setOutput(output, value));
  return (
    <Card title="Saídas" subtitle="Comandos manuais valem até a próxima mudança de uma regra.">
      <div class="outputs">
        {OUTPUTS.map((output) => {
          const value = telemetry?.outputs[output.id] ?? 0;
          const owner = activeRules(rules, telemetry).find((slot) => slot.rule.output === output.id);
          return (
            <div class="output" key={output.id}>
              <div class="output-head">
                <strong>{output.name}</strong>
                <span class={`output-state${value ? ' is-on' : ''}`}>{formatOutput(output.id, value)}</span>
              </div>
              {owner && <small>Comandada pela regra {owner.slot + 1}</small>}
              {output.kind === 'relay' ? (
                <Toggle checked={value === 1} disabled={!online} label={value ? 'Desligar' : 'Ligar'} onChange={(checked) => set(output.id, checked ? 1 : 0)} />
              ) : (
                <div class="pwm">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    disabled={!online}
                    aria-label="Velocidade do ventilador"
                    value={fanDraft ?? Math.round((value / PWM_MAX) * 100)}
                    onInput={(event) => setFanDraft(Number(event.currentTarget.value))}
                    onChange={(event) => {
                      setFanDraft(null);
                      set(output.id, Number(event.currentTarget.value) * 10);
                    }}
                  />
                  <div class="pwm-quick">
                    {[0, 50, 100].map((percent) => (
                      <Button key={percent} small disabled={!online} onClick={() => set(output.id, percent * 10)}>
                        {percent}%
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function LiveChart() {
  const version = useStore((state) => state.seriesVersion);
  const windowMinutes = useStore((state) => state.settings.chartWindowMinutes);
  const [visible, setVisible] = useState<number[]>([0, 1, 2]);
  const [minutes, setMinutes] = useState(windowMinutes);
  const chartSeries: ChartSeries[] = useMemo(
    () =>
      visible.map((id) => ({
        label: CHANNELS[id].name,
        color: resolveColor(SERIES_COLORS[id]),
        unit: CHANNELS[id].unit || '',
        digits: CHANNELS[id].digits,
        scale: CHANNELS[id].unit === '%' ? '%' : CHANNELS[id].unit || 'estado',
        step: CHANNELS[id].key === 'presence',
      })),
    [visible.join(',')],
  );
  const data = [series.times, ...visible.map((id) => series.values[id])] as unknown as uPlot.AlignedData;
  return (
    <Card
      title="Ao vivo"
      actions={
        <div class="segmented" role="group" aria-label="Janela do gráfico">
          {[1, 5, 15, 60].map((value) => (
            <button key={value} type="button" class={value === minutes ? 'is-active' : ''} onClick={() => setMinutes(value)}>
              {value} min
            </button>
          ))}
        </div>
      }
    >
      <div class="chips-row">
        {CHANNELS.map((channel) => {
          const active = visible.includes(channel.id);
          return (
            <button
              key={channel.id}
              type="button"
              class={`series-chip${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => setVisible(active ? visible.filter((id) => id !== channel.id) : [...visible, channel.id].sort())}
            >
              <i class="dot" style={{ background: SERIES_COLORS[channel.id] }} />
              {channel.name}
            </button>
          );
        })}
      </div>
      {visible.length > 0 ? <TimeChart data={data} series={chartSeries} version={version} liveWindowS={minutes * 60} height={290} /> : <p class="muted">Escolha ao menos um canal.</p>}
    </Card>
  );
}

function Channels() {
  const telemetry = useStore((state) => state.telemetry);
  const version = useStore((state) => state.seriesVersion);
  return (
    <Card title="Canais" subtitle="Últimos cinco minutos de cada sensor.">
      <ul class="channel-list">
        {CHANNELS.map((channel) => {
          const value = telemetry?.values[channel.id] ?? null;
          const stats = windowStats(series.values[channel.id], 300);
          const fault = telemetry !== null && value === null;
          return (
            <li key={channel.id} class={`channel-row${fault ? ' is-fault' : ''}`}>
              <span class="channel-name">
                <i class="dot" style={{ background: SERIES_COLORS[channel.id] }} />
                {channel.name}
              </span>
              <Sparkline values={series.values[channel.id]} version={version} min={channel.min} max={channel.max} />
              <span class="channel-range">
                {channel.key === 'presence'
                  ? `presença em ${presenceShare(series.values[channel.id], 300)}%`
                  : `${formatChannel(channel.id, stats.min)} a ${formatChannel(channel.id, stats.max)}`}
              </span>
              <span class="channel-value display">
                {fault ? (
                  'sem leitura'
                ) : channel.key === 'presence' ? (
                  formatChannel(channel.id, value)
                ) : (
                  <>
                    {formatChannel(channel.id, value, false)}
                    <small>{channel.unit}</small>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RecentEvents() {
  const events = useStore((state) => state.events.slice(0, 6));
  return (
    <Card title="Eventos recentes" actions={<Button small variant="ghost" onClick={() => navigate('alarms')}>Ver todos</Button>}>
      {events.length === 0 ? (
        <p class="muted">Nenhum evento registrado ainda.</p>
      ) : (
        <ul class="event-list">
          {events.map((event) => (
            <li key={event.id} class={event.severity >= 2 && !event.acknowledged ? 'is-open' : ''}>
              <time class="mono">{formatTime(event.at).slice(0, 5)}</time>
              <span>{event.message}</span>
              {event.severity > 0 ? <Chip tone={severityTone(event.severity)}>{severityName(event.severity).toLowerCase()}</Chip> : <span />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Dashboard() {
  const online = useStore(isOnline);
  const dirty = useStore((state) => state.telemetry?.dirty ?? false);
  const openAlarms = useStore((state) => state.openAlarms);
  const hasData = useStore((state) => state.telemetry !== null);
  return (
    <div class="view">
      <PageHead eyebrow="Operação" title="Painel" description="Leituras ao vivo do equipamento, o que as regras estão fazendo agora e o comando manual das saídas." />
      {!online && <DisconnectedHero />}
      {openAlarms > 0 && (
        <div class="banner banner-high" role="alert">
          <strong>
            {openAlarms} alarme{openAlarms > 1 ? 's' : ''} sem reconhecimento
          </strong>
          <Button small onClick={() => navigate('alarms')}>
            Revisar
          </Button>
        </div>
      )}
      {online && dirty && (
        <div class="banner banner-info">
          <span>Há alterações de regras ou configuração que ainda não foram gravadas na memória do dispositivo.</span>
          <Button small variant="primary" onClick={() => void call(window.malha.save(), 'Gravado na memória do dispositivo.')}>
            Gravar agora
          </Button>
        </div>
      )}
      {(online || hasData) && (
        <>
          <div class="split">
            <NowLid />
            <Outputs />
          </div>
          <LiveChart />
          <div class="grid-2">
            <Channels />
            <RecentEvents />
          </div>
        </>
      )}
    </div>
  );
}
