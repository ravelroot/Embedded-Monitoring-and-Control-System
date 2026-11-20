import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';

import type { ExportKind, InvokeChannel, PushTopics, Result, SimulatorControls, Snapshot } from '../shared/api';
import { INVOKE_CHANNELS } from '../shared/api';
import type { AppSettings, DeviceEvent, Severity, Telemetry } from '../shared/model';
import {
  parseCalibration,
  parseChannel,
  parseConfig,
  parseOutputCommand,
  parseRule,
  parseSettingsPatch,
  parseSlot,
  parseTarget,
  ValidationError,
} from '../shared/validation';
import { DeviceError } from './device/link';
import type { DeviceManager } from './device/manager';
import { listSerialPorts } from './device/serial-transport';
import { EXAMPLE_RULES } from './examples';
import { describeEvent, localEvent } from './services/events';
import { exportEvents, exportTelemetry } from './services/exporter';
import type { Database } from './storage/database';

type Handler = (...args: unknown[]) => unknown;

const RECENT_LIMIT = 3600;

function friendly(error: unknown): string {
  if (error instanceof ValidationError || error instanceof DeviceError) {
    return error.message;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message || 'Erro inesperado.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSimulator(value: unknown): SimulatorControls {
  if (!isRecord(value)) {
    throw new ValidationError('Controles do simulador inválidos.');
  }
  const number = (key: string, min: number, max: number) => {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
      throw new ValidationError(`Valor do simulador fora do intervalo: ${key}.`);
    }
    return raw;
  };
  const presence = value.presence;
  if (presence !== 'auto' && presence !== 'on' && presence !== 'off') {
    throw new ValidationError('Presença do simulador inválida.');
  }
  return {
    ambientC: number('ambientC', -10, 50),
    heatLoadC: number('heatLoadC', 0, 30),
    consumptionPerMin: number('consumptionPerMin', 0, 60),
    presence,
    temperatureFault: value.temperatureFault === true,
  };
}

function parseRange(from: unknown, to: unknown): { from: number; to: number } {
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    throw new ValidationError('Período inválido.');
  }
  return { from: Math.floor(from), to: Math.ceil(to) };
}

export class AppController {
  private settings: AppSettings;
  private readonly recent: Telemetry[] = [];
  private window: BrowserWindow | null = null;
  private sessionTarget = '';

  constructor(
    private readonly manager: DeviceManager,
    private readonly db: Database,
  ) {
    this.settings = db.loadSettings();
    manager.on('status', (status) => {
      if (status.state === 'online' && status.info) {
        const target = status.target;
        this.sessionTarget = target?.kind === 'serial' ? target.path : target?.kind === 'tcp' ? `${target.host}:${target.port}` : 'simulador';
        this.db.startSession(status.info, this.sessionTarget);
        this.recordLocal(localEvent(100, 0, `${status.info.hardware} em ${this.sessionTarget}`));
        this.backupRules();
      } else if (status.state !== 'online' && status.state !== 'connecting') {
        this.db.endSession(status.message);
      }
      this.push('status', status);
    });
    manager.on('telemetry', (telemetry) => {
      this.recent.push(telemetry);
      if (this.recent.length > RECENT_LIMIT) {
        this.recent.splice(0, this.recent.length - RECENT_LIMIT);
      }
      this.db.queueTelemetry(telemetry);
      this.push('telemetry', telemetry);
    });
    manager.on('event', (raw) => {
      const event = this.db.addEvent({ ...raw, message: describeEvent(raw, this.manager.snapshot().rules) });
      this.announce(event);
    });
    manager.on('rules', (rules) => this.push('rules', rules));
    manager.on('config', (config) => this.push('config', config));
    manager.on('frames', (frames) => this.push('frames', frames));
  }

  attach(window: BrowserWindow): void {
    this.window = window;
  }

  currentSettings(): AppSettings {
    return this.settings;
  }

  private push<K extends keyof PushTopics>(topic: K, payload: PushTopics[K]): void {
    const contents = this.window?.webContents;
    if (contents && !contents.isDestroyed()) {
      contents.send('malha:push', topic, payload);
    }
  }

  private recordLocal(event: { code: number; severity: Severity; index: number; value: number | null; uptimeMs: number; message: string }): void {
    this.announce(this.db.addEvent({ ...event, at: Date.now() }));
  }

  private announce(event: DeviceEvent): void {
    this.push('event', event);
    this.push('alarms', this.db.openAlarmCount());
    if (event.severity >= 2 && this.settings.notifications && Notification.isSupported()) {
      new Notification({ title: event.severity === 3 ? 'Malha · alarme crítico' : 'Malha · alarme', body: event.message, silent: event.severity < 3 }).show();
    }
  }

  private backupRules(): void {
    const { info, rules } = this.manager.snapshot();
    if (!info) {
      return;
    }
    for (const slot of rules) {
      if (slot.rule.enabled) {
        this.db.saveRuleBackup(info.deviceId, slot.slot, slot.rule);
      }
    }
  }

  private deviceId(): string {
    const id = this.manager.snapshot().info?.deviceId;
    if (!id) {
      throw new DeviceError('Nenhum dispositivo conectado.');
    }
    return id;
  }

