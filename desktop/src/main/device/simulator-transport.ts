import { readFile, rm, writeFile } from 'node:fs/promises';

import type { SimulatorControls } from '../../shared/api';
import type { Transport, TransportHandlers } from './transport';

export type { SimulatorControls };

export const DEFAULT_SIMULATOR_CONTROLS: SimulatorControls = {
  ambientC: 24,
  heatLoadC: 9,
  consumptionPerMin: 6,
  presence: 'auto',
  temperatureFault: false,
};

interface CoreExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  malha_begin: () => void;
  malha_input_buffer: () => number;
  malha_input_capacity: () => number;
  malha_receive: (length: number) => void;
  malha_tick: () => void;
}

function noise(amplitude: number): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * amplitude;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Plant {
  temperature = 27;
  level = 55;
  outputs = [0, 0, 0];
  private time = 0;
  private presenceUntil = 0;
  private nextPresence = 15;

  advance(seconds: number, controls: SimulatorControls): void {
    this.time += seconds;
    const fan = this.outputs[2] / 1000;
    const pump = this.outputs[0] ? 1 : 0;
    const ambient = controls.ambientC + 1.5 * Math.sin((2 * Math.PI * this.time) / 600);
    const target = ambient + controls.heatLoadC - 11 * fan;
    this.temperature += (target - this.temperature) * Math.min(1, seconds / 40);
    this.level = clamp(this.level + (pump * 1.2 - controls.consumptionPerMin / 60) * seconds, 0, 100);
    if (this.time >= this.nextPresence) {
      this.presenceUntil = this.time + 4 + Math.random() * 10;
      this.nextPresence = this.time + 25 + Math.random() * 60;
    }
  }

  read(channel: number, controls: SimulatorControls): number {
    switch (channel) {
      case 0:
        return controls.temperatureFault ? Number.NaN : this.temperature + noise(0.08);
      case 1:
        return clamp(52 + 40 * Math.sin((2 * Math.PI * this.time) / 360) + noise(1.5), 0, 100);
      case 2:
        return clamp(this.level + noise(0.3), 0, 100);
      case 3:
        return 5.05 - 0.05 * (this.outputs[0] + this.outputs[1]) - 0.12 * (this.outputs[2] / 1000) + noise(0.015);
      case 4:
        if (controls.presence !== 'auto') {
          return controls.presence === 'on' ? 1 : 0;
        }
        return this.time < this.presenceUntil ? 1 : 0;
      default:
        return Number.NaN;
    }
  }
}

export class SimulatorTransport implements Transport {
  readonly label = 'Simulador';
  private core: CoreExports | null = null;
  private module: WebAssembly.Module | null = null;
  private handlers: TransportHandlers | null = null;
  private timer: NodeJS.Timeout | null = null;
  private bootedAt = 0;
  private lastStep = 0;
  private nvs: Uint8Array | null = null;
  private rebooting = false;
  private readonly plant = new Plant();

  constructor(
    private readonly wasmPath: string,
    private readonly nvsPath: string,
    private controls: SimulatorControls = { ...DEFAULT_SIMULATOR_CONTROLS },
  ) {}

  getControls(): SimulatorControls {
    return { ...this.controls };
  }

  setControls(controls: SimulatorControls): void {
    this.controls = { ...controls };
  }

  async open(handlers: TransportHandlers): Promise<void> {
    this.handlers = handlers;
    this.module = await WebAssembly.compile(await readFile(this.wasmPath));
    this.nvs = await readFile(this.nvsPath).then((data) => new Uint8Array(data)).catch(() => null);
    await this.boot();
    this.lastStep = performance.now();
    this.timer = setInterval(() => this.step(), 50);
  }

  private async boot(): Promise<void> {
    if (!this.module) {
      return;
    }
    this.bootedAt = performance.now();
    this.plant.outputs = [0, 0, 0];
    const memory = (): WebAssembly.Memory => {
      if (!this.core) {
        throw new Error('Núcleo do firmware não carregado.');
      }
      return this.core.memory;
    };
    const instance = await WebAssembly.instantiate(this.module, {
      host: {
        millis: () => Math.floor(performance.now() - this.bootedAt) >>> 0,
        read_channel: (channel: number) => this.plant.read(channel, this.controls),
        write_output: (output: number, value: number) => {
          if (output >= 0 && output < this.plant.outputs.length) {
            this.plant.outputs[output] = value;
          }
        },
        send: (pointer: number, length: number) => {
          const bytes = new Uint8Array(memory().buffer, pointer, length).slice();
          setImmediate(() => this.handlers?.data(bytes));
        },
        load: (pointer: number, capacity: number) => {
          if (!this.nvs || this.nvs.length > capacity) {
            return 0;
          }
          new Uint8Array(memory().buffer, pointer, this.nvs.length).set(this.nvs);
          return this.nvs.length;
        },
        store: (pointer: number, length: number) => {
          this.nvs = new Uint8Array(memory().buffer, pointer, length).slice();
          void writeFile(this.nvsPath, this.nvs).catch(() => undefined);
          return length;
        },
        erase: () => {
          this.nvs = null;
          void rm(this.nvsPath, { force: true });
          return 1;
        },
        reboot: () => {
          if (this.rebooting) {
            return;
          }
          this.rebooting = true;
          setTimeout(() => {
            this.core = null;
            void this.boot().finally(() => {
              this.rebooting = false;
            });
          }, 600);
        },
      },
    });
    this.core = instance.exports as unknown as CoreExports;
    this.core._initialize?.();
    this.core.malha_begin();
  }

  private step(): void {
    const now = performance.now();
    const seconds = (now - this.lastStep) / 1000;
    this.lastStep = now;
    this.plant.advance(seconds, this.controls);
    if (!this.rebooting) {
      this.core?.malha_tick();
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.rebooting) {
      return;
    }
    const core = this.core;
    if (!core) {
      throw new Error('Simulador desligado.');
    }
    const capacity = core.malha_input_capacity();
    for (let offset = 0; offset < data.length; offset += capacity) {
      const chunk = data.subarray(offset, offset + capacity);
      new Uint8Array(core.memory.buffer, core.malha_input_buffer(), chunk.length).set(chunk);
      core.malha_receive(chunk.length);
    }
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.core = null;
    this.handlers?.close('Simulador desligado.');
    this.handlers = null;
  }
}
