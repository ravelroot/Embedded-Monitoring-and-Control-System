import { useEffect, useState } from 'preact/hooks';

import type { LinkStats } from '../../shared/model';
import { Button, Card, Lid, PageHead, Toggle } from '../components/ui';
import { formatBytes, formatTime } from '../format';
import { call, isOnline, setState, toast, useStore } from '../store';

export function Diagnostics() {
  const frames = useStore((state) => state.frames);
  const online = useStore(isOnline);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [paused, setPaused] = useState(false);
  const [hideTelemetry, setHideTelemetry] = useState(true);
  const [frozen, setFrozen] = useState(frames);
  useEffect(() => {
    if (!paused) {
      setFrozen(frames);
    }
  }, [frames, paused]);
  useEffect(() => {
    const tick = async () => {
      const value = await window.malha.stats();
      if (value.ok) {
        setStats(value.value);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => clearInterval(timer);
  }, []);
  const visible = frozen.filter((frame) => !hideTelemetry || (frame.name !== 'Telemetry' && frame.name !== 'Ping' && frame.name !== 'Pong')).slice(-150).reverse();
  const errors = (stats?.crcErrors ?? 0) + (stats?.decodeErrors ?? 0);
  return (
    <div class="view">
      <PageHead
        eyebrow="Equipamento"
        title="Diagnóstico"
        description="Saúde da comunicação com o dispositivo e cada quadro do protocolo enviado e recebido."
        actions={
          <Button
            disabled={!online}
            onClick={async () => {
              const ms = await call(window.malha.ping());
              if (ms !== undefined) {
                toast('info', `Resposta em ${ms.toLocaleString('pt-BR')} ms.`);
              }
            }}
          >
            Testar resposta (ping)
          </Button>
        }
      />
      <Lid
        eyebrow="Latência média das respostas"
        number={(stats?.latencyAvgMs ?? 0).toLocaleString('pt-BR')}
        unit="ms"
        sentence={`95% das respostas em até ${(stats?.latencyP95Ms ?? 0).toLocaleString('pt-BR')} ms. ${errors === 0 && (stats?.timeouts ?? 0) === 0 ? 'Nenhum erro nesta conexão.' : 'Há erros nesta conexão; confira o cabo e a porta.'}`}
        figures={[
          { label: 'Quadros enviados', value: (stats?.txFrames ?? 0).toLocaleString('pt-BR'), note: formatBytes(stats?.bytesOut ?? 0) },
          { label: 'Quadros recebidos', value: (stats?.rxFrames ?? 0).toLocaleString('pt-BR'), note: formatBytes(stats?.bytesIn ?? 0) },
          { label: 'Erros de quadro', value: String(errors), note: `CRC ${stats?.crcErrors ?? 0} · formato ${stats?.decodeErrors ?? 0}` },
          { label: 'Sem resposta', value: String(stats?.timeouts ?? 0), note: `${stats?.retries ?? 0} retransmissões` },
        ]}
      />
      <Card
        title="Quadros do protocolo"
        subtitle="Cada quadro é codificado em COBS, termina em 0x00 e leva CRC-16/CCITT."
        actions={
          <>
            <Toggle checked={hideTelemetry} onChange={setHideTelemetry} label="Ocultar telemetria e ping" />
            <Button onClick={() => setPaused(!paused)}>{paused ? 'Continuar' : 'Pausar'}</Button>
            <Button variant="ghost" onClick={() => setState({ frames: [] })}>
              Limpar
            </Button>
          </>
        }
      >
        <div class="frame-log">
          <table class="table compact mono">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Sentido</th>
                <th>Tipo</th>
                <th>Seq</th>
                <th>Bytes</th>
                <th>Conteúdo (hex)</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((frame, index) => (
                <tr key={`${frame.at}-${frame.seq}-${index}`} class={frame.direction === 'err' ? 'row-high row-active' : ''}>
                  <td>{formatTime(frame.at)}</td>
                  <td>{frame.direction === 'tx' ? '→ ESP32' : frame.direction === 'rx' ? '← ESP32' : 'erro'}</td>
                  <td>{frame.name}</td>
                  <td>{frame.seq}</td>
                  <td>{frame.length}</td>
                  <td class="hex">{frame.hex}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p class="muted">Nenhum quadro para mostrar.</p>}
        </div>
      </Card>
    </div>
  );
}