  private handlers(): Record<InvokeChannel, Handler> {
    return {
      snapshot: (): Snapshot => {
        const snapshot = this.manager.snapshot();
        return {
          status: snapshot.status,
          info: snapshot.info,
          config: snapshot.config,
          rules: snapshot.rules,
          telemetry: snapshot.telemetry,
          stats: snapshot.stats,
          frames: snapshot.frames,
          settings: this.settings,
          openAlarms: this.db.openAlarmCount(),
          simulator: this.manager.getSimulatorControls(),
          recent: this.recent.slice(-this.settings.chartWindowMinutes * 60 * 4),
        };
      },
      listPorts: () => listSerialPorts(),
      connect: async (target) => {
        const parsed = parseTarget(target);
        this.recent.length = 0;
        this.settings = this.db.saveSettings({ lastTarget: parsed });
        this.push('settings', this.settings);
        void this.manager.connect(parsed);
      },
      disconnect: async () => {
        const wasOnline = this.manager.snapshot().status.state === 'online';
        await this.manager.disconnect();
        if (wasOnline) {
          this.recordLocal(localEvent(101, 0, this.sessionTarget || 'dispositivo'));
        }
      },
      setOutput: (output, value) => {
        const command = parseOutputCommand(output, value);
        return this.manager.setOutput(command.output, command.value);
      },
      setConfig: (config) => this.manager.setConfig(parseConfig(config)),
      setCalibration: (channel, calibration) => this.manager.setCalibration(parseChannel(channel), parseCalibration(calibration)),
      setRule: async (slot, rule) => {
        const index = parseSlot(slot);
        const parsed = parseRule(rule);
        const rules = await this.manager.setRule(index, parsed);
        this.db.saveRuleBackup(this.deviceId(), index, parsed);
        return rules;
      },
      clearRule: async (slot) => {
        const index = parseSlot(slot);
        const rules = await this.manager.clearRule(index);
        this.db.deleteRuleBackup(this.deviceId(), index);
        return rules;
      },
      loadExampleRules: async () => {
        let rules = this.manager.snapshot().rules;
        for (const example of EXAMPLE_RULES) {
          rules = await this.manager.setRule(example.slot, example.rule);
          this.db.saveRuleBackup(this.deviceId(), example.slot, example.rule);
        }
        return rules;
      },
      restoreRuleBackup: async () => {
        const backups = this.db.ruleBackups(this.deviceId());
        if (backups.length === 0) {
          throw new ValidationError('Não há regras guardadas no computador para este dispositivo.');
        }
        let rules = this.manager.snapshot().rules;
        for (const backup of backups) {
          rules = await this.manager.setRule(backup.slot, parseRule(backup.rule));
        }
        return rules;
      },
      save: () => this.manager.save(),
      reboot: () => this.manager.reboot(),
      factoryReset: () => this.manager.factoryReset(),
      ping: () => this.manager.ping(),
      stats: () => this.manager.stats(),
      setSimulator: (controls) => this.manager.setSimulatorControls(parseSimulator(controls)),
      history: (query) => {
        if (!isRecord(query)) {
          throw new ValidationError('Consulta inválida.');
        }
        const range = parseRange(query.from, query.to);
        const buckets = typeof query.buckets === 'number' && Number.isInteger(query.buckets) ? query.buckets : 600;
        return this.db.history({ ...range, buckets });
      },
      events: (query) => {
        const value = isRecord(query) ? query : {};
        const limit = typeof value.limit === 'number' && Number.isInteger(value.limit) ? Math.min(Math.max(value.limit, 1), 5000) : 500;
        const minSeverity = (typeof value.minSeverity === 'number' ? Math.min(Math.max(Math.floor(value.minSeverity), 0), 3) : 0) as Severity;
        return this.db.listEvents({ limit, minSeverity, onlyOpen: value.onlyOpen === true });
      },
      acknowledge: (id) => {
        if (id !== null && (typeof id !== 'number' || !Number.isInteger(id) || id < 1)) {
          throw new ValidationError('Alarme inválido.');
        }
        const changed = this.db.acknowledge(id as number | null);
        this.push('alarms', this.db.openAlarmCount());
        return changed;
      },
      exportCsv: async (kind, from, to) => {
        if (kind !== 'telemetry' && kind !== 'events') {
          throw new ValidationError('Tipo de exportação inválido.');
        }
        const range = parseRange(from, to);
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const options = {
          title: 'Exportar CSV',
          defaultPath: `malha-${kind === 'telemetry' ? 'medicoes' : 'eventos'}-${stamp}.csv`,
          filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
        };
        const result = this.window ? await dialog.showSaveDialog(this.window, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) {
          return { saved: false, path: '', rows: 0 };
        }
        const rows =
          (kind as ExportKind) === 'telemetry'
            ? await exportTelemetry(result.filePath, this.db.telemetryRows(range.from, range.to))
            : await exportEvents(
                result.filePath,
                this.db.listEvents({ limit: 100000, minSeverity: 0, onlyOpen: false }).filter((event) => event.at >= range.from && event.at < range.to),
              );
        return { saved: true, path: result.filePath, rows };
      },
      settings: (patch) => {
        this.settings = this.db.saveSettings(parseSettingsPatch(patch));
        this.push('settings', this.settings);
        return this.settings;
      },
      storage: () => this.db.summary(),
      prune: () => this.db.prune(this.settings.retentionDays),
      appInfo: () => ({
        name: 'Malha',
        version: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        dataPath: app.getPath('userData'),
      }),
      openDataFolder: async () => {
        const error = await shell.openPath(app.getPath('userData'));
        if (error) {
          throw new Error(error);
        }
      },
    };
  }

  register(): void {
    const handlers = this.handlers();
    for (const channel of INVOKE_CHANNELS) {
      ipcMain.handle(`malha:${channel}`, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
        if (!this.window || event.sender !== this.window.webContents) {
          return { ok: false, error: 'Origem não autorizada.' };
        }
        try {
          return { ok: true, value: await handlers[channel](...args) };
        } catch (error) {
          return { ok: false, error: friendly(error) };
        }
      });
    }
  }
}
