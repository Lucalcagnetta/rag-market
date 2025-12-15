
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
    settings: { 
      cookie: '', 
      useProxy: false, 
      proxyUrl: '', 
      isRunning: true,
      ignoreNightPause: false
    } 
  }));
}

// --- STATE MANAGEMENT (IN-MEMORY with FLUSH) ---
let GLOBAL_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

// Garante que ignoreNightPause existe se vier de um DB antigo
if (typeof GLOBAL_DB.settings.ignoreNightPause === 'undefined') {
  GLOBAL_DB.settings.ignoreNightPause = false;
}

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
  // Remove tudo que não é dígito
  const numericStr = str.replace(/[^\d]/g, '');
  return parseInt(numericStr, 10);
};

// Escapa string para regex
const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
};

const performScrape = async (item, cookie) => {
  let userCookie = cookie || ''; 
  if (userCookie) userCookie = userCookie.replace(/[\r\n]+/g, '').trim();

  // A busca usa LIKE%, então precisamos ser espertos na filtragem do resultado
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

    // --- ESTRATÉGIA DE EXTRAÇÃO DE PREÇO V3 (CONTEXTUAL) ---
    // O problema anterior era: 
    // V1 (Estrita): Falhava se o HTML não tivesse 'z' colado.
    // V2 (Solta): Pegava preços de itens errados (ex: Fragmento custando 12kk quando buscava o Item de 300kk)
    // V3 (Contextual): Busca o nome do item no HTML e procura um preço logo em seguida.

    let prices = [];
    
    // Divide o termo de busca em palavras para ser flexível (caso o HTML tenha tags no meio do nome)
    // Mas para segurança máxima contra "Fragmento de X", tentamos achar o nome completo primeiro.
    
    // Normaliza para facilitar busca
    const lowerHtml = htmlText.toLowerCase();
    const lowerItem = item.toLowerCase();
    
    // Encontra todas as posições onde o nome do item aparece
    let searchIndex = 0;
    const foundIndices = [];
    while (true) {
        const idx = lowerHtml.indexOf(lowerItem, searchIndex);
        if (idx === -1) break;
        foundIndices.push(idx);
        searchIndex = idx + 1;
    }

    // Regex para pegar preço (Generosa, pois já temos o contexto)
    // Procura > NÚMERO <
    const priceRegex = />\s*([0-9]{1,3}(?:[.,]?[0-9]{3})*)\s*(?:z|Zeny)?\s*</i;

    if (foundIndices.length > 0) {
        // Para cada ocorrência do nome, olha os próximos 1500 caracteres (suficiente para cobrir a linha da tabela)
        for (const idx of foundIndices) {
             const contextChunk = htmlText.substring(idx, idx + 1500);
             
             // Aplica a regex no chunk
             const match = contextChunk.match(priceRegex);
             if (match) {
                 const val = parsePriceString(match[1]);
                 if (!isNaN(val)) {
                     // Filtros de sanidade
                     if (val >= 2023 && val <= 2030) continue; // Anos
                     if (val < 500) continue; // Qtd pequena
                     if (val === 20000000) continue; // Placeholder
                     
                     prices.push(val);
                 }
             }
        }
    }

    // Se a busca contextual falhou (talvez o nome esteja quebrado por HTML tags <b>Nome</b>),
    // Tentamos o fallback Global (V2), mas com mais rigor.
    if (prices.length === 0) {
        // Regex V2 (Solta Global)
        const loosePriceRegex = />\s*([0-9]{1,3}(?:[.,]?[0-9]{3})*)\s*(?:z|Zeny)?\s*</gi;
        const matches = [...htmlText.matchAll(loosePriceRegex)];
        
        for (const m of matches) {
            const val = parsePriceString(m[1]);
            if (!isNaN(val)) {
                if (val >= 2023 && val <= 2030) continue;
                if (val < 500) continue;
                if (val === 20000000) continue;
                prices.push(val);
            }
        }
    }

    if (prices.length > 0) {
        const minPrice = Math.min(...prices);
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

// Helper para pegar a hora no fuso de Brasília, independente do servidor
const getBrazilHour = () => {
    const date = new Date();
    // Força o fuso horário para São Paulo
    const options = { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false };
    const hourString = new Intl.DateTimeFormat('en-US', options).format(date);
    return parseInt(hourString, 10);
};

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
    
    // FIX: Usa hora do Brasil, não do servidor (UTC)
    const h = getBrazilHour();
    
    // Só pausa se ignoreNightPause for falso
    if (!GLOBAL_DB.settings.ignoreNightPause && h >= 1 && h < 8) return;

    const now = Date.now();
    const candidates = GLOBAL_DB.items.filter(i => i.nextUpdate <= now && i.status !== 'LOADING');
    if (candidates.length > 0) {
      await processItem(candidates[0], "TOP");
    }
  }, LOOP_TICK_MS);

  setTimeout(() => {
    setInterval(async () => {
      if (!GLOBAL_DB.settings?.isRunning) return;
      
      // FIX: Usa hora do Brasil, não do servidor (UTC)
      const h = getBrazilHour();
      // Só pausa se ignoreNightPause for falso
      if (!GLOBAL_DB.settings.ignoreNightPause && h >= 1 && h < 8) return;

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
