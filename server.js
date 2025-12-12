import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001; // Porta interna do backend

app.use(express.json());

// Servir arquivos estáticos do React (dist)
const distPath = join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Helper para parsear preço
const parsePriceString = (str) => {
  const cleanStr = str.replace(/[zZ\s]/g, '');
  const numericStr = cleanStr.replace(/\D/g, '');
  return parseInt(numericStr, 10);
};

// Endpoint da API de Scraping
app.get('/api/search', async (req, res) => {
  const { item } = req.query;
  // O cookie vem no header customizado da requisição do React
  const userCookie = req.headers['x-ro-cookie'] || ''; 

  if (!item) {
    return res.status(400).json({ success: false, error: 'Nome do item obrigatório' });
  }

  console.log(`[BUSCA] Item: ${item}`);

  const targetUrl = `https://ro.gnjoylatam.com/pt/intro/shop-search/trading?storeType=BUY&serverType=FREYA&searchWord=${encodeURIComponent(item)}`;

  try {
    const headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };

    if (userCookie) {
      headers['Cookie'] = userCookie;
    }

    const response = await fetch(targetUrl, { method: 'GET', headers });

    if (response.status === 403 || response.status === 401) {
        return res.json({ success: false, price: null, error: `Acesso Negado (${response.status}). Atualize o Cookie.` });
    }

    const htmlText = await response.text();

    // Lógica 1: Regex Específico (1.000 z)
    const priceRegex = /([0-9]{1,3}(?:[.,\s]?[0-9]{3})*)\s*z/gi;
    const regexMatches = [...htmlText.matchAll(priceRegex)];
    let candidates = [];

    for (const match of regexMatches) {
        const val = parsePriceString(match[1]);
        if (!isNaN(val)) candidates.push(val);
    }

    // Lógica 2: Fallback (Procurar números soltos)
    if (candidates.length === 0) {
        const allNumbersMatch = htmlText.match(/\d{1,3}(?:[.,]?\d{3})*/g);
        if (allNumbersMatch) {
            for (const numStr of allNumbersMatch) {
                const val = parsePriceString(numStr);
                if (!isNaN(val)) {
                    // Filtros de segurança
                    if (val >= 100 && val <= 1000000000) {
                        if (val !== 2024 && val !== 2025 && val !== 2023) { // Ignorar anos
                            candidates.push(val);
                        }
                    }
                }
            }
        }
    }

    if (candidates.length === 0) {
        if (htmlText.includes('não foram encontrados') || htmlText.includes('No results')) {
            return res.json({ success: true, price: 0, error: 'Sem vendedores.' });
        }
        if (htmlText.includes('login') && htmlText.includes('password')) {
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
    console.error(`Erro ao buscar ${item}:`, error);
    return res.json({ success: false, price: null, error: error.message });
  }
});

// Qualquer outra rota retorna o React (SPA)
app.get('*', (req, res) => {
  if (fs.existsSync(join(distPath, 'index.html'))) {
    res.sendFile(join(distPath, 'index.html'));
  } else {
    res.send('Frontend building... please wait or run npm run build');
  }
});

app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`);
});