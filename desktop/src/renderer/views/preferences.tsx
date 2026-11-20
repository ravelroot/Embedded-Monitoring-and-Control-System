import { useEffect, useState } from 'preact/hooks';

import type { AppInfo, AppSettings, StorageSummary } from '../../shared/model';
import { BrandSquare, Button, Card, Field, PageHead, Stat, Toggle } from '../components/ui';
import { formatBytes, formatDateTime } from '../format';
import { call, toast, useStore } from '../store';

export function Preferences() {
  const settings = useStore((state) => state.settings);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const loadStorage = async () => setStorage((await call(window.malha.storage())) ?? null);
  useEffect(() => {
    void loadStorage();
    void call(window.malha.appInfo()).then((value) => setInfo(value ?? null));
  }, []);
  const save = (patch: Partial<AppSettings>) => void call(window.malha.settings(patch));
  return (
    <div class="view">
      <PageHead eyebrow="Sistema" title="Preferências" description="Aparência, notificações, conexão automática e os dados gravados neste computador." />
      <div class="grid-2">
        <Card title="Aparência e uso">
          <div class="form-grid single">
            <Field label="Tema">
              <div class="segmented" role="radiogroup" aria-label="Tema">
                {(
                  [
                    ['system', 'Igual ao Windows'],
                    ['light', 'Claro'],
                    ['dark', 'Escuro'],
                  ] as [AppSettings['theme'], string][]
                ).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={settings.theme === value} class={settings.theme === value ? 'is-active' : ''} onClick={() => save({ theme: value })}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Janela padrão do gráfico ao vivo">
              <select class="input" value={settings.chartWindowMinutes} onChange={(event) => save({ chartWindowMinutes: Number(event.currentTarget.value) })}>
                {[1, 5, 15, 60].map((value) => (
                  <option key={value} value={value}>
                    {value} min
                  </option>
                ))}
              </select>
            </Field>
            <Toggle checked={settings.notifications} onChange={(value) => save({ notifications: value })} label="Notificações do Windows para alarmes" hint="Alarmes altos e críticos aparecem mesmo com a janela minimizada." />
            <Toggle checked={settings.autoConnect} onChange={(value) => save({ autoConnect: value })} label="Conectar automaticamente ao último dispositivo" />
          </div>
        </Card>
        <Card
          title="Dados gravados"
          actions={
            <>
              <Button onClick={() => void call(window.malha.openDataFolder())}>Abrir pasta</Button>
              <Button
                onClick={async () => {
                  const result = await call(window.malha.prune());
                  if (result) {
                    toast('ok', `Removidas ${result.telemetry.toLocaleString('pt-BR')} medições e ${result.events} eventos antigos.`);
                    void loadStorage();
                  }
                }}
              >
                Limpar dados antigos agora
              </Button>
            </>
          }
        >
          <div class="stats-grid compact">
            <Stat label="Tamanho do banco" value={formatBytes(storage?.sizeBytes ?? 0)} />
            <Stat label="Medições" value={(storage?.telemetryRows ?? 0).toLocaleString('pt-BR')} />
            <Stat label="Eventos" value={(storage?.eventRows ?? 0).toLocaleString('pt-BR')} />
            <Stat label="Mais antiga" value={storage?.oldest ? formatDateTime(storage.oldest).slice(0, 10) : '—'} />
          </div>
          <Field label="Manter medições por" hint="Alarmes sem reconhecimento nunca são apagados automaticamente.">
            <select class="input" value={settings.retentionDays} onChange={(event) => save({ retentionDays: Number(event.currentTarget.value) })}>
              {[7, 30, 90, 180, 365, 730].map((value) => (
                <option key={value} value={value}>
                  {value} dias
                </option>
              ))}
            </select>
          </Field>
          <p class="muted small mono">{storage?.path}</p>
        </Card>
      </div>
      <Card title="Sobre">
        <div class="about">
          <BrandSquare />
          <div>
            <strong>Malha {info?.version}</strong>
            <p class="muted small">
              Electron {info?.electron} · Node {info?.node} · Licença MIT · Fontes Instrument Sans, Bricolage Grotesque e IBM Plex Mono (SIL OFL 1.1)
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
