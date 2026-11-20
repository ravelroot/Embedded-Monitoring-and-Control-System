import type { MalhaApi } from '../shared/api';

declare global {
  interface Window {
    malha: MalhaApi;
  }
}

export {};
