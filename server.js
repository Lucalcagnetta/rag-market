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

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', time: new Date().toISOString() });
});

app.get('/api/search', async (req, res) => {
  const { item } = req.query;
  let userCookie = req.headers['x-ro-cookie'] || ''; 

  // --- CORREÇÃO CRÍTICA DO COOKIE ---
  // Remove quebras de linha e espaços que vêm do copy-paste
  if (userCookie) {
    userCookie = userCookie.replace(/[\r\n]+/g, '').trim();
  }

  if (!item) {
    return res.status(400).json({ success: false, error: 'Nome do item obrigatório' });
  }

  // URL exata solicitada
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
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1'
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
        return res.json({ success: false, price: null, error: `Acesso Negado (${response.status}). Renove o Cookie.` });
    }

    if (!response.ok) {
        return res.json({ success: false, price: null, error: `Erro no site do Ragnarok: ${response.status}` });
    }

    const htmlText = await response.text();
    
    // --- LÓGICA DE EXTRAÇÃO BLINDADA ---
    let candidates = [];

    // ESTRATÉGIA 1: Busca exata "123.456 z" (mesmo com tags no meio)
    // Regex: Números com ponto + tags opcionais + z
    const strictRegex = /(\d{1,3}(?:\.\d{3})+)\s*(?:<[^>]+>)*\s*z/gi;
    const strictMatches = [...htmlText.matchAll(strictRegex)];
    
    for (const match of strictMatches) {
        const val = parsePriceString(match[1]);
        if (!isNaN(val)) candidates.push(val);
    }

    // ESTRATÉGIA 2: Busca ampla por qualquer padrão numérico "123.456"
    // Útil se o HTML mudou e o 'z' está em outra div longe
    if (candidates.length === 0) {
        console.log(`[DEBUG] Busca estrita falhou para ${item}, ativando busca ampla...`);
        // Procura strings que pareçam preços (ex: 179.899.999)
        // \b garante que não estamos pegando parte de um ID
        const looseRegex = /\b\d{1,3}(?:\.\d{3})+\b/g;
        const looseMatches = [...htmlText.matchAll(looseRegex)];
        
        for (const match of looseMatches) {
             const val = parsePriceString(match[0]);
             
             if (!isNaN(val)) {
                // Filtros de segurança para não pegar Lixo, Anos ou IDs
                // Preço > 500z
                // Ignorar anos comuns (2020-2030) se o valor for baixo
                if (val > 500) {
                   if (val >= 2020 && val <= 2030) continue; // Ignora possível data
                   candidates.push(val);
                }
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

    // --- DIAGNÓSTICO DE ERRO ---
    
    if (htmlText.includes('name="password"') || htmlText.includes('name="account"')) {
        return res.json({ success: false, price: null, error: 'Login necessário (Cookie expirou).' });
    }

    // Tenta detectar mensagem de "não encontrado" em PT, ES ou EN
    if (
      htmlText.includes('não foram encontrados') || 
      htmlText.includes('No results') || 
      htmlText.includes('list-none') ||
      htmlText.includes('Resultado da pesquisa 0')
    ) {
        return res.json({ success: true, price: 0, error: 'Sem vendedores no momento.' });
    }

    // Se chegou aqui, o HTML veio mas não conseguimos ler.
    // console.log(`[DEBUG HTML] Dump parcial:`, htmlText.substring(0, 1000));
    
    return res.json({ success: false, price: null, error: 'Item não encontrado ou layout mudou.' });

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