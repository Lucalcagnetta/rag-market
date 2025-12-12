import express from 'express';
import cors from 'cors'; // Importando CORS
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

// Habilitar CORS para permitir que o Frontend chame o Backend sem travas
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do React (dist)
const distPath = join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Helper para parsear preço
const parsePriceString = (str) => {
  if (!str) return NaN;
  // Remove 'z', espaços, e caracteres invisíveis
  const cleanStr = str.replace(/[zZ\s\u00A0]/g, ''); 
  // Mantém apenas números
  const numericStr = cleanStr.replace(/\D/g, '');
  return parseInt(numericStr, 10);
};

// Endpoint de teste para saber se a API está viva
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', time: new Date().toISOString() });
});

// Endpoint da API de Scraping
app.get('/api/search', async (req, res) => {
  const { item } = req.query;
  const userCookie = req.headers['x-ro-cookie'] || ''; 

  if (!item) {
    return res.status(400).json({ success: false, error: 'Nome do item obrigatório' });
  }

  console.log(`[BUSCA] Iniciando busca por: ${item}`);

  // URL exata fornecida
  const targetUrl = `https://ro.gnjoylatam.com/pt/intro/shop-search/trading?storeType=BUY&serverType=FREYA&searchWord=${encodeURIComponent(item)}`;

  try {
    // Headers reforçados para parecer um navegador real
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

    // Timeout de 10 segundos para não ficar travado
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, { 
      method: 'GET', 
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (response.status === 403 || response.status === 401) {
        console.warn(`[BUSCA] Bloqueio/Auth detectado: ${response.status}`);
        return res.json({ success: false, price: null, error: `Acesso Negado (${response.status}). Renove o Cookie.` });
    }

    if (!response.ok) {
        console.error(`[BUSCA] Erro HTTP no site alvo: ${response.status}`);
        return res.json({ success: false, price: null, error: `Erro no site do Ragnarok: ${response.status}` });
    }

    const htmlText = await response.text();
    
    // Debug simples se vier vazio
    if (htmlText.length < 500) {
       console.log('[DEBUG] HTML muito curto recebido:', htmlText);
    }

    // Lógica 1: Regex Específico (formato "1.000 z")
    // Melhorado para aceitar espaços flexíveis e quebras de linha
    const priceRegex = /([0-9]{1,3}(?:[.,]?[0-9]{3})*)\s*z/gi;
    const regexMatches = [...htmlText.matchAll(priceRegex)];
    let candidates = [];

    for (const match of regexMatches) {
        const val = parsePriceString(match[1]);
        if (!isNaN(val)) candidates.push(val);
    }

    // Lógica 2: Fallback (Procurar qualquer número razoável na página)
    if (candidates.length === 0) {
        // Regex para capturar números soltos tipo "50.000" ou "50000"
        const allNumbersMatch = htmlText.match(/\d{1,3}(?:[.,]\d{3})*(?!\d)/g);
        if (allNumbersMatch) {
            for (const numStr of allNumbersMatch) {
                const val = parsePriceString(numStr);
                if (!isNaN(val)) {
                    // Filtros de segurança para evitar pegar ano, paginação ou qtd
                    // Ignora valores muito baixos (provavelmente quantidade) ou anos
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
        console.log('[FALHA] HTML recebido mas sem preço. Verifique se o layout do site mudou.');
        return res.json({ success: false, price: null, error: 'Preço não identificado no HTML.' });
    }

    const minPrice = Math.min(...candidates);
    console.log(`[SUCESSO] ${item} -> Menor preço: ${minPrice}`);
    
    return res.json({
        success: true,
        price: minPrice
    });

  } catch (error) {
    console.error(`[ERRO CRITICO] Falha ao buscar ${item}:`, error.message);
    return res.json({ success: false, price: null, error: `Erro interno: ${error.message}` });
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