
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Item, Settings, Status, ScrapeResult } from './types';
import { INITIAL_SETTINGS, MOCK_ITEMS } from './constants';
import { fetchPrice } from './services/scraperService';
import { 
  Play, 
  Pause, 
  Plus, 
  Trash2, 
  Settings as SettingsIcon, 
  Activity, 
  Edit2,
  Save,
  CheckCircle2,
  X,
  Eye,
  Database,
  Moon,
  Sun,
  TrendingDown,
  ListChecks
} from 'lucide-react';

// -- SOUNDS --

// Som 1: Preço caiu (mas não bateu o alvo) - Beep simples descendente
const playPriceDropSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime); 
    oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.3);
    
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    console.error("Audio play failed", e);
  }
};

// Som 2: OFERTA! (Preço <= Alvo) - Som duplo vitorioso (Ding-Ding)
const playDealSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const now = audioContext.currentTime;

    // Nota 1 (Aguda)
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    
    osc1.type = 'square'; // Timbre mais "digital" e chamativo
    osc1.frequency.setValueAtTime(523.25, now); // C5
    gain1.gain.setValueAtTime(0.05, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc1.start(now);
    osc1.stop(now + 0.1);

    // Nota 2 (Mais aguda ainda)
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(1046.50, now + 0.15); // C6
    gain2.gain.setValueAtTime(0.05, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.6);

  } catch (e) {
    console.error("Audio play failed", e);
  }
};

// Configurações restauradas (Reversão)
const UPDATE_INTERVAL_MS = 2 * 60 * 1000; // 2 Minutes
const SAFETY_DELAY_MS = 2000; // 2s de delay entre lotes (Mais seguro)
const BATCH_SIZE = 2; // Processa 2 por vez (Mais rápido)
const WATCHDOG_TIMEOUT_MS = 30000; // 30s: Se travar, o watchdog reseta

