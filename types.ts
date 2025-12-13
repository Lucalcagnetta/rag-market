
export enum Status {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  OK = 'OK',
  ALERTA = 'ALERTA',
  ERRO = 'ERRO',
}

export interface Item {
  id: string;
  name: string;
  targetPrice: number; // New field for "Preço Alvo"
  lastPrice: number | null;
  lastUpdated: string | null; // ISO Date string
  status: Status;
  message?: string;
  nextUpdate: number; // Timestamp for next scheduled check
  isAck?: boolean; // Se o usuário já "viu" a oferta atual
}

export interface Settings {
  cookie: string;
  useProxy: boolean;
  proxyUrl: string;
}

export interface ScrapeResult {
  success: boolean;
  price: number | null;
  error?: string;
}
