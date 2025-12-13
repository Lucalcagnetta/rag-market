
import { Item, Status, Settings } from './types';

export const INITIAL_SETTINGS: Settings = {
  cookie: '', // Deixar vazio para forçar o usuário a configurar
  useProxy: false,
  proxyUrl: 'https://api.allorigins.win/raw?url=',
};

export const MOCK_ITEMS: Item[] = [
  { id: '1', name: 'Elunium', targetPrice: 50000, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0, isAck: false, hasPriceDrop: false },
  { id: '2', name: 'Oridecon', targetPrice: 20000, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0, isAck: false, hasPriceDrop: false },
  { id: '3', name: 'Strawberry', targetPrice: 1500, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0, isAck: false, hasPriceDrop: false },
];
