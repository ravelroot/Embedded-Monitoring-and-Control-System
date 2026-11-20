import { useEffect, useState } from 'preact/hooks';

import type { Result, SimulatorControls, Snapshot } from '../shared/api';
import {
  type AppSettings,
  CHANNELS,
  DEFAULT_SETTINGS,
  type DeviceConfig,
  type DeviceEvent,
  type DeviceInfo,
  type FrameLog,
  type LinkStats,
  type LinkStatus,
  type RuleSlot,
  type Telemetry,
} from '../shared/model';

export type ViewId = 'dashboard' | 'rules' | 'alarms' | 'history' | 'device' | 'diagnostics' | 'preferences';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

export interface State {
  ready: boolean;
  view: ViewId;
  status: LinkStatus;
  info: DeviceInfo | null;
  config: DeviceConfig | null;
  rules: RuleSlot[];
  telemetry: Telemetry | null;
  stats: LinkStats | null;
  frames: FrameLog[];
  settings: AppSettings;
  openAlarms: number;
  simulator: SimulatorControls | null;
  events: DeviceEvent[];
  toasts: Toast[];
  paletteOpen: boolean;
  seriesVersion: number;
}

let state: State = {
  ready: false,
  view: 'dashboard',
  status: { state: 'disconnected', target: null, info: null, message: 'Carregando…', since: Date.now() },
  info: null,
  config: null,
  rules: [],
  telemetry: null,
  stats: null,
  frames: [],
  settings: DEFAULT_SETTINGS,
  openAlarms: 0,
  simulator: null,
  events: [],
  toasts: [],
  paletteOpen: false,
  seriesVersion: 0,
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((current: State) => Partial<State>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

export function useStore<T>(selector: (current: State) => T): T {
  const [value, setValue] = useState(() => selector(state));
  useEffect(() => {
    const update = () => setValue(() => selector(state));
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return value;
}

export interface Series {
  times: number[];
  values: (number | null)[][];
  outputs: number[][];
}

export const series: Series = {
  times: [],
  values: CHANNELS.map(() => []),
  outputs: [[], [], []],
};

const SERIES_LIMIT_MS = 60 * 60 * 1000;

function appendSeries(telemetry: Telemetry): void {
  series.times.push(telemetry.at / 1000);
  CHANNELS.forEach((channel) => series.values[channel.id].push(telemetry.values[channel.id] ?? null));
  series.outputs.forEach((list, index) => list.push(telemetry.outputs[index] ?? 0));
  const cutoff = (telemetry.at - SERIES_LIMIT_MS) / 1000;
  let drop = 0;
  while (drop < series.times.length && series.times[drop] < cutoff) {
    drop++;
  }
  if (drop > 0) {
    series.times.splice(0, drop);
    series.values.forEach((list) => list.splice(0, drop));
    series.outputs.forEach((list) => list.splice(0, drop));
  }
}

function resetSeries(): void {
  series.times.length = 0;
  series.values.forEach((list) => (list.length = 0));
  series.outputs.forEach((list) => (list.length = 0));
}

let toastId = 0;

export function toast(kind: Toast['kind'], text: string): void {
  const id = ++toastId;
  setState((current) => ({ toasts: [...current.toasts.slice(-3), { id, kind, text }] }));
  setTimeout(() => setState((current) => ({ toasts: current.toasts.filter((item) => item.id !== id) })), kind === 'error' ? 7000 : 3500);
}

export async function call<T>(promise: Promise<Result<T>>, success?: string): Promise<T | undefined> {
  try {
    const result = await promise;
    if (!result.ok) {
      toast('error', result.error);
      return undefined;
    }
    if (success) {
      toast('ok', success);
    }
    return result.value;
  } catch (error) {
    toast('error', (error as Error).message ?? 'Falha de comunicação com o processo principal.');
    return undefined;
  }
}

export function navigate(view: ViewId): void {
  setState({ view, paletteOpen: false });
}

export async function refreshEvents(): Promise<void> {
  const events = await call(window.malha.events({ limit: 300, minSeverity: 0, onlyOpen: false }));
  if (events) {
    setState({ events });
  }
}

function applyTheme(settings: AppSettings): void {
  document.documentElement.dataset.theme = settings.theme;
}

export async function bootstrap(): Promise<void> {
  const api = window.malha;
  api.on('status', (status) => {
    if (status.state === 'connecting') {
      resetSeries();
    }
    setState({ status, info: status.info ?? (status.state === 'online' ? getState().info : null) });
  });
  api.on('telemetry', (telemetry) => {
    appendSeries(telemetry);
    setState((current) => ({ telemetry, seriesVersion: current.seriesVersion + 1 }));
  });
  api.on('event', (event) => setState((current) => ({ events: [event, ...current.events].slice(0, 300) })));
  api.on('rules', (rules) => setState({ rules }));
  api.on('config', (config) => setState({ config }));
  api.on('frames', (batch) => setState((current) => ({ frames: [...current.frames, ...batch].slice(-300) })));
  api.on('alarms', (openAlarms) => setState({ openAlarms }));
  api.on('settings', (settings) => {
    applyTheme(settings);
    setState({ settings });
  });
  const snapshot: Snapshot | undefined = await call(api.snapshot());
  if (snapshot) {
    snapshot.recent.forEach(appendSeries);
    applyTheme(snapshot.settings);
    setState({
      ready: true,
      status: snapshot.status,
      info: snapshot.info,
      config: snapshot.config,
      rules: snapshot.rules,
      telemetry: snapshot.telemetry,
      stats: snapshot.stats,
      frames: snapshot.frames,
      settings: snapshot.settings,
      openAlarms: snapshot.openAlarms,
      simulator: snapshot.simulator,
      seriesVersion: 1,
    });
  }
  await refreshEvents();
}

export function isOnline(current: State): boolean {
  return current.status.state === 'online';
}
