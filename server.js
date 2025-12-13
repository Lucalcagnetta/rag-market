
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

// Garante que a pasta de dados existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Inicializa o DB se não existir
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ 
    items: [], 
    settings: { cookie: '', useProxy: false, proxyUrl: '', isRunning: true } 
  }));
}

// --- STATE MANAGEMENT (IN-MEMORY with FLUSH) ---
let GLOBAL_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

// Função para persistir no disco
const saveDB = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(GLOBAL_DB, null, 2));
  } catch (e) {
    console.error("Erro ao salvar DB em disco:", e);
  }
};

// --- LIMPEZA DE INICIALIZAÇÃO ---
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

app.use((req, res, next) => {
  if (req.url !== '/api/health' && req.url !== '/api/db') { 
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

const distPath = join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// =======================================================
// LÓGICA DE SCRAPING (CORE)
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
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(targetUrl, { 
      method: 'GET', 
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (response.status === 403 || response.status === 401) {
        return { success: false, price: null, error: `Acesso negado (${response.status})` };
    }

    if (!response.ok) {
        return { success: false, price: null, error: `Erro HTTP: ${response.status}` };
    }

    const htmlText = await response.text();

    if (htmlText.includes('member/login') || htmlText.includes('signin-form')) {
        return { success: false, price: null, error: 'Precisa de novo Cookie' };
    }

    // --- REGEX MELHORADA ---
    // Procura especificamente por números seguidos de 'z' ou 'Zeny'.
    // Removemos a opção do 'z' ser opcional para evitar pegar datas ou quantidades.
    const strictPriceRegex = />\s*([0-9]{1,3}(?:[.,\s]?[0-9]{3})*)\s*(?:z|Zeny)\s*</gi;
    const matches = [...htmlText.matchAll(strictPriceRegex)];
    
    let minPrice = Infinity;
    let found = false;

    for (const m of matches) {
        const val = parsePriceString(m[1]);
        if (!isNaN(val) && val > 100 && val < 2000000000) {
            // Ignora valores que parecem anos (2024, 2025) a menos que sejam muito específicos
            if (val === 2023 || val === 2024 || val === 2025 || val === 2026) continue;
            // Ignora valor máximo padrão de busca (20kk exatos as vezes é placeholder)
            if (val === 20000000) continue;

            if (val < minPrice) {
                minPrice = val;
                found = true;
            }
        }
    }

    if (found && minPrice !== Infinity) {
        return { success: true, price: minPrice };
    }

    if (htmlText.includes('não foram encontrados') || htmlText.includes('No results') || htmlText.includes('list-none')) {
        return { success: true, price: 0 };
    }
    
    return { success: false, price: null, error: 'Preço ñ encontrado' };

  } catch (error) {
    return { success: false, price: null, error: error.message };
  }
};

// =======================================================
// ROTAS DE API
// =======================================================

app.get('/api/db', (req, res) => {
  res.json(GLOBAL_DB);
});

// POST DB COMPLETO (Usado para adicionar/remover itens)
app.post('/api/db', (req, res) => {
  try {
    const { items, settings } = req.body;
    if (!Array.isArray(items) || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Formato inválido' });
    }
    
    // Preserva loadingStart para não quebrar items em andamento
    const newItems = items.map(newItem => {
        const existing = GLOBAL_DB.items.find(i => i.id === newItem.id);
        if (existing && existing._loadingStart) {
            return { ...newItem, _loadingStart: existing._loadingStart };
        }
        // Se o frontend mandar algo antigo, preservamos o estado do backend se for mais recente?
        // Difícil sincronizar sem complexidade. Vamos confiar no array do frontend para ADD/REMOVE,
        // mas as rotas de ACK abaixo evitam o problema de sobrescrita de status.
        return newItem;
    });

    GLOBAL_DB.items = newItems;
    GLOBAL_DB.settings = settings;
    saveDB();
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar DB:', error);
    res.status(500).json({ error: 'Erro ao salvar dados' });
  }
});

// NOVA ROTA: ACK ITEM (Marca como visto sem sobrescrever tudo)
app.post('/api/ack/:id', (req, res) => {
    const { id } = req.params;
    const item = GLOBAL_DB.items.find(i => i.id === id);
    if (item) {
        item.isAck = true;
        item.hasPriceDrop = false;
        saveDB();
        console.log(`[API] Item ${item.name} marcado como visto.`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Item not found' });
    }
});

// NOVA ROTA: ACK ALL
app.post('/api/ack-all', (req, res) => {
    GLOBAL_DB.items.forEach(i => {
        i.isAck = true;
        i.hasPriceDrop = false;
    });
    saveDB();
    console.log(`[API] Todos os itens marcados como visto.`);
    res.json({ success: true });
});

app.get('/api/search', async (req, res) => {
    const { item } = req.query;
    const cookie = req.headers['x-ro-cookie'] || GLOBAL_DB.settings.cookie;
    if (!item) return res.status(400).json({ success: false, error: 'Item missing' });
    const result = await performScrape(item.toString(), cookie);
    res.json(result);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', time: new Date().toISOString() });
});

// =======================================================
// AUTOMATION LOOPS
// =======================================================
const UPDATE_INTERVAL_MS = 2 * 60 * 1000; 
const LOOP_TICK_MS = 2000; 

const startWatchdog = () => {
  setInterval(() => {
    if (!GLOBAL_DB.settings?.isRunning) return;
    const now = Date.now();
    let changed = false;
    GLOBAL_DB.items = GLOBAL_DB.items.map(item => {
       if (item.status === 'LOADING') {
          const isStuck = item._loadingStart ? (now - item._loadingStart > 45000) : true;
          if (isStuck) {
             changed = true;
             const { _loadingStart, ...rest } = item; 
             return { ...rest, status: 'ERRO', message: 'Timeout', nextUpdate: now + 5000 };
          }
       }
       return item;
    });
    if (changed) saveDB();
  }, 15000);
};

const processItem = async (item, workerName) => {
  console.log(`[${workerName}] Verificando: ${item.name}`);
  item.status = 'LOADING';
  item._loadingStart = Date.now();
  saveDB(); 

  const result = await performScrape(item.name, GLOBAL_DB.settings.cookie);
  
  const newPrice = result.price;
  const oldPrice = item.lastPrice;
  const isSuccess = result.success;

  const isDeal = isSuccess && newPrice !== null && newPrice > 0 && newPrice <= item.targetPrice;
  // Se oldPrice era null, consideramos que AGORA sabemos o preço, mas só notificamos se for Deal.
  // wasDeal previne spam se o preço se mantiver baixo.
  const wasDeal = oldPrice !== null && oldPrice > 0 && oldPrice <= item.targetPrice;
  
  const isPriceDrop = isSuccess && newPrice !== null && oldPrice !== null && newPrice > 0 && oldPrice > 0 && newPrice < oldPrice;

  // Só reseta o ACK se: 
  // 1. O preço caiu mais ainda (isPriceDrop)
  // 2. OU se virou um Deal agora e não era antes (ex: usuário mudou alvo ou preço caiu abaixo do alvo)
  const shouldResetAck = isPriceDrop || (isDeal && !wasDeal);

  delete item._loadingStart;
  item.lastPrice = newPrice;
  item.lastUpdated = new Date().toISOString();
  item.status = isSuccess ? (newPrice === 0 ? 'ALERTA' : 'OK') : 'ERRO';
  item.message = result.error ? `[${workerName}] ${result.error}` : undefined;
  item.nextUpdate = isSuccess ? (Date.now() + UPDATE_INTERVAL_MS) : (Date.now() + 60000);
  
  // IMPORTANTE: Só alteramos isAck para FALSE. Nunca para TRUE aqui.
  if (shouldResetAck) {
     item.isAck = false;
     if (isPriceDrop) item.hasPriceDrop = true;
     console.log(`✨ [${workerName}] ALERTA: ${item.name}`);
  }

  saveDB();
};

const startAutomationLoop = () => {
  console.log("🚀 Automação de Background Iniciada");
  startWatchdog();
  
  setInterval(async () => {
    if (!GLOBAL_DB.settings?.isRunning) return;
    const h = new Date().getHours();
    if (h >= 1 && h < 8) return;
    const now = Date.now();
    const candidates = GLOBAL_DB.items.filter(i => i.nextUpdate <= now && i.status !== 'LOADING');
    if (candidates.length > 0) {
      await processItem(candidates[0], "TOP");
    }
  }, LOOP_TICK_MS);

  setTimeout(() => {
    setInterval(async () => {
      if (!GLOBAL_DB.settings?.isRunning) return;
      const h = new Date().getHours();
      if (h >= 1 && h < 8) return;
      const now = Date.now();
      const candidates = GLOBAL_DB.items.filter(i => i.nextUpdate <= now && i.status !== 'LOADING');
      if (candidates.length > 0) {
        await processItem(candidates[candidates.length - 1], "BOT");
      }
    }, LOOP_TICK_MS);
  }, 1000); 
};

startAutomationLoop();

app.get('*', (req, res) => {
  if (fs.existsSync(join(distPath, 'index.html'))) {
    res.sendFile(join(distPath, 'index.html'));
  } else {
    res.send('Backend Server Online.');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server rodando em http://${HOST}:${PORT}`);
});
