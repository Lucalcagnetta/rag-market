
import { ScrapeResult } from '../types';

export const fetchPrice = async (
  itemName: string,
  cookie: string,
  useProxy: boolean, // Mantido apenas para compatibilidade de tipos, ignorado na lógica nova
  proxyUrl: string   // Mantido apenas para compatibilidade
): Promise<ScrapeResult> => {
  
  // Agora chamamos nosso próprio backend local
  // O Nginx ou o próprio Express vai rotear /api para o lugar certo
  const apiUrl = `/api/search?item=${encodeURIComponent(itemName)}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  };

  if (cookie) {
    // Passamos o cookie do usuário num header seguro para o nosso backend usar
    headers['x-ro-cookie'] = cookie;
  }

  try {
    // Adiciona Timeout de 15s no cliente também para evitar travamento de UI
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers,
      signal: controller.signal
    });
    
    clearTimeout(id);

    if (!response.ok) {
      return { success: false, price: null, error: `Erro HTTP: ${response.status}` };
    }

    const data = await response.json();
    return data;

  } catch (err: any) {
    return {
      success: false,
      price: null,
      error: `Erro de Conexão: ${err.name === 'AbortError' ? 'Timeout (15s)' : err.message}`
    };
  }
};
