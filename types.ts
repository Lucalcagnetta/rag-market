
export enum Status {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  OK = 'OK',
  ALERTA = 'ALERTA',
  ERRO = 'ERRO',
}

export interface PriceHistory {
  price: number;
  timestamp: string;
}

export interface Item {
  id: string;
  name: string;
  targetPrice: number;
  lastPrice: number | null;
  lastUpdated: string | null;
  status: Status;
  message?: string;
  nextUpdate: number;
  isAck?: boolean;
  hasPriceDrop?: boolean;
  isPinned?: boolean;
  isUserPrice?: boolean;      
  userKnownPrice?: number | null; 
  history?: PriceHistory[]; // Novo campo para rastreamento de média
}

export interface Settings {
  cookie: string;
  useProxy: boolean;
  proxyUrl: string;
  isRunning: boolean;
  ignoreNightPause?: boolean;
}

export interface ScrapeResult {
  success: boolean;
  price: number | null;
  error?: string;
}
