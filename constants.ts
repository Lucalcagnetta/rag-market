import { Item, Status, Settings } from './types';

export const INITIAL_SETTINGS: Settings = {
  cookie: '_ga_GRTDNJ7Q9N=GS2.1.s1765467987$o1$g0$t1765467987$j60$l0$h0; _ga=GA1.1.293254569.1765467987; _gcl_au=1.1.647996529.1765467987; afUserId=95386af4-1abd-4700-af1d-4218e981238a-p; __Host-authjs.csrf-token=3c8ab0ad69632b5870deafbe1f7ee7ac54b1e566e511cc95af850616d15909e2%7Cb79c709cf73fb3bada7132f83e737c9cfe6d3898beda49a411093e7c183f0334; __Secure-authjs.callback-url=https%3A%2F%2Flocalhost%3A51202; AF_SYNC=1765469994946; a_cookie_ck_ro=1; __rtbh.uid=%7B%22eventType%22%3A%22uid%22%2C%22id%22%3A%22unknown%22%2C%22expiryDate%22%3A%222026-12-12T23%3A58%3A27.116Z%22%7D; __rtbh.lid=%7B%22eventType%22%3A%22lid%22%2C%22id%22%3A%22BvDoxv8hNsUw7MIivAR4%22%2C%22expiryDate%22%3A%222026-12-12T23%3A58%3A27.118Z%22%7D; _rdt_uuid=1765467987312.2358952e-7cd2-41bf-bb7b-782a010ea740; _ga_R7WPE2WXEJ=GS2.1.s1765578494$o2$g1$t1765583907$j60$l0$h0; _ga_T3GNV2XVD7=GS2.1.s1765583907$o5$g0$t1765583912$j55$l0$h0',
  useProxy: false,
  proxyUrl: 'https://api.allorigins.win/raw?url=',
};

export const MOCK_ITEMS: Item[] = [
  { id: '1', name: 'Elunium', targetPrice: 50000, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0 },
  { id: '2', name: 'Oridecon', targetPrice: 20000, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0 },
  { id: '3', name: 'Strawberry', targetPrice: 1500, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0 },
];