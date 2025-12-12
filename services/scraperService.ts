import { ScrapeResult } from '../types';

/**
 * Normalizes price string "1.000.000" -> 1000000
 */
const parsePriceString = (str: string): number => {
  // Remove spaces, 'z', 'Z'
  const cleanStr = str.replace(/[zZ\s]/g, '');
  // Remove dots (assuming dot is thousands separator in Latam/RO usually, but could be comma)
  // Logic: remove all non-digits
  const numericStr = cleanStr.replace(/\D/g, '');
  return parseInt(numericStr, 10);
};

export const fetchPrice = async (
  itemName: string,
  cookie: string,
  useProxy: boolean,
  proxyUrl: string
): Promise<ScrapeResult> => {
  const targetUrl = `https://ro.gnjoylatam.com/pt/intro/shop-search/trading?storeType=BUY&serverType=FREYA&searchWord=${encodeURIComponent(itemName)}`;
  
  // Use proxy if configured to bypass CORS in browser
  const finalUrl = useProxy ? `${proxyUrl}${targetUrl}` : targetUrl;

  const headers: HeadersInit = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  if (cookie) {
    // Note: Cookies cannot be set on cross-origin requests in browser fetch unless credentials logic allows it.
    // However, if using a robust proxy or server-side runner, this header is key.
    // Some CORS proxies strip this header.
    headers['Cookie'] = cookie;
    // We add a custom header that some proxies use to forward cookies
    headers['X-Cookie'] = cookie; 
  }

  try {
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: headers,
    });

    if (response.status === 403 || response.status === 401) {
      return { success: false, price: null, error: `Acesso Negado (${response.status}). Verifique o Cookie ou Login.` };
    }

    if (!response.ok) {
      return { success: false, price: null, error: `Erro HTTP: ${response.status}` };
    }

    const htmlText = await response.text();
    
    // Check for login requirement in HTML
    if (htmlText.includes('login') && htmlText.includes('password') && htmlText.length < 5000) {
       return { success: false, price: null, error: 'Página de Login detectada. Renove o Cookie.' };
    }

    // --- Logic 1: Regex Search ---
    // Regex: ([0-9]{1,3}(?:[.,\s]?[0-9]{3})*)\s*z
    const priceRegex = /([0-9]{1,3}(?:[.,\s]?[0-9]{3})*)\s*z/gi;
    const regexMatches = [...htmlText.matchAll(priceRegex)];
    
    let candidates: number[] = [];

    if (regexMatches.length > 0) {
      for (const match of regexMatches) {
        const val = parsePriceString(match[1]);
        if (!isNaN(val)) candidates.push(val);
      }
    }

    // --- Logic 2: Fallback (Scan all numbers) ---
    if (candidates.length === 0) {
      // Find all number sequences
      const allNumbersMatch = htmlText.match(/\d{1,3}(?:[.,]?\d{3})*/g);
      if (allNumbersMatch) {
         for (const numStr of allNumbersMatch) {
             const val = parsePriceString(numStr);
             if (!isNaN(val)) {
                 // Filter Logic
                 // 1. Between 100 and 1,000,000,000
                 if (val >= 100 && val <= 1000000000) {
                     // 2. Ignore years
                     if (val !== 2024 && val !== 2025 && val !== 2023) {
                         candidates.push(val);
                     }
                 }
             }
         }
      }
    }

    if (candidates.length === 0) {
        // Double check for "0 results"
        if (htmlText.includes('não foram encontrados') || htmlText.includes('No results')) {
             return { success: true, price: 0, error: 'Zero resultados encontrados.' };
        }
        return { success: false, price: null, error: 'Preço não encontrado (Regex/Fallback falharam).' };
    }

    // --- Select Lowest Price ---
    const minPrice = Math.min(...candidates);

    return {
      success: true,
      price: minPrice,
      error: undefined
    };

  } catch (err: any) {
    return {
      success: false,
      price: null,
      error: `Erro de Rede: ${err.message}`
    };
  }
};