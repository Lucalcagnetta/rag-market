
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;
const HOST = '0.0.0.0';

// =======================================================
// CONFIGURAÇÕES DE PERFORMANCE
// =======================================================
const UPDATE_INTERVAL_MS = 120 * 1000; // 2 minutos (Voltou ao padrão solicitado)
const ERROR_RETRY_MS = 60 * 1000;     // 1 minuto se der erro
const LOOP_TICK_MS = 1500;            // Checa a fila a cada 1.5s
const MAX_CONCURRENT_ROBOTS = 2;      // 2 pesquisas simultâneas (2 robôs)

// Configuração do Banco de Dados JSON
const DATA_DIR = join(__dirname, 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ 
    items: [], 
    settings: { 
      cookie: '', 
      useProxy: false, 
      proxyUrl: '', 
      isRunning: true,
      ignoreNightPause: false
    } 
  }));
}

let GLOBAL_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

if (typeof GLOBAL_DB.settings.ignoreNightPause === 'undefined') {
  GLOBAL_DB.settings.ignoreNightPause = false;
}

const saveDB = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(GLOBAL_DB, null, 2));
  } catch (e) {
    console.error("Erro ao salvar DB em disco:", e);
  }
};

const cleanStartupData = () => {
  let changed = false;
  GLOBAL_DB.items = GLOBAL_DB.items.map(item => {
    if (item.status === 'LOADING') {
      changed = true;
      return { ...item, status: 'IDLE', nextUpdate: 0 };
    }
    return item;
  });
  if (changed) saveDB();
};
cleanStartupData();

app.use(cors());
app.use(express.json());

const distPath = join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// =======================================================
// LÓGICA DE SCRAPING
// =======================================================

const parsePriceString = (str) => {
  if (!str) return NaN;
  const numericStr = str.replace(/[^\d]/g, '');
  return parseInt(numericStr, 10);
};

