import { useEffect, useState } from 'preact/hooks';

import type { SimulatorControls } from '../../shared/api';
import { CHANNELS, type ConnectionTarget, type DeviceConfig, type SerialPortInfo } from '../../shared/model';
import { parseConfig, ValidationError } from '../../shared/validation';
import { Button, Card, Confirm, Field, PageHead, Stat, Toggle } from '../components/ui';
import { formatChannel, formatDuration, formatNumber } from '../format';
import { call, isOnline, setState, useStore } from '../store';

type Kind = ConnectionTarget['kind'];

function Connection() {
  const status = useStore((state) => state.status);
  const lastTarget = useStore((state) => state.status.target ?? state.settings.lastTarget);
  const autoConnect = useStore((state) => state.settings.autoConnect);
  const [kind, setKind] = useState<Kind>(lastTarget?.kind ?? 'serial');
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [path, setPath] = useState(lastTarget?.kind === 'serial' ? lastTarget.path : '');
  const [host, setHost] = useState(lastTarget?.kind === 'tcp' ? lastTarget.host : 'localhost');
  const [port, setPort] = useState(lastTarget?.kind === 'tcp' ? lastTarget.port : 4000);
  const [telnet, setTelnet] = useState(lastTarget?.kind === 'tcp' ? lastTarget.telnet : true);
  const refresh = async () => {
    const list = await call(window.malha.listPorts());
    if (list) {
      setPorts(list);
      if (!path && list.length > 0) {
        setPath(list[0].path);
      }
    }
  };
  useEffect(() => {
    if (kind === 'serial') {
      void refresh();
    }
  }, [kind]);
  const target = (): ConnectionTarget | null => {
    if (kind === 'simulator') {
      return { kind };
    }
    if (kind === 'tcp') {
      return { kind, host: host.trim(), port, telnet };
    }
    return path ? { kind, path } : null;
  };
  const busy = status.state === 'connecting';
  const active = status.state !== 'disconnected';
  return (
    <Card title="Conexão" subtitle="O aplicativo reconecta sozinho se o cabo for removido ou o ESP32 reiniciar.">
      <div class="segmented wide" role="radiogroup" aria-label="Tipo de conexão">
        {(
          [
            ['serial', 'USB (serial)'],
            ['simulator', 'Simulador'],
            ['tcp', 'Rede TCP · Wokwi'],
          ] as [Kind, string][]
        ).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={kind === value} class={kind === value ? 'is-active' : ''} onClick={() => setKind(value)}>
            {label}
          </button>
        ))}
      </div>
      {kind === 'serial' && (
        <div class="form-row">
          <Field label="Porta" hint={ports.length === 0 ? 'Nenhuma porta encontrada. Conecte o ESP32 e clique em atualizar.' : 'Portas com conversor USB típico de ESP32 aparecem primeiro.'}>
            <select class="input" value={path} onChange={(event) => setPath(event.currentTarget.value)}>
              {ports.length === 0 && <option value="">—</option>}
              {ports.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.path} {item.likelyEsp32 ? '· provável ESP32' : ''} {item.manufacturer ? `· ${item.manufacturer}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={() => void refresh()}>Atualizar portas</Button>
        </div>
      )}
      {kind === 'simulator' && (
        <p class="muted">O simulador executa o núcleo do firmware compilado para WebAssembly, com sensores virtuais que respondem às saídas. Ideal para testar regras sem hardware.</p>
      )}
      {kind === 'tcp' && (
        <div class="form-row">
          <Field label="Endereço">
            <input class="input mono" value={host} onInput={(event) => setHost(event.currentTarget.value)} />
          </Field>
          <Field label="Porta">
            <input class="input mono" type="number" min={1} max={65535} value={port} onInput={(event) => setPort(Number(event.currentTarget.value))} />
          </Field>
          <Toggle checked={telnet} onChange={setTelnet} label="RFC 2217 / telnet" hint="Ligue para o Wokwi (porta 4000) e ser2net em modo telnet." />
        </div>
      )}
      <div class="actions-row">
        <Button variant="primary" disabled={busy || !target()} onClick={() => target() && void call(window.malha.connect(target() as ConnectionTarget))}>
          {busy ? 'Conectando…' : active ? 'Reconectar' : 'Conectar'}
        </Button>
        <Button disabled={!active} onClick={() => void call(window.malha.disconnect())}>
          Desconectar
        </Button>
        <Toggle checked={autoConnect} onChange={(value) => void call(window.malha.settings({ autoConnect: value }))} label="Conectar automaticamente ao abrir" />
      </div>
      <p class="status-line">
        <i class={`dot state-${status.state}`} />
        {status.message}
      </p>
    </Card>
  );
}

function Info() {
  const info = useStore((state) => state.info);
  const telemetry = useStore((state) => state.telemetry);
  if (!info) {
    return null;
  }
  return (
    <Card title="Dispositivo">
      <div class="stats-grid compact">
        <Stat label="Hardware" value={info.hardware.split(' (')[0]} />
        <Stat label="Firmware" value={info.firmware} />
        <Stat label="Identificador" value={info.deviceId} />
        <Stat label="Protocolo" value={`v${info.protocol}`} />
        <Stat label="Ligado há" value={formatDuration(telemetry?.uptimeMs ?? info.uptimeMs)} />
        <Stat label="Canais · saídas · regras" value={`${info.channels} · ${info.outputs} · ${info.ruleSlots}`} />
      </div>
    </Card>
  );
}

function Configuration() {
  const config = useStore((state) => state.config);
  const telemetry = useStore((state) => state.telemetry);
  const [draft, setDraft] = useState<DeviceConfig | null>(config);
  const [error, setError] = useState('');
  useEffect(() => setDraft(config), [config]);
  if (!draft) {
    return null;
  }
  const update = (patch: Partial<DeviceConfig>) => {
    setError('');
    setDraft({ ...draft, ...patch });
  };
  const setCalibration = (channel: number, key: 'gain' | 'offset', value: number) => {
    const calibration = draft.calibration.map((item, index) => (index === channel ? { ...item, [key]: value } : item));
    update({ calibration });
  };
  const apply = async () => {
    try {
      const parsed = parseConfig(draft);
      await call(window.malha.setConfig(parsed), 'Configuração aplicada. Use “Gravar na memória” para manter após reiniciar.');
    } catch (problem) {
      setError(problem instanceof ValidationError ? problem.message : String(problem));
    }
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(config);
  return (
    <Card
      title="Configuração do firmware"
      actions={
        <>
          <Button disabled={!changed} onClick={() => setDraft(config)}>
            Descartar
          </Button>
          <Button variant="primary" disabled={!changed} onClick={() => void apply()}>
            Aplicar
          </Button>
          <Button onClick={() => void call(window.malha.save(), 'Gravado na memória do dispositivo.')}>{telemetry?.dirty ? 'Gravar na memória •' : 'Gravar na memória'}</Button>
        </>
      }
    >
      <div class="form-grid">
        <Field label="Intervalo de leitura" hint="Também é a frequência da telemetria.">
          <select class="input" value={draft.sampleIntervalMs} onChange={(event) => update({ sampleIntervalMs: Number(event.currentTarget.value) })}>
            {[250, 500, 1000, 2000, 5000, 10000].map((value) => (
              <option key={value} value={value}>
                {value < 1000 ? `${value} ms` : `${value / 1000} s`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tempo limite da comunicação" hint="0 desativa. Depois desse tempo sem o computador, o ESP32 considera a ligação perdida.">
          <div class="input-unit">
            <input class="input mono" type="number" min={0} max={3600} value={draft.linkTimeoutS} onInput={(event) => update({ linkTimeoutS: Math.round(Number(event.currentTarget.value)) })} />
            <span>s</span>
          </div>
        </Field>
        <Field label={`Filtro de leitura · ${draft.filterPercent}%`} hint="Média móvel exponencial. Valores menores suavizam mais.">
          <input type="range" min={1} max={100} value={draft.filterPercent} onInput={(event) => update({ filterPercent: Number(event.currentTarget.value) })} />
        </Field>
        <Toggle
          checked={draft.safeOnLinkLoss}
          onChange={(value) => update({ safeOnLinkLoss: value })}
          label="Estado seguro ao perder a comunicação"
          hint="Desliga as saídas comandadas manualmente. As regras continuam atuando."
        />
      </div>
      <h3 class="section-title">Calibração</h3>
      <table class="table compact">
        <thead>
          <tr>
            <th>Canal</th>
            <th>Ganho</th>
            <th>Deslocamento</th>
            <th>Leitura atual</th>
          </tr>
        </thead>
        <tbody>
          {CHANNELS.map((channel) => (
            <tr key={channel.id}>
              <td>{channel.name}</td>
              <td>
                <input class="input mono" type="number" step="0.001" value={draft.calibration[channel.id].gain} onInput={(event) => setCalibration(channel.id, 'gain', Number(event.currentTarget.value))} />
              </td>
              <td>
                <div class="input-unit">
                  <input class="input mono" type="number" step="0.01" value={draft.calibration[channel.id].offset} onInput={(event) => setCalibration(channel.id, 'offset', Number(event.currentTarget.value))} />
                  <span>{channel.unit}</span>
                </div>
              </td>
              <td class="mono">{formatChannel(channel.id, telemetry?.values[channel.id])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted small">Valor final = leitura × ganho + deslocamento. Compare com um instrumento de referência e ajuste o deslocamento primeiro.</p>
      {error && <p class="field-error">{error}</p>}
    </Card>
  );
}

function Simulator() {
  const stored = useStore((state) => state.simulator);
  const [controls, setControls] = useState<SimulatorControls | null>(stored);
  useEffect(() => setControls(stored), [stored]);
  if (!controls) {
    return null;
  }
  const update = (patch: Partial<SimulatorControls>) => {
    const next = { ...controls, ...patch };
    setControls(next);
    void call(window.malha.setSimulator(next)).then((value) => value && setState({ simulator: value }));
  };
  return (
    <Card title="Ambiente simulado" subtitle="Mude as condições e veja o firmware reagir em tempo real.">
      <div class="form-grid">
        <Field label={`Temperatura ambiente · ${formatNumber(controls.ambientC, 0)} °C`}>
          <input type="range" min={0} max={40} value={controls.ambientC} onInput={(event) => update({ ambientC: Number(event.currentTarget.value) })} />
        </Field>
        <Field label={`Calor do equipamento · +${formatNumber(controls.heatLoadC, 0)} °C`}>
          <input type="range" min={0} max={25} value={controls.heatLoadC} onInput={(event) => update({ heatLoadC: Number(event.currentTarget.value) })} />
        </Field>
        <Field label={`Consumo do reservatório · ${formatNumber(controls.consumptionPerMin, 0)}% por minuto`}>
          <input type="range" min={0} max={40} value={controls.consumptionPerMin} onInput={(event) => update({ consumptionPerMin: Number(event.currentTarget.value) })} />
        </Field>
        <Field label="Sensor de presença">
          <select class="input" value={controls.presence} onChange={(event) => update({ presence: event.currentTarget.value as SimulatorControls['presence'] })}>
            <option value="auto">Movimento aleatório</option>
            <option value="on">Sempre detectando</option>
            <option value="off">Ninguém presente</option>
          </select>
        </Field>
        <Toggle checked={controls.temperatureFault} onChange={(value) => update({ temperatureFault: value })} label="Simular falha no sensor de temperatura" hint="O firmware passa a reportar o canal como sem leitura." />
      </div>
    </Card>
  );
}

function Maintenance() {
  const [confirm, setConfirm] = useState<'reboot' | 'reset' | null>(null);
  return (
    <Card title="Manutenção">
      <div class="actions-row">
        <Button onClick={() => setConfirm('reboot')}>Reiniciar o dispositivo</Button>
        <Button variant="danger" onClick={() => setConfirm('reset')}>
          Restaurar padrões de fábrica
        </Button>
      </div>
      {confirm === 'reboot' && (
        <Confirm
          title="Reiniciar o dispositivo?"
          text="As saídas desligam durante a reinicialização. O aplicativo reconecta sozinho em alguns segundos."
          confirm="Reiniciar"
          onConfirm={() => void call(window.malha.reboot(), 'Reiniciando o dispositivo…')}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'reset' && (
        <Confirm
          title="Restaurar padrões de fábrica?"
          text="Apaga todas as regras, a calibração e a configuração gravadas no dispositivo. As cópias das regras guardadas neste computador continuam disponíveis em Regras › Restaurar do computador."
          confirm="Apagar tudo"
          danger
          requireText="RESTAURAR"
          onConfirm={() => void call(window.malha.factoryReset(), 'Padrões de fábrica restaurados.')}
          onClose={() => setConfirm(null)}
        />
      )}
    </Card>
  );
}

export function Device() {
  const online = useStore(isOnline);
  const simulator = useStore((state) => state.status.target?.kind === 'simulator' && state.status.state === 'online');
  return (
    <div class="view">
      <PageHead
        eyebrow="Equipamento"
        title="Dispositivo"
        description="Conexão pela USB, simulador ou rede, configuração do firmware, calibração dos sensores e manutenção."
      />
      <div class="grid-2">
        <div class="stack">
          <Connection />
          <Info />
          {online && <Maintenance />}
        </div>
        <div class="stack">
          {simulator && <Simulator />}
          {online ? <Configuration /> : <Card title="Configuração do firmware"><p class="muted">Disponível com um dispositivo conectado.</p></Card>}
        </div>
      </div>
    </div>
  );
}
