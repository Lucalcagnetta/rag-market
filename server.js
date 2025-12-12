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
  const userCookie = req.headers['x-ro-cookie'] || ''; 

  if (!item) {
    return res.status(400).json({ success: false, error: 'Nome do item obrigatório' });
  }

  // URL baseada na documentação do Ragnarok Latam
  // NOTA: storeType=BUY procura lojas de COMPRA (pessoas querendo comprar).
  // Se quiser ver lojas vendendo, seria storeType=SELL. Mantendo BUY conforme solicitado.
  const targetUrl = `https://ro.gnjoylatam.com/pt/intro/shop-search/trading?storeType=BUY&serverType=FREYA&searchWord=${encodeURIComponent(item)}`;

  console.log(`[SCRAPER] Buscando: ${item} -> ${targetUrl}`);

  try {
    const headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
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
    
    // --- LÓGICA DE EXTRAÇÃO ---
    let candidates = [];

    // 1. Tentar encontrar padrão visual exato "123.456 z" (pode ter tags no meio)
    // Regex explicaçao: 
    // (\d{1,3}(?:\.\d{3})+) -> Pega números formatados obrigatoriamente com pontos (ex: 1.000). Evita pegar "1" ou "20".
    // \s* -> Espaços opcionais
    // (?:<[^>]*>)* -> Ignora tags HTML que possam estar no meio (ex: <span>)
    // \s*z -> Termina com z (case insensitive)
    const strictRegex = /(\d{1,3}(?:\.\d{3})+)\s*(?:<[^>]*>)*\s*z/gi;
    const strictMatches = [...htmlText.matchAll(strictRegex)];
    
    for (const match of strictMatches) {
        const val = parsePriceString(match[1]);
        if (!isNaN(val)) candidates.push(val);
    }

    // 2. Fallback: Se não achou com 'z', procura qualquer número formatado com pontos
    // Isso ajuda se o site mudou a posição do 'z'
    if (candidates.length === 0) {
        console.log(`[DEBUG] Modo estrito falhou para ${item}, tentando busca genérica de números...`);
        // Procura strings numéricas isoladas que tenham separador de milhar (ponto)
        const looseRegex = />\s*(\d{1,3}(?:\.\d{3})+)\s*</g;
        const looseMatches = [...htmlText.matchAll(looseRegex)];
        
        for (const match of looseMatches) {
             const val = parsePriceString(match[1]);
             // Filtros de segurança para não pegar IDs ou anos
             if (!isNaN(val)) {
                // Ragnarok tem preços altos. Ignorar números pequenos soltos se não tinham 'z'
                // E ignorar anos (2020-2030)
                if (val > 500 && (val < 2020 || val > 2030)) {
                    candidates.push(val);
                }
             }
        }
    }

    // --- ANÁLISE DE RESULTADOS ---

    if (candidates.length > 0) {
        // Encontramos preços!
        const minPrice = Math.min(...candidates);
        console.log(`[SUCESSO] ${item}: Preços encontrados [${candidates.length}] -> Menor: ${minPrice}`);
        return res.json({
            success: true,
            price: minPrice
        });
    }

    // --- TRATAMENTO DE ERROS DE CONTEÚDO ---
    
    // Verifica se caiu na tela de login
    if (htmlText.includes('name="password"') || htmlText.includes('name="account"')) {
        return res.json({ success: false, price: null, error: 'Login necessário (Cookie expirou).' });
    }

    // Verifica se não achou nada
    if (htmlText.includes('não foram encontrados') || htmlText.includes('No results') || htmlText.includes('list-none')) {
        return res.json({ success: true, price: 0, error: 'Sem vendedores no momento.' });
    }

    // Debug final: Se chegou aqui, o HTML veio mas não conseguimos ler.
    // console.log(`[DEBUG HTML] Inicio do HTML recebido:`, htmlText.substring(0, 500));
    
    return res.json({ success: false, price: null, error: 'Preço não identificado no HTML.' });

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