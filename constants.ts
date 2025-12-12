import { Item, Status, Settings } from './types';

export const INITIAL_SETTINGS: Settings = {
  cookie: '',
  useProxy: true,
  proxyUrl: 'https://api.allorigins.win/raw?url=',
};

export const MOCK_ITEMS: Item[] = [
  { id: '1', name: 'Elunium', targetPrice: 50000, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0 },
  { id: '2', name: 'Oridecon', targetPrice: 20000, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0 },
  { id: '3', name: 'Strawberry', targetPrice: 1500, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0 },
];
