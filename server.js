import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;
const HOST = '0.0.0.0'; // Força IPv4 para evitar erro de Gateway no Nginx

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
} else {
  console.warn('[AVISO] Pasta dist/ não encontrada. Rode "npm run build".');
}

const parsePriceString = (str) => {
  if (!str) return NaN;
  const cleanStr = str.replace(/[zZ\s\u00A0]/g, ''); 
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

  // URL exata fornecida
  const targetUrl = `https://ro.gnjoylatam.com/pt/intro/shop-search/trading?storeType=BUY&serverType=FREYA&searchWord=${encodeURIComponent(item)}`;

  try {
    const headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Cache-Control': 'max-age=0',
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
        return res.json({ success: false, price: null, error: `Acesso Negado (${response.status}). Renove o Cookie.` });
    }

    if (!response.ok) {
        return res.json({ success: false, price: null, error: `Erro no site do Ragnarok: ${response.status}` });
    }

    const htmlText = await response.text();
    
    const priceRegex = /([0-9]{1,3}(?:[.,]?[0-9]{3})*)\s*z/gi;
    const regexMatches = [...htmlText.matchAll(priceRegex)];
    let candidates = [];

    for (const match of regexMatches) {
        const val = parsePriceString(match[1]);
        if (!isNaN(val)) candidates.push(val);
    }

    if (candidates.length === 0) {
        const allNumbersMatch = htmlText.match(/\d{1,3}(?:[.,]\d{3})*(?!\d)/g);
        if (allNumbersMatch) {
            for (const numStr of allNumbersMatch) {
                const val = parsePriceString(numStr);
                if (!isNaN(val)) {
                    if (val >= 100 && val <= 2000000000) {
                        if (val !== 2024 && val !== 2025 && val !== 2023) { 
                            candidates.push(val);
                        }
                    }
                }
            }
        }
    }

    if (candidates.length === 0) {
        if (htmlText.includes('não foram encontrados') || htmlText.includes('No results') || htmlText.includes('resultado da pesquisa')) {
            return res.json({ success: true, price: 0, error: 'Sem vendedores no momento.' });
        }
        if (htmlText.includes('login') && (htmlText.includes('password') || htmlText.includes('senha'))) {
             return res.json({ success: false, price: null, error: 'Login necessário (Cookie expirou).' });
        }
        return res.json({ success: false, price: null, error: 'Preço não identificado no HTML.' });
    }

    const minPrice = Math.min(...candidates);
    
    return res.json({
        success: true,
        price: minPrice
    });

  } catch (error) {
    console.error(`[ERRO] ${item}:`, error.message);
    return res.json({ success: false, price: null, error: `Erro interno: ${error.message}` });
  }
});

app.get('*', (req, res) => {
  if (fs.existsSync(join(distPath, 'index.html'))) {
    res.sendFile(join(distPath, 'index.html'));
  } else {
    res.send(`
      <h1>Frontend building...</h1>
      <p>O backend está funcionando na porta ${PORT}.</p>
      <p>Se você vê isso, falta rodar 'npm run build'.</p>
    `);
  }
});

// Alteração importante: Ouvir em 0.0.0.0
app.listen(PORT, HOST, () => {
  console.log(`Server rodando em http://${HOST}:${PORT}`);
});