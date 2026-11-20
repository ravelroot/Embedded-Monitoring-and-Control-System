export interface TransportHandlers {
  data: (chunk: Uint8Array) => void;
  close: (reason: string) => void;
}

export interface Transport {
  readonly label: string;
  open(handlers: TransportHandlers): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
