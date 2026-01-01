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
    if (item.status === 'ERRO' && item.message && item.message.includes('Unexpected token')) {
      changed = true;
      return { ...item, status: 'IDLE', nextUpdate: 0, message: undefined };
    }
    if (item.status === 'LOADING') {
      changed = true;
      const { _loadingStart, ...rest } = item;
      return { ...rest, status: 'IDLE', nextUpdate: 0 };
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
    
    // Mapeamento explícito para garantir persistência de campos do usuário
    const mergedItems = items.map(newItem => {
        const existing = GLOBAL_DB.items.find(i => i.id === newItem.id);
        return {
            ...newItem,
            // Preserva estado de carregamento se houver
            _loadingStart: existing?._loadingStart,
            // Garante que flags de usuário sejam respeitadas
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
// AUTOMATION
// =======================================================

const processItem = async (item) => {
  item.status = 'LOADING';
  item._loadingStart = Date.now();
  
  const result = await performScrape(item.name, GLOBAL_DB.settings.cookie);
  const newPrice = result.price;
  const oldPrice = item.lastPrice;
  const isSuccess = result.success;

  // Mudança de competição: preço atual difere do preço que o usuário fixou como dele
  const isCompChange = isSuccess && item.isUserPrice && newPrice !== null && newPrice !== item.userKnownPrice;
  const isPriceDrop = isSuccess && newPrice !== null && oldPrice !== null && newPrice < oldPrice;
  const isNewDeal = isSuccess && newPrice !== null && newPrice > 0 && newPrice <= item.targetPrice;

  // Resetar isAck se houver mudança relevante para disparar som no front
  const shouldAlert = isPriceDrop || isNewDeal || isCompChange;

  delete item._loadingStart;
  item.lastPrice = newPrice;
  item.lastUpdated = new Date().toISOString();
  item.status = isSuccess ? 'OK' : 'ERRO';
  item.nextUpdate = Date.now() + (2 * 60 * 1000);
  
  if (shouldAlert) {
     item.isAck = false;
     if (isPriceDrop) item.hasPriceDrop = true;
  }
  
  saveDB();
};

setInterval(async () => {
  if (!GLOBAL_DB.settings?.isRunning) return;
  const now = Date.now();
  const candidate = GLOBAL_DB.items.find(i => i.nextUpdate <= now && i.status !== 'LOADING');
  if (candidate) await processItem(candidate);
}, 3000);

app.listen(PORT, HOST, () => console.log(`Server ON: ${PORT}`));