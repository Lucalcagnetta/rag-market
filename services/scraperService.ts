
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
    // Adiciona Timeout de 28s no cliente (antes do Watchdog de 30s do App)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, price: null, error: `Erro HTTP: ${response.status}` };
    }

    const data = await response.json();
    return data;

  } catch (err: any) {
    if (err.name === 'AbortError') {
        return { success: false, price: null, error: 'Timeout: Servidor demorou muito' };
    }
    return {
      success: false,
      price: null,
      error: `Erro de Conexão: ${err.message}`
    };
  }
};
