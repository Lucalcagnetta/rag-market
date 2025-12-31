
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
  targetPrice: number;
  lastPrice: number | null;
  lastUpdated: string | null;
  status: Status;
  message?: string;
  nextUpdate: number;
  isAck?: boolean;
  hasPriceDrop?: boolean;
  isPinned?: boolean;
  isUserPrice?: boolean;      // Se o usuário marcou o preço como dele
  userKnownPrice?: number | null; // O preço que o usuário marcou como dele
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