const App: React.FC = () => {
  // -- State --
  const [items, setItems] = useState<Item[]>(MOCK_ITEMS);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Local state for settings form
  const [tempSettings, setTempSettings] = useState<Settings>(settings);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'saving' | 'error'>('idle');

  const [isRunning, setIsRunning] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [isNightPause, setIsNightPause] = useState(false);

  // Inputs for New Item
  const [newItemName, setNewItemName] = useState('');
  const [newItemTarget, setNewItemTarget] = useState<string>('');

  // Editing State
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  // -- Refs for loop control --
  const isRunningRef = useRef(isRunning);
  const itemsRef = useRef(items);
  const settingsRef = useRef(settings);
  
  // Controle de concorrência e Watchdog
  const processingRef = useRef(false);
  const processingStartTimeRef = useRef<number>(0);
  const lastFetchTimeRef = useRef<number>(0);
  
  const saveTimeoutRef = useRef<number | null>(null);

  // Sync refs with state
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  
  // -- DATA PERSISTENCE --
  useEffect(() => {
    const loadFromServer = async () => {
      try {
        const res = await fetch('/api/db');
        if (res.ok) {
          const data = await res.json();
          if (data.items && Array.isArray(data.items)) {
            setItems(data.items);
            itemsRef.current = data.items;
          }
          if (data.settings) {
            setSettings(data.settings);
            settingsRef.current = data.settings;
            setTempSettings(data.settings);
          }
        }
      } catch (err) {
        console.error("Failed to load data from server", err);
      } finally {
        setDataLoaded(true);
      }
    };
    loadFromServer();
  }, []);

  const saveDataToServer = useCallback((newItems: Item[], newSettings: Settings) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaveStatus('saving');
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: newItems, settings: newSettings })
        });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (err) {
        console.error("Failed to save to server", err);
        setSaveStatus('error');
      }
    }, 1000);
  }, []);

  useEffect(() => {
    if (!dataLoaded) return;
    itemsRef.current = items;
    saveDataToServer(items, settings);
  }, [items, settings, dataLoaded, saveDataToServer]);


  // -- Sorting Logic --
  const getSortedItems = useCallback((currentItems: Item[]) => {
    return [...currentItems].sort((a, b) => {
      const aIsDeal = a.lastPrice !== null && a.lastPrice > 0 && a.lastPrice <= a.targetPrice;
      const bIsDeal = b.lastPrice !== null && b.lastPrice > 0 && b.lastPrice <= b.targetPrice;
      
      const aActive = (aIsDeal || a.hasPriceDrop) && !a.isAck;
      const bActive = (bIsDeal || b.hasPriceDrop) && !b.isAck;

      // 1. Prioridade para alertas ativos (piscando)
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;

      // 2. Data de atualização
      const timeA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
      const timeB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;

      return timeB - timeA; 
    });
  }, []);

  // -- Automation Loop --
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (!isRunningRef.current) {
        setIsNightPause(false); 
        return;
      }

      // Pausa noturna
      const currentHour = new Date().getHours();
      const isSleepTime = currentHour >= 1 && currentHour < 8;
      setIsNightPause(isSleepTime);
      if (isSleepTime) return;

      // WATCHDOG: Se estiver processando há muito tempo (>30s), destrava
      if (processingRef.current) {
        if (Date.now() - processingStartTimeRef.current > WATCHDOG_TIMEOUT_MS) {
           console.warn("⚠️ Watchdog: Processamento travado detectado. Reiniciando fila.");
           processingRef.current = false;
        }
        return;
      }

      const now = Date.now();
      if (now - lastFetchTimeRef.current < SAFETY_DELAY_MS) return; 

      const currentItems = itemsRef.current;
      
      // Busca candidatos (LOTE de tamanho BATCH_SIZE)
      const candidates = currentItems
        .filter(i => i.nextUpdate <= now && i.status !== Status.LOADING)
        .slice(0, BATCH_SIZE);

      if (candidates.length > 0) {
        processingRef.current = true;
        processingStartTimeRef.current = Date.now();
        
        // Marca como LOADING
        const candidateIds = candidates.map(c => c.id);
        setItems(prev => prev.map(i => candidateIds.includes(i.id) ? { ...i, status: Status.LOADING } : i));

        try {
          // Dispara requisições em paralelo (Promise.all)
          const promises = candidates.map(candidate => 
             fetchPrice(
                candidate.name, 
                settingsRef.current.cookie,
                settingsRef.current.useProxy,
                settingsRef.current.proxyUrl
              ).then(result => ({ candidateId: candidate.id, result }))
          );

          const results = await Promise.all(promises);
          lastFetchTimeRef.current = Date.now();

          setItems(prev => {
            let foundDeal = false;
            let foundDrop = false;

            const updatedList = prev.map(i => {
              const resObj = results.find(r => r.candidateId === i.id);
              if (!resObj) return i;

              const result = resObj.result;
              const isSuccess = result.success;
              const newPrice = result.price;
              const oldPrice = i.lastPrice;
              
              // Verifica se é oferta (Deal)
              const isDeal = isSuccess && newPrice !== null && newPrice > 0 && newPrice <= i.targetPrice;
              
              // Verifica se houve queda (Drop)
              const isPriceDrop = isSuccess && 
                                  newPrice !== null && 
                                  oldPrice !== null && 
                                  newPrice > 0 && 
                                  oldPrice > 0 && 
                                  newPrice < oldPrice;

              if (isDeal) foundDeal = true;
              else if (isPriceDrop) foundDrop = true;

              const shouldAlert = isDeal || isPriceDrop;

              // Próximo update em 2 min (sucesso) ou 30s (erro)
              const nextTime = isSuccess 
                 ? Date.now() + UPDATE_INTERVAL_MS 
                 : Date.now() + 30000; 

              return {
                ...i,
                lastPrice: newPrice,
                lastUpdated: new Date().toISOString(),
                status: isSuccess ? (newPrice === 0 ? Status.ALERTA : Status.OK) : Status.ERRO,
                message: result.error || undefined,
                nextUpdate: nextTime,
                isAck: shouldAlert ? false : i.isAck,
                hasPriceDrop: isPriceDrop ? true : (isSuccess ? false : i.hasPriceDrop)
              };
            });

            // Lógica de Som Diferenciada
            if (foundDeal) {
                playDealSound(); // Som Especial!
            } else if (foundDrop) {
                playPriceDropSound(); // Som Comum
            }
            
            return updatedList; 
          });

        } catch (e) {
          console.error("Erro no lote:", e);
          // Libera o lote em caso de erro fatal
          setItems(prev => prev.map(i => candidateIds.includes(i.id) ? { ...i, status: Status.ERRO, nextUpdate: Date.now() + 60000 } : i));
        } finally {
          processingRef.current = false;
        }
      }
    }, 1000); // Check loop a cada 1s

    return () => clearInterval(intervalId);
  }, []);

  // -- Handlers --
  const toggleAutomation = () => {
    setIsRunning(!isRunning);
  };

  const handleSaveSettings = () => {
    setSettings(tempSettings);
  };

  const parseKkInput = (val: string): number => {
    let numStr = val.toLowerCase().replace(/\s/g, '').replace(',', '.');
    let multiplier = 1;
    if (numStr.endsWith('kk')) {
      multiplier = 1000000;
      numStr = numStr.replace('kk', '');
    } else if (numStr.endsWith('k')) {
      multiplier = 1000;
      numStr = numStr.replace('k', '');
    }
    const num = parseFloat(numStr);
    return isNaN(num) ? 0 : Math.floor(num * multiplier);
  };

  const addNewItem = () => {
    if (!newItemName.trim()) return;
    const target = parseKkInput(newItemTarget) || 1000000;

    const newItem: Item = {
      id: Date.now().toString(),
      name: newItemName.trim(),
      targetPrice: target,
      lastPrice: null,
      lastUpdated: null,
      status: Status.IDLE,
      nextUpdate: 0,
      isAck: false,
      hasPriceDrop: false
    };
    setItems(prev => [...prev, newItem]);
    setNewItemName('');
    setNewItemTarget('');
  };

  const removeItem = (id: string) => {
    if (confirm("Tem certeza que deseja remover este item?")) {
      setItems(prev => prev.filter(i => i.id !== id));
    }
  };

  const handleEditClick = (item: Item) => {
    setEditingItem({ ...item });
  };

  const saveEdit = () => {
    if (!editingItem) return;
    setItems(prev => prev.map(i => i.id === editingItem.id ? editingItem : i));
    setEditingItem(null);
  };

  const acknowledgeItem = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, isAck: true, hasPriceDrop: false } : i));
  };

  const acknowledgeAll = () => {
    if (confirm("Marcar todos os alertas como vistos?")) {
      setItems(prev => prev.map(i => ({ ...i, isAck: true, hasPriceDrop: false })));
    }
  };

  // -- Helpers --
  const formatMoney = (val: number | null) => {
    if (val === null) return '--';
    if (val >= 1000000) {
       const inMillions = val / 1000000;
       return inMillions.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'kk';
    }
    if (val >= 1000) {
       const inThousands = val / 1000;
       return inThousands.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
    }
    return val.toLocaleString('pt-BR'); 
  };

  const sortedItems = getSortedItems(items);
  const activeAlertsCount = items.filter(i => ((i.lastPrice && i.lastPrice <= i.targetPrice) || i.hasPriceDrop) && !i.isAck).length;

  if (!dataLoaded) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-slate-400">
         <div className="flex flex-col items-center gap-4">
            <Activity className="animate-spin text-blue-500" size={48} />
            <p>Carregando dados do servidor...</p>
         </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200 p-4 md:p-8 font-sans relative">
      
      <style>{`
        @keyframes pulse-green {
          0% { background-color: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.4); box-shadow: 0 0 0 rgba(16, 185, 129, 0); }
          50% { background-color: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 1); box-shadow: 0 0 20px rgba(16, 185, 129, 0.3); }
          100% { background-color: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.4); box-shadow: 0 0 0 rgba(16, 185, 129, 0); }
        }
        .animate-pulse-green { animation: pulse-green 1.5s infinite; }
        
        @keyframes pulse-blue {
          0% { background-color: rgba(59, 130, 246, 0.05); border-color: rgba(59, 130, 246, 0.4); }
          50% { background-color: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 1); box-shadow: 0 0 20px rgba(59, 130, 246, 0.3); }
          100% { background-color: rgba(59, 130, 246, 0.05); border-color: rgba(59, 130, 246, 0.4); }
        }
        .animate-pulse-blue { animation: pulse-blue 1.5s infinite; }
      `}</style>

      {/* MODAL DE EDIÇÃO */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-lg w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Edit2 size={20} className="text-blue-500" /> Editar Item
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1 font-mono">NOME DO ITEM</label>
                <input 
                  type="text" 
                  value={editingItem.name}
                  onChange={(e) => setEditingItem({...editingItem, name: e.target.value})}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-white focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1 font-mono">PREÇO ALVO</label>
                <input 
                  type="text" 
                  value={formatMoney(editingItem.targetPrice).replace('z','')}
                  onChange={(e) => {
                     const val = parseKkInput(e.target.value);
                     setEditingItem({...editingItem, targetPrice: val});
                  }}
                  placeholder="Ex: 1kk"
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-white focus:border-blue-500 outline-none"
                />
                <span className="text-[10px] text-slate-500">Valor real: {editingItem.targetPrice.toLocaleString()} z</span>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button 
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 rounded text-slate-400 hover:text-white hover:bg-[#30363d] transition"
                >Cancelar</button>
                <button 
                  onClick={saveEdit}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded font-medium shadow-lg transition"
                >Salvar Alterações</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="max-w-6xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="text-blue-500" />
            Ragnarok Market Tracker
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-1">
             <p className="text-xs text-slate-500">Atualização em Lote (2 itens / 2s)</p>
             
             {isRunning && isNightPause && (
               <span className="flex items-center gap-1 text-[10px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 px-2 py-0.5 rounded font-medium">
                 <Moon size={10} /> Pausa Agendada (01h-08h)
               </span>
             )}
             
             {isRunning && !isNightPause && (
                <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 px-2 py-0.5 rounded font-medium">
                  <Sun size={10} /> Monitorando
                </span>
             )}

             {saveStatus === 'saving' && <span className="text-[10px] text-blue-400 flex items-center gap-1"><Database size={10} className="animate-bounce" /> Salvando...</span>}
             {saveStatus === 'saved' && <span className="text-[10px] text-emerald-500 flex items-center gap-1"><CheckCircle2 size={10} /> Sincronizado</span>}
             {saveStatus === 'error' && <span className="text-[10px] text-red-500 flex items-center gap-1"><X size={10} /> Erro ao salvar</span>}
          </div>
        </div>
        
        <div className="flex gap-3 items-center">
          {activeAlertsCount > 0 && (
             <button
               onClick={acknowledgeAll}
               className="px-4 py-2 rounded text-white bg-blue-600 hover:bg-blue-500 border border-blue-500 transition flex items-center gap-2 text-sm shadow-lg animate-pulse"
             >
               <ListChecks size={16} /> Marcar Todos ({activeAlertsCount})
             </button>
          )}

          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`px-4 py-2 rounded text-slate-200 border transition flex items-center gap-2 text-sm ${showSettings ? 'bg-[#1e293b] border-blue-500' : 'bg-[#161b22] border-[#30363d] hover:bg-[#21262d]'}`}
          >
            <SettingsIcon size={16} /> Config
          </button>
          
          <button 
            onClick={toggleAutomation}
            className={`px-6 py-2 rounded font-bold shadow-lg transition flex items-center gap-2 text-sm ${
              isRunning 
              ? 'bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20' 
              : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500'
            }`}
          >
            {isRunning ? <><Pause size={16} /> PAUSAR</> : <><Play size={16} /> INICIAR</>}
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="max-w-6xl mx-auto mb-6 bg-[#161b22] border border-[#30363d] rounded-lg p-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider flex items-center gap-2">Configurações de Acesso</h3>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Cookie de Sessão (Obrigatório)</label>
              <textarea 
                value={tempSettings.cookie}
                onChange={(e) => setTempSettings({...tempSettings, cookie: e.target.value})}
                placeholder="Ex: _ga=...; PHPSESSID=..."
                className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-sm focus:border-blue-500 outline-none font-mono text-slate-300 min-h-[80px]"
              />
            </div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
                 <input 
                    type="checkbox"
                    checked={tempSettings.useProxy}
                    onChange={(e) => setTempSettings({...tempSettings, useProxy: e.target.checked})}
                    className="rounded border-slate-700 bg-slate-900"
                 />
                 Usar Proxy (Opcional)
              </label>
              <button 
                onClick={handleSaveSettings}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded text-sm font-medium transition flex items-center gap-2"
              >
                <Save size={16} /> SALVAR E SINCRONIZAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-6xl mx-auto bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden shadow-2xl">
        
        {/* Add Item Bar */}
        <div className="p-4 border-b border-[#30363d] bg-[#0d1117] flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1 font-mono">ADICIONAR ITEM</label>
            <input 
              type="text" 
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Nome exato do item..."
              className="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-sm focus:border-blue-500 outline-none text-white placeholder-slate-600"
              onKeyDown={(e) => e.key === 'Enter' && addNewItem()}
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-slate-500 mb-1 font-mono">PREÇO ALVO</label>
            <input 
              type="text" 
              value={newItemTarget}
              onChange={(e) => setNewItemTarget(e.target.value)}
              placeholder="Ex: 1kk"
              className="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-sm focus:border-blue-500 outline-none text-white placeholder-slate-600"
              onKeyDown={(e) => e.key === 'Enter' && addNewItem()}
            />
          </div>
          <button 
            onClick={addNewItem}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium transition flex items-center gap-2"
          >
            <Plus size={16} /> ADICIONAR
          </button>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-[#161b22] border-b border-[#30363d] text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-4">Item</div>
          <div className="col-span-2 text-right pr-4">Preço Alvo</div>
          <div className="col-span-2 text-right pr-4">Menor Preço</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Ações</div>
        </div>

        {/* Table Body */}
        <div className="divide-y divide-[#30363d]">
          {sortedItems.length === 0 ? (
            <div className="p-12 text-center text-slate-600 italic">
              Nenhum item na lista. Adicione um item para começar.
            </div>
          ) : (
            sortedItems.map(item => {
              const isDeal = item.lastPrice !== null && item.lastPrice > 0 && item.lastPrice <= item.targetPrice;
              const hasError = item.status === Status.ERRO;
              const isLoading = item.status === Status.LOADING;
              
              // Evento Ativo = (Deal OU Price Drop) E ainda não "visto"
              const isActiveEvent = (isDeal || item.hasPriceDrop) && !item.isAck;

              // Animação persistente se o evento for ativo
              let rowClass = "hover:bg-[#1c2128] border-l-transparent bg-[#161b22]";
              
              if (isActiveEvent) {
                 if (isDeal) {
                    rowClass = "animate-pulse-green border-l-emerald-500 bg-emerald-900/10";
                 } else if (item.hasPriceDrop) {
                    rowClass = "animate-pulse-blue border-l-blue-500 bg-blue-900/10";
                 }
              } else if (isDeal) {
                  // Deal já visto
                  rowClass = "border-l-emerald-700 bg-[#161b22]"; 
              }

              return (
                <div 
                  key={item.id} 
                  className={`grid grid-cols-12 gap-4 px-6 py-4 items-center transition-all duration-500 border-l-4 ${rowClass}`}
                >
                  {/* Item Column */}
                  <div className="col-span-4 flex flex-col justify-center">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold text-sm ${isDeal ? 'text-emerald-400' : (item.hasPriceDrop ? 'text-blue-400' : 'text-white')}`}>
                        {item.name}
                      </span>
                    </div>
                    {hasError && <div className="text-[10px] text-red-400 mt-1 truncate">{item.message}</div>}
                    {isLoading && <div className="text-[10px] text-blue-400 mt-1 animate-pulse">Atualizando...</div>}
                  </div>

                  {/* Target Price */}
                  <div className="col-span-2 font-mono text-slate-500 text-sm text-right pr-4">
                    {formatMoney(item.targetPrice)}
                  </div>

                  {/* Current Price */}
                  <div className="col-span-2 text-right pr-4">
                     {item.lastPrice !== null ? (
                       <div className="flex flex-col items-end">
                         <div className="flex items-center gap-1">
                           {item.hasPriceDrop && <TrendingDown size={14} className="text-blue-500 animate-bounce" />}
                           <span className={`font-mono font-bold text-lg ${isDeal ? 'text-emerald-400' : (item.hasPriceDrop ? 'text-blue-400' : 'text-slate-200')}`}>
                             {formatMoney(item.lastPrice)}
                           </span>
                         </div>
                       </div>
                     ) : (
                       <span className="text-slate-600 font-mono">--</span>
                     )}
                  </div>

                  {/* Status / Updated */}
                  <div className="col-span-2 text-xs text-slate-500 flex flex-col justify-center">
                    <span>{item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}</span>
                    
                    {/* Labels de Status */}
                    {isActiveEvent && isDeal && <span className="text-emerald-500 font-bold uppercase tracking-wider text-[10px]">PREÇO BAIXO!</span>}
                    {isActiveEvent && !isDeal && item.hasPriceDrop && <span className="text-blue-500 font-bold uppercase tracking-wider text-[10px]">CAIU O PREÇO</span>}
                  </div>

                  {/* Actions */}
                  <div className="col-span-2 flex justify-end gap-2 items-center">
                    
                    {/* Check Button for Active Events */}
                    {isActiveEvent && (
                      <button 
                        onClick={() => acknowledgeItem(item.id)}
                        className={`text-white p-2 rounded-full shadow-lg transition-transform hover:scale-110 mr-2 ${isDeal ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'}`}
                        title="Marcar como visto (Parar notificação)"
                      >
                        <Eye size={16} />
                      </button>
                    )}

                    {/* Seen Indicator (Only for Deals) */}
                    {isDeal && item.isAck && (
                      <div className="mr-2 text-emerald-700" title="Oferta já vista">
                        <CheckCircle2 size={18} />
                      </div>
                    )}

                    <button 
                      onClick={() => handleEditClick(item)}
                      className="text-slate-500 hover:text-blue-400 p-2 hover:bg-blue-500/10 rounded transition"
                      title="Editar Item"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={() => removeItem(item.id)}
                      className="text-slate-500 hover:text-red-400 p-2 hover:bg-red-500/10 rounded transition"
                      title="Remover"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
