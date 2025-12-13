
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
// Para evitar race conditions de leitura/escrita de arquivo,
// mantemos o estado na memória do Node e salvamos periodicamente.
let GLOBAL_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

// Função para persistir no disco
const saveDB = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(GLOBAL_DB, null, 2));
  } catch (e) {
    console.error("Erro ao salvar DB em disco:", e);
  }
};

app.use(cors());
app.use(express.json());

// Log básico
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
// ROTAS DE API
// =======================================================

// Ler dados (Retorna da Memória)
app.get('/api/db', (req, res) => {
  res.json(GLOBAL_DB);
});

// Salvar dados (Atualiza Memória e Disco)
app.post('/api/db', (req, res) => {
  try {
    const { items, settings } = req.body;
    if (!Array.isArray(items) || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Formato inválido' });
    }
    
    // Atualiza estado global
    GLOBAL_DB.items = items;
    GLOBAL_DB.settings = settings;
    
    saveDB(); // Persiste
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar DB:', error);
    res.status(500).json({ error: 'Erro ao salvar dados' });
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', time: new Date().toISOString() });
});

// =======================================================
// LÓGICA DE SCRAPING (CORE)
// =======================================================

const parsePriceString = (str) => {
  if (!str) return NaN;
  const numericStr = str.replace(/[^\d]/g, '');
  return parseInt(numericStr, 10);
};

// Função Interna de Scraping (Não exposta via rota, usada pelo loop)
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
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

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

    // Verificações de Login
    if (htmlText.includes('member/login') || htmlText.includes('signin-form')) {
        return { success: false, price: null, error: 'Precisa de novo Cookie' };
    }

    // Lógica de Extração de Preço
    const method1Regex = />\s*([0-9]{1,3}(?:[.,\s]?[0-9]{3})*)\s*z\s*</i;
    const match1 = htmlText.match(method1Regex);

    if (match1) {
        const val = parsePriceString(match1[1]);
        if (val > 100 && val < 1000000000 && val !== 20000000) {
             return { success: true, price: val };
        }
    }

    // Fallback search
    const method2Regex = />\s*([0-9,\.\s]+)\s*(?:z|Zeny)?\s*</gi;
    const matches2 = [...htmlText.matchAll(method2Regex)];
    let minPrice = Infinity;
    let found = false;

    for (const m of matches2) {
        const val = parsePriceString(m[1]);
        if (!isNaN(val) && val > 100 && val < 1000000000) {
            if (val === 20000000) continue;
            if (val !== 2023 && val !== 2024 && val !== 2025 && val !== 2026) {
                if (val < minPrice) {
                    minPrice = val;
                    found = true;
                }
            }
        }
    }

    if (found && minPrice !== Infinity) {
        return { success: true, price: minPrice };
    }

    if (htmlText.includes('não foram encontrados') || htmlText.includes('No results') || htmlText.includes('list-none')) {
        return { success: true, price: 0 }; // 0 significa sem estoque
    }
    
    return { success: false, price: null, error: 'Preço ñ encontrado' };

  } catch (error) {
    return { success: false, price: null, error: error.message };
  }
};

// =======================================================
// BACKGROUND AUTOMATION LOOP (O CÉREBRO)
// =======================================================
const UPDATE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos entre updates por item
const LOOP_TICK_MS = 2000; // O loop roda a cada 2 segundos procurando trabalho

const startAutomationLoop = () => {
  console.log("🚀 Automação de Background Iniciada");
  
  setInterval(async () => {
    // 1. Verifica se está ligado
    if (!GLOBAL_DB.settings?.isRunning) return;

    // 2. Verifica Pausa Noturna (01h - 08h)
    const h = new Date().getHours();
    const isNight = h >= 1 && h < 8;
    // (Poderíamos adicionar override aqui, mas vamos manter simples por enquanto)
    if (isNight) return;

    // 3. Encontra items para atualizar
    const now = Date.now();
    const candidates = GLOBAL_DB.items.filter(i => i.nextUpdate <= now && i.status !== 'LOADING');

    // Processa apenas 1 por vez para não sobrecarregar
    if (candidates.length > 0) {
      const item = candidates[0];
      
      console.log(`[AUTO] Verificando: ${item.name}`);
      
      // Marca como Loading
      item.status = 'LOADING';
      // Salva estado intermediário (opcional, mas bom para UI ver que está rodando)
      saveDB(); 

      // Scrape
      const result = await performScrape(item.name, GLOBAL_DB.settings.cookie);
      
      // Atualiza Item
      const newPrice = result.price;
      const oldPrice = item.lastPrice;
      const isSuccess = result.success;

      // Lógica de Negócio (Deal/Drop)
      const isDeal = isSuccess && newPrice !== null && newPrice > 0 && newPrice <= item.targetPrice;
      const wasDeal = oldPrice !== null && oldPrice > 0 && oldPrice <= item.targetPrice;
      
      const isPriceDrop = isSuccess && 
                          newPrice !== null && 
                          oldPrice !== null && 
                          newPrice > 0 && 
                          oldPrice > 0 && 
                          newPrice < oldPrice;

      const shouldResetAck = isPriceDrop || (isDeal && !wasDeal);

      // Atualiza campos
      item.lastPrice = newPrice;
      item.lastUpdated = new Date().toISOString();
      item.status = isSuccess ? (newPrice === 0 ? 'ALERTA' : 'OK') : 'ERRO';
      item.message = result.error || undefined;
      // Define próximo update (Sucesso: 2m, Erro: 1m)
      item.nextUpdate = isSuccess ? (Date.now() + UPDATE_INTERVAL_MS) : (Date.now() + 60000);
      
      if (shouldResetAck) {
         item.isAck = false;
         if (isPriceDrop) item.hasPriceDrop = true;
         console.log(`✨ ALERTA: ${item.name} caiu/oferta!`);
      }

      // Salva resultado final
      saveDB();
    }

  }, LOOP_TICK_MS);
};

// Inicia o loop
startAutomationLoop();

// Fallback Route
app.get('*', (req, res) => {
  if (fs.existsSync(join(distPath, 'index.html'))) {
    res.sendFile(join(distPath, 'index.html'));
  } else {
    res.send('Backend Server Online. Automation Running.');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server rodando em http://${HOST}:${PORT}`);
});
