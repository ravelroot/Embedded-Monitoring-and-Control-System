import { useEffect, useState } from 'preact/hooks';

import type { DeviceEvent, Severity } from '../../shared/model';
import { Button, Card, Chip, Empty, PageHead, severityTone } from '../components/ui';
import { formatChannel, formatDateTime, severityName } from '../format';
import { call, toast, useStore } from '../store';

type Filter = 'all' | 'alarms' | 'open';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos os eventos' },
  { id: 'alarms', label: 'Somente alarmes' },
  { id: 'open', label: 'Alarmes em aberto' },
];

export function Alarms() {
  const [filter, setFilter] = useState<Filter>('open');
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const live = useStore((state) => state.events[0]?.id ?? 0);
  const openAlarms = useStore((state) => state.openAlarms);
  const load = async () => {
    const minSeverity: Severity = filter === 'all' ? 0 : 2;
    const result = await call(window.malha.events({ limit: 1000, minSeverity, onlyOpen: filter === 'open' }));
    if (result) {
      setEvents(result);
    }
  };
  useEffect(() => {
    void load();
  }, [filter, live, openAlarms]);
  const exportCsv = async () => {
    const to = Date.now() + 1000;
    const result = await call(window.malha.exportCsv('events', to - 90 * 86_400_000, to));
    if (result?.saved) {
      toast('ok', `${result.rows.toLocaleString('pt-BR')} eventos exportados.`);
    }
  };
  return (
    <div class="view">
      <PageHead
        eyebrow="Operação"
        title="Alarmes"
        description="Alarmes são eventos de severidade alta ou crítica. Reconhecer registra que alguém viu e tratou."
        actions={
          <>
            <div class="segmented" role="group" aria-label="Filtro">
              {FILTERS.map((item) => (
                <button key={item.id} type="button" class={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <Button disabled={openAlarms === 0} onClick={() => void call(window.malha.acknowledge(null), 'Todos os alarmes foram reconhecidos.').then(load)}>
              Reconhecer todos
            </Button>
            <Button onClick={() => void exportCsv()}>Exportar CSV</Button>
          </>
        }
      />
      <Card>
        {events.length === 0 ? (
          <Empty title={filter === 'open' ? 'Nenhum alarme em aberto' : 'Nada por aqui'} text="Quando uma regra com severidade alta ou crítica atuar, o alarme aparece nesta lista e como notificação do Windows." />
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Data e hora</th>
                <th>Severidade</th>
                <th>Evento</th>
                <th>Valor</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} class={event.severity >= 2 && !event.acknowledged ? `row-${severityTone(event.severity)} row-active` : ''}>
                  <td class="mono nowrap">{formatDateTime(event.at)}</td>
                  <td>
                    <Chip tone={severityTone(event.severity)}>{severityName(event.severity)}</Chip>
                  </td>
                  <td>{event.message}</td>
                  <td class="mono">{event.value === null ? '—' : event.code === 2 || event.code === 3 ? event.value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : formatChannel(event.index, event.value)}</td>
                  <td>
                    {event.acknowledged ? (
                      <span class="muted">reconhecido</span>
                    ) : event.severity >= 2 ? (
                      <Button small onClick={() => void call(window.malha.acknowledge(event.id)).then(load)}>
                        Reconhecer
                      </Button>
                    ) : (
                      <span class="muted">registrado</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
