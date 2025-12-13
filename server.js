
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
  fs.writeFileSync(DB_FILE, JSON.stringify({ items: [], settings: {} }));
}

app.use(cors());
app.use(express.json());

// Log básico de requisições
app.use((req, res, next) => {
  if (req.url !== '/api/health') { // Evita spam de log no health check
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

const distPath = join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// =======================================================
// ROTAS DE PERSISTÊNCIA (BANCO DE DADOS)
// =======================================================

// Ler dados
app.get('/api/db', (req, res) => {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return res.json({ items: [], settings: {} });
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error('Erro ao ler DB:', error);
    res.status(500).json({ error: 'Erro ao ler dados' });
  }
});

// Salvar dados
app.post('/api/db', (req, res) => {
  try {
    const { items, settings } = req.body;
    // Validação básica
    if (!Array.isArray(items) || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Formato inválido' });
    }

    fs.writeFileSync(DB_FILE, JSON.stringify({ items, settings }, null, 2));
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar DB:', error);
    res.status(500).json({ error: 'Erro ao salvar dados' });
  }
});


// =======================================================
// LÓGICA ESPELHADA DO GOOGLE APPS SCRIPT (SCRAPER)
// =======================================================

// Função auxiliar idêntica ao GAS
const parsePriceString = (str) => {
  if (!str) return NaN;
  // Remove tudo que não for dígito
  const numericStr = str.replace(/[^\d]/g, '');
  return parseInt(numericStr, 10);
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', time: new Date().toISOString() });
});

app.get('/api/search', async (req, res) => {
  const { item } = req.query;
  let userCookie = req.headers['x-ro-cookie'] || ''; 

  if (userCookie) {
    userCookie = userCookie.replace(/[\r\n]+/g, '').trim();
  }

  if (!item) {
    return res.status(400).json({ success: false, error: 'Nome do item obrigatório' });
  }

  const targetUrl = `https://ro.gnjoylatam.com/pt/intro/shop-search/trading?storeType=BUY&serverType=FREYA&searchWord=${encodeURIComponent(item)}`;

  console.log(`[SCRAPER] Buscando: ${item}`);

  try {
    // Headers Reforçados para evitar 403/502 (Mantido da versão funcional)
    const headers = {
      'Cookie': userCookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://ro.gnjoylatam.com/',
      'Origin': 'https://ro.gnjoylatam.com',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1'
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); 

    const response = await fetch(targetUrl, { 
      method: 'GET', 
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    const status = response.status;
    
    // 1. Verificações de Status HTTP
    if (status === 403 || status === 401) {
        console.error(`[ERRO] Acesso negado: ${status}`);
        return res.json({ success: false, price: null, error: `Acesso negado (Verifique o Cookie)` });
    }

    if (status === 502 || status === 500) {
        return res.json({ success: false, price: null, error: `Erro Servidor RO (${status})` });
    }

    if (!response.ok) {
        return res.json({ success: false, price: null, error: `Erro HTTP: ${status}` });
    }

    const htmlTextRaw = await response.text();
    console.log(`📡 HTTP ${status} - ${htmlTextRaw.length} chars`);
    
    // LIMPEZA BÁSICA
    const htmlText = htmlTextRaw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');

    // 2. Verificações de Conteúdo (Login/Bloqueio)
    if (htmlText.includes('member/login') || htmlText.includes('signin-form') || htmlText.includes('name="password"')) {
        return res.json({ success: false, price: null, error: 'Login Expirado' });
    }

    if (htmlText.includes('Access Denied') || htmlText.includes('access denied')) {
        return res.json({ success: false, price: null, error: 'IP Bloqueado' });
    }

    // =======================================================
    // BUSCA DE PREÇO - RETORNO À LÓGICA CLÁSSICA
    // =======================================================
    
    let pricesFound = [];

    // Regex Original Robusta: Procura número + 'z'
    // Ex: 1.000 z | 1.000z | 1.000 <span...>z
    // Essa regex garante que é um valor monetário e evita números aleatórios do site
    const priceRegex = /([0-9]{1,3}(?:[.,][0-9]{3})*)\s*(?:<[^>]+>\s*)*z/gi;
    
    const matches = [...htmlText.matchAll(priceRegex)];
    for (const m of matches) {
       pricesFound.push(parsePriceString(m[1]));
    }

    // FILTRAGEM DE PREÇOS
    const validPrices = pricesFound
      .filter(val => {
         if (isNaN(val)) return false;
         if (val < 100) return false; // Ignora quantidades pequenas
         
         // FILTRO CRÍTICO: Ignora o saldo do cabeçalho
         // Se o usuário tem 20kk ou se é um placeholder do site, removemos.
         if (val === 20000000) return false; 

         if (val > 3000000000) return false; // > 3bi = erro
         
         // Filtra anos
         if (val >= 2023 && val <= 2026) return false;
         
         return true;
      })
      .sort((a, b) => a - b); // Ordena do menor para o maior

    if (validPrices.length > 0) {
        const bestPrice = validPrices[0];
        console.log(`[SUCESSO] ${item}: ${bestPrice} z`);
        return res.json({ success: true, price: bestPrice });
    }

    // 3. Verifica "Sem resultados"
    if (
      htmlText.includes('não foram encontrados') || 
      htmlText.includes('No results') || 
      htmlText.includes('list-none') ||
      htmlText.includes('Resultado da pesquisa 0') ||
      htmlText.includes('No items found') ||
      htmlText.includes('Nenhum resultado')
    ) {
        return res.json({ success: true, price: 0, error: 'Sem ofertas' });
    }
    
    console.log(`[FALHA] Preço não encontrado no HTML para: ${item}`);
    return res.json({ success: false, price: null, error: 'Formato desconhecido' });

  } catch (error) {
    console.error(`[ERRO CRÍTICO] ${item}:`, error.message);
    return res.json({ success: false, price: null, error: error.message });
  }
});

app.get('*', (req, res) => {
  if (fs.existsSync(join(distPath, 'index.html'))) {
    res.sendFile(join(distPath, 'index.html'));
  } else {
    res.send('Backend Online. Frontend not built. Run "npm run build"');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Ragnarok Scraper rodando em http://${HOST}:${PORT}`);
});