const performScrape = async (item, cookie) => {
  let userCookie = cookie || ''; 
  if (userCookie) userCookie = userCookie.replace(/[\r\n]+/g, '').trim();

  const targetUrl = `https://ro.gnjoylatam.com/pt/intro/shop-search/trading?storeType=BUY&serverType=FREYA&searchWord=${encodeURIComponent(item)}`;
  
  try {
    const headers = {
      'Cookie': userCookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(targetUrl, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return { success: false, price: null, error: `Erro HTTP: ${response.status}` };

    const htmlText = await response.text();
    if (htmlText.includes('member/login')) return { success: false, price: null, error: 'Cookie Expirado' };

    let prices = [];
    const lowerHtml = htmlText.toLowerCase();
    const lowerItem = item.toLowerCase();
    
    let searchIndex = 0;
    const foundIndices = [];
    while (true) {
        const idx = lowerHtml.indexOf(lowerItem, searchIndex);
        if (idx === -1) break;
        foundIndices.push(idx);
        searchIndex = idx + 1;
    }

    const priceRegex = />\s*([0-9]{1,3}(?:[.,]?[0-9]{3})*)\s*(?:z|Zeny)?\s*</i;

    if (foundIndices.length > 0) {
        for (const idx of foundIndices) {
             const contextChunk = htmlText.substring(idx, idx + 1500);
             const match = contextChunk.match(priceRegex);
             if (match) {
                 const val = parsePriceString(match[1]);
                 if (!isNaN(val) && val > 500 && val !== 20000000) prices.push(val);
             }
        }
    }

    if (prices.length > 0) return { success: true, price: Math.min(...prices) };
    if (htmlText.includes('não foram encontrados')) return { success: true, price: 0 };
    return { success: false, price: null, error: 'Preço ñ localizado' };
  } catch (error) {
    return { success: false, price: null, error: error.message };
  }
};

// =======================================================
// ROTAS DE API
// =======================================================

app.get('/api/db', (req, res) => res.json(GLOBAL_DB));

app.post('/api/db', (req, res) => {
  try {
    const { items, settings } = req.body;
    
    const mergedItems = items.map(newItem => {
        const existing = GLOBAL_DB.items.find(i => i.id === newItem.id);
        return {
            ...newItem,
            nextUpdate: newItem.nextUpdate || existing?.nextUpdate || 0,
            status: newItem.status === 'IDLE' ? (existing?.status || 'IDLE') : (newItem.status || existing?.status || 'IDLE'),
            lastPrice: newItem.lastPrice ?? existing?.lastPrice ?? null,
            lastUpdated: newItem.lastUpdated ?? existing?.lastUpdated ?? null,
            _loadingStart: existing?._loadingStart,
            isUserPrice: newItem.isUserPrice ?? existing?.isUserPrice ?? false,
            userKnownPrice: newItem.userKnownPrice ?? existing?.userKnownPrice ?? null,
            isAck: newItem.isAck ?? existing?.isAck ?? true
        };
    });

    GLOBAL_DB.items = mergedItems;
    GLOBAL_DB.settings = settings;
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar' });
  }
});

app.post('/api/ack/:id', (req, res) => {
    const item = GLOBAL_DB.items.find(i => i.id === req.params.id);
    if (item) { item.isAck = true; item.hasPriceDrop = false; saveDB(); res.json({ success: true }); }
    else res.status(404).json({ error: 'Not found' });
});

app.post('/api/ack-all', (req, res) => {
    GLOBAL_DB.items.forEach(i => { i.isAck = true; i.hasPriceDrop = false; });
    saveDB();
    res.json({ success: true });
});

app.get('/api/search', async (req, res) => {
    const result = await performScrape(req.query.item.toString(), req.headers['x-ro-cookie'] || GLOBAL_DB.settings.cookie);
    res.json(result);
});

// =======================================================
// AUTOMATION (ROBÔ COM PARALELISMO)
// =======================================================

const processItem = async (item) => {
  item.status = 'LOADING';
  item._loadingStart = Date.now();
  saveDB(); 
  
  const result = await performScrape(item.name, GLOBAL_DB.settings.cookie);
  const newPrice = result.price;
  const oldPrice = item.lastPrice;
  const isSuccess = result.success;

  const isCompChange = isSuccess && item.isUserPrice && newPrice !== null && newPrice !== item.userKnownPrice;
  const isPriceDrop = isSuccess && newPrice !== null && oldPrice !== null && newPrice < oldPrice;
  const isNewDeal = isSuccess && newPrice !== null && newPrice > 0 && newPrice <= item.targetPrice;

  const shouldAlert = isPriceDrop || isNewDeal || isCompChange;

  delete item._loadingStart;
  item.lastPrice = newPrice;
  item.lastUpdated = new Date().toISOString();
  item.status = isSuccess ? 'OK' : 'ERRO';
  item.message = result.error || undefined;
  
  // Agendamento de 2 minutos
  item.nextUpdate = Date.now() + (isSuccess ? UPDATE_INTERVAL_MS : ERROR_RETRY_MS);
  
  if (shouldAlert) {
     item.isAck = false;
     if (isPriceDrop) item.hasPriceDrop = true;
  }
  
  saveDB();
};

// Loop principal que gerencia o paralelismo (2 robôs)
setInterval(async () => {
  if (!GLOBAL_DB.settings?.isRunning) return;
  
  const now = Date.now();
  
  // Conta quantos robôs estão ocupados (LOADING)
  const activeJobs = GLOBAL_DB.items.filter(i => i.status === 'LOADING').length;
  
  // Se ainda temos "vagas" para robôs (máximo 2), pegamos o próximo da fila
  if (activeJobs < MAX_CONCURRENT_ROBOTS) {
    const candidates = GLOBAL_DB.items
      .filter(i => i.status !== 'LOADING' && (i.nextUpdate || 0) <= now)
      .sort((a, b) => (a.nextUpdate || 0) - (b.nextUpdate || 0));

    // Pega o melhor candidato se houver
    if (candidates.length > 0) {
      // Não damos await aqui para não bloquear o loop de disparar o próximo robô
      processItem(candidates[0]);
    }
  }
}, LOOP_TICK_MS);

app.listen(PORT, HOST, () => console.log(`Server ON: ${PORT} (2 Robôs Ativos - Ciclo 2min)`));
