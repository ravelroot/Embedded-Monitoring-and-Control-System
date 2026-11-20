import 'uplot/dist/uPlot.min.css';
import './styles.css';

import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { BrandSquare } from './components/ui';
import { bootstrap, call, getState, isOnline, navigate, setState, useStore, type ViewId } from './store';
import { Alarms } from './views/alarms';
import { Dashboard } from './views/dashboard';
import { Device } from './views/device';
import { Diagnostics } from './views/diagnostics';
import { History } from './views/history';
import { Preferences } from './views/preferences';
import { Rules } from './views/rules';

const VIEWS: { id: ViewId; label: string; group: string; icon: string }[] = [
  { id: 'dashboard', label: 'Painel', group: 'Operação', icon: 'M4 13h6V4H4zm0 7h6v-5H4zm10 0h6v-9h-6zm0-16v5h6V4z' },
  { id: 'alarms', label: 'Alarmes', group: 'Operação', icon: 'M12 4a6 6 0 0 0-6 6v4l-2 3h16l-2-3v-4a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0' },
  { id: 'history', label: 'Histórico', group: 'Operação', icon: 'M4 19V5M4 19h16M7 15l4-5 3 3 5-6' },
  { id: 'rules', label: 'Regras', group: 'Automação', icon: 'M5 6h14M5 12h9M5 18h5M17 15l2 2 3-4' },
  { id: 'device', label: 'Dispositivo', group: 'Equipamento', icon: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4' },
  { id: 'diagnostics', label: 'Diagnóstico', group: 'Equipamento', icon: 'M3 12h4l2-6 4 12 2-6h6' },
  { id: 'preferences', label: 'Preferências', group: 'Sistema', icon: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4' },
];

const STATE_LABELS: Record<string, string> = {
  disconnected: 'Desconectado',
  connecting: 'Conectando',
  online: 'Online',
  reconnecting: 'Reconectando',
  error: 'Falha na conexão',
};

const SEARCH_ICON = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';
const SUN_ICON = 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4';
const MOON_ICON = 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z';
const CHIP_ICON = 'M8 8h8v8H8zM10 4v4M14 4v4M10 16v4M14 16v4M4 10h4M4 14h4M16 10h4M16 14h4';

function Icon(props: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="icon">
      <path d={props.path} />
    </svg>
  );
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function Sidebar() {
  const view = useStore((state) => state.view);
  const openAlarms = useStore((state) => state.openAlarms);
  const theme = useStore((state) => state.settings.theme);
  const status = useStore((state) => state.status);
  const info = useStore((state) => state.info);
  const dirty = useStore((state) => state.telemetry?.dirty ?? false);
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  const target = status.target;
  const where = target?.kind === 'serial' ? target.path : target?.kind === 'tcp' ? `${target.host}:${target.port}` : target?.kind === 'simulator' ? 'simulador' : 'nenhum dispositivo';
  const detail = status.state === 'online' && info ? `${where} · firmware ${info.firmware}${dirty ? ' · não gravado' : ''}` : where;
  const groups = [...new Set(VIEWS.map((item) => item.group))];
  return (
    <nav class="sidebar" aria-label="Navegação principal">
      <div class="brand">
        <BrandSquare />
        <div>
          <div class="brand-name display">Malha</div>
          <div class="brand-tagline">Monitoramento e controle</div>
        </div>
      </div>
      <button type="button" class="goto" onClick={() => setState({ paletteOpen: true })}>
        <Icon path={SEARCH_ICON} />
        <span>Ir para…</span>
        <kbd>Ctrl K</kbd>
      </button>
      {groups.map((group) => (
        <div key={group}>
          <p class="nav-group">{group}</p>
          <ul>
            {VIEWS.filter((item) => item.group === group).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  class={`nav-item${view === item.id ? ' is-active' : ''}`}
                  aria-current={view === item.id ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                  title={`Ctrl+${VIEWS.indexOf(item) + 1}`}
                >
                  <Icon path={item.icon} />
                  <span>{item.label}</span>
                  {item.id === 'alarms' && openAlarms > 0 && <span class="badge">{openAlarms}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div class="sidebar-foot">
        <button type="button" class="nav-item" onClick={() => void call(window.malha.settings({ theme: dark ? 'light' : 'dark' }))}>
          <Icon path={dark ? SUN_ICON : MOON_ICON} />
          <span>{dark ? 'Tema claro' : 'Tema escuro'}</span>
        </button>
        <div class="device-block" aria-live="polite">
          <span class="device-avatar">
            <Icon path={CHIP_ICON} />
            <i class={`dot state-${status.state}`} />
          </span>
          <span class="device-text">
            <strong>{STATE_LABELS[status.state]}</strong>
            <span title={detail}>{detail}</span>
          </span>
        </div>
      </div>
    </nav>
  );
}

interface Command {
  label: string;
  hint?: string;
  run: () => void;
}

function Palette() {
  const open = useStore((state) => state.paletteOpen);
  const online = useStore(isOnline);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const commands: Command[] = useMemo(
    () => [
      ...VIEWS.map((item, position) => ({ label: `Ir para ${item.label}`, hint: `Ctrl+${position + 1}`, run: () => navigate(item.id) })),
      { label: 'Conectar ao simulador', run: () => void call(window.malha.connect({ kind: 'simulator' })) },
      ...(online
        ? [
            { label: 'Desconectar', run: () => void call(window.malha.disconnect()) },
            { label: 'Gravar regras e configuração no dispositivo', run: () => void call(window.malha.save(), 'Gravado na memória do dispositivo.') },
            { label: 'Carregar regras de exemplo', run: () => void call(window.malha.loadExampleRules(), 'Regras de exemplo enviadas.') },
            { label: 'Desligar todas as saídas', run: () => [0, 1, 2].forEach((output) => void call(window.malha.setOutput(output, 0))) },
          ]
        : []),
      { label: 'Reconhecer todos os alarmes', run: () => void call(window.malha.acknowledge(null), 'Alarmes reconhecidos.') },
      { label: 'Exportar medições das últimas 24 horas', run: () => void call(window.malha.exportCsv('telemetry', Date.now() - 86_400_000, Date.now())) },
    ],
    [online],
  );
  const filtered = commands.filter((command) => command.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')));
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  if (!open) {
    return null;
  }
  const close = () => setState({ paletteOpen: false });
  const run = (command: Command | undefined) => {
    if (command) {
      close();
      command.run();
    }
  };
  return (
    <div class="palette-backdrop" onClick={close}>
      <div class="palette" role="dialog" aria-label="Paleta de comandos" onClick={(event) => event.stopPropagation()}>
        <input
          ref={input}
          class="input"
          placeholder="Digite um comando…"
          value={query}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex(Math.min(filtered.length - 1, index + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex(Math.max(0, index - 1));
            } else if (event.key === 'Enter') {
              run(filtered[index]);
            } else if (event.key === 'Escape') {
              close();
            }
          }}
        />
        <ul role="listbox">
          {filtered.map((command, position) => (
            <li key={command.label} role="option" aria-selected={position === index} class={position === index ? 'is-active' : ''} onMouseEnter={() => setIndex(position)} onClick={() => run(command)}>
              <span>{command.label}</span>
              {command.hint && <kbd>{command.hint}</kbd>}
            </li>
          ))}
          {filtered.length === 0 && <li class="muted">Nenhum comando encontrado.</li>}
        </ul>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((state) => state.toasts);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} class={`toast toast-${item.kind}`}>
          {item.text}
        </div>
      ))}
    </div>
  );
}

function App() {
  const view = useStore((state) => state.view);
  const ready = useStore((state) => state.ready);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setState({ paletteOpen: !getState().paletteOpen });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && /^[1-7]$/.test(event.key)) {
        event.preventDefault();
        navigate(VIEWS[Number(event.key) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="app">
      <Sidebar />
      <main class="content">
        {!ready ? (
          <p class="muted loading">Carregando…</p>
        ) : view === 'dashboard' ? (
          <Dashboard />
        ) : view === 'rules' ? (
          <Rules />
        ) : view === 'alarms' ? (
          <Alarms />
        ) : view === 'history' ? (
          <History />
        ) : view === 'device' ? (
          <Device />
        ) : view === 'diagnostics' ? (
          <Diagnostics />
        ) : (
          <Preferences />
        )}
      </main>
      <Palette />
      <Toasts />
    </div>
  );
}

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
  void bootstrap();
}
