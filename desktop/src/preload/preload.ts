import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { INVOKE_CHANNELS, type MalhaApi, PUSH_TOPICS, type PushTopics } from '../shared/api';

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

ipcRenderer.on('malha:push', (_event: IpcRendererEvent, topic: string, payload: unknown) => {
  for (const listener of listeners.get(topic) ?? []) {
    listener(payload);
  }
});

const api: Record<string, unknown> = {};
for (const channel of INVOKE_CHANNELS) {
  api[channel] = (...args: unknown[]) => ipcRenderer.invoke(`malha:${channel}`, ...args);
}

api.on = <K extends keyof PushTopics>(topic: K, listener: (payload: PushTopics[K]) => void) => {
  if (!PUSH_TOPICS.includes(topic) || typeof listener !== 'function') {
    return () => undefined;
  }
  const set = listeners.get(topic) ?? new Set<Listener>();
  set.add(listener as Listener);
  listeners.set(topic, set);
  return () => {
    set.delete(listener as Listener);
  };
};

contextBridge.exposeInMainWorld('malha', Object.freeze(api as unknown as MalhaApi));
