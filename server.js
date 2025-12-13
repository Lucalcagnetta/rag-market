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

app.use(cors());
app.use(express.json());

// Log de requisições para debug
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const distPath = join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Função auxiliar para limpar e converter preço
const parsePriceString = (str) => {
  if (!str) return NaN;
  // Remove z, Z, espaços e quebras de linha
  const cleanStr = str.replace(/[zZ\s\u00A0\n\t]/g, ''); 
  // Remove tudo que não é dígito
  const numericStr = cleanStr.replace(/\D/g, '');
  return parseInt(numericStr, 10);
};

// Função para remover scripts e styles que podem confundir o scraper
const sanitizeHtml = (html) => {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', time: new Date().toISOString() });
});

app.get('/api/search', async (req, res) => {
  const { item } = req.query;
  let userCookie = req.headers['x-ro-cookie'] || ''; 

  // --- CORREÇÃO DO COOKIE ---
  if (userCookie) {
    userCookie = userCookie.replace(/[\r\n]+/g, '').trim();
    // Debug curto para saber se o cookie chegou
    console.log(`[DEBUG] Cookie recebido (inicio): ${userCookie.substring(0, 20)}...`);
  } else {
    console.log(`[DEBUG] Nenhum cookie recebido no header.`);
  }

  if (!item) {
    return res.status(400).json({ success: false, error: 'Nome do item obrigatório' });
  }

  const targetUrl = `https://ro.gnjoylatam.com/pt/intro/shop-search/trading?storeType=BUY&serverType=FREYA&searchWord=${encodeURIComponent(item)}`;

  console.log(`[SCRAPER] Buscando: ${item} -> ${targetUrl}`);

  try {
    const headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Referer': 'https://ro.gnjoylatam.com/pt/intro/shop-search',
      'Upgrade-Insecure-Requests': '1'
    };

    if (userCookie) {
      headers['Cookie'] = userCookie;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, { 
      method: 'GET', 
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (response.status === 403 || response.status === 401) {
        console.error(`[ERRO] Acesso negado: ${response.status}`);
        return res.json({ success: false, price: null, error: `Acesso Negado (${response.status}). Cookie inválido.` });
    }

    if (!response.ok) {
        return res.json({ success: false, price: null, error: `Erro no site do Ragnarok: ${response.status}` });
    }

    let htmlText = await response.text();
    
    // --- VERIFICAÇÃO DE LOGIN ---
    if (htmlText.includes('name="password"') || htmlText.includes('name="account"')) {
        return res.json({ success: false, price: null, error: 'Login necessário (Cookie expirou).' });
    }

    // --- LIMPEZA ---
    // Remove scripts e styles para evitar casar "width: 800px" como preço
    htmlText = sanitizeHtml(htmlText);
    
    // --- LÓGICA DE EXTRAÇÃO ESTRITA ---
    let candidates = [];

    // Regex Estrito: Procura números (com ou sem ponto) seguidos obrigatoriamente de 'z'
    // Ex: "100.000 z", "50 z", "<span>179.899.999</span> z"
    // (?:<[^>]+>)* permite tags HTML no meio
    const strictRegex = /([\d\.]{1,15})\s*(?:<[^>]+>)*\s*z/gi;
    const strictMatches = [...htmlText.matchAll(strictRegex)];
    
    for (const match of strictMatches) {
        const rawValue = match[1];
        const val = parsePriceString(rawValue);
        
        if (!isNaN(val)) {
            // Filtro de Segurança:
            // 1. Ignora valores menores que 100z (Evita pegar paginação "1 z" se houver bug, ou lixo)
            // 2. Ignora valores gigantes irreais se houver erro de parse
            if (val > 100) {
                 candidates.push(val);
            }
        }
    }

    // --- ANÁLISE DE RESULTADOS ---

    if (candidates.length > 0) {
        const minPrice = Math.min(...candidates);
        console.log(`[SUCESSO] ${item}: ${candidates.length} valores encontrados. Menor: ${minPrice}`);
        return res.json({
            success: true,
            price: minPrice
        });
    }

    // --- DIAGNÓSTICO DE ERRO (SEM PREÇOS) ---
    if (
      htmlText.includes('não foram encontrados') || 
      htmlText.includes('No results') || 
      htmlText.includes('list-none') ||
      htmlText.includes('Resultado da pesquisa 0')
    ) {
        return res.json({ success: true, price: 0, error: 'Sem vendedores no momento.' });
    }
    
    return res.json({ success: false, price: null, error: 'Preço não encontrado (layout mudou ou sem ofertas).' });

  } catch (error) {
    console.error(`[ERRO CRÍTICO] ${item}:`, error.message);
    return res.json({ success: false, price: null, error: `Erro interno: ${error.message}` });
  }
});

app.get('*', (req, res) => {
  if (fs.existsSync(join(distPath, 'index.html'))) {
    res.sendFile(join(distPath, 'index.html'));
  } else {
    res.send('Backend Online. Frontend not built.');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Ragnarok Scraper rodando em http://${HOST}:${PORT}`);
});