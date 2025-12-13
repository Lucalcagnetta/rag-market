
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
  ListChecks,
  Zap,
  Clock
} from 'lucide-react';

const UPDATE_INTERVAL_MS = 2 * 60 * 1000; // 2 Minutes
const SAFETY_DELAY_MS = 2000; // 2s de delay entre lotes
const BATCH_SIZE = 2; // Processa 2 por vez
const WATCHDOG_TIMEOUT_MS = 30000; // 30s: Se travar, o watchdog reseta
const SYNC_INTERVAL_MS = 5000; // 5s: Sincroniza com o servidor

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
  
  // Novo estado: Permite rodar manualmente mesmo de noite
  const [overrideNightMode, setOverrideNightMode] = useState(false);

  // Inputs for New Item
  const [newItemName, setNewItemName] = useState('');
  const [newItemTarget, setNewItemTarget] = useState<string>('');

  // Editing State
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editingTargetInput, setEditingTargetInput] = useState<string>('');

  // -- AUDIO CONTEXT REF (Global para o componente) --
  const audioCtxRef = useRef<AudioContext | null>(null);

  // -- Refs for loop control --
  const isRunningRef = useRef(isRunning);
  const itemsRef = useRef(items);
  const settingsRef = useRef(settings);
  const overrideNightModeRef = useRef(overrideNightMode);
  
  // Controle de concorrência e Watchdog
  const processingRef = useRef(false);
  const processingStartTimeRef = useRef<number>(0);
  const lastFetchTimeRef = useRef<number>(0);
  
  // Controle de Sync
  const isSavingRef = useRef(false);

  // Sync refs with state
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => { overrideNightModeRef.current = overrideNightMode; }, [overrideNightMode]);
  
  // -- AUDIO HELPERS --
  const initAudio = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().then(() => {
           console.log("Audio Context Resumed/Unlocked");
        });
      }
    } catch (e) {
      console.error("Erro ao iniciar AudioContext", e);
    }
  }, []);

  const playPriceDropSound = useCallback(() => {
    try {
      if (!audioCtxRef.current) initAudio();
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime); 
      oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.3);
    } catch (e) { console.error("Audio play failed", e); }
  }, [initAudio]);

  const playDealSound = useCallback(() => {
    try {
      if (!audioCtxRef.current) initAudio();
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type = 'square';
      osc1.frequency.setValueAtTime(523.25, now); // C5
      gain1.gain.setValueAtTime(0.05, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc1.start(now);
      osc1.stop(now + 0.1);
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(1046.50, now + 0.15); // C6
      gain2.gain.setValueAtTime(0.05, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.6);
    } catch (e) { console.error("Audio play failed", e); }
  }, [initAudio]);

  // -- DATA PERSISTENCE --
  
  // Função de salvamento EXPLÍCITO (Substitui o useEffect de auto-save)
  const saveData = useCallback(async (currentItems: Item[], currentSettings: Settings) => {
    isSavingRef.current = true;
    setSaveStatus('saving');
    
    try {
      await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: currentItems, settings: currentSettings })
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error("Failed to save to server", err);
      setSaveStatus('error');
    } finally {
      isSavingRef.current = false;
    }
  }, []);

  // Carga Inicial
  useEffect(() => {
    const loadFromServer = async () => {
      try {
        const res = await fetch('/api/db');
        if (res.ok) {
          const data = await res.json();
          if (data.items && Array.isArray(data.items)) {
            // Migração de dados legado
            const fixedItems = data.items.map((i: Item) => {
               if (i.targetPrice > 0 && i.targetPrice < 1000) {
                 return { ...i, targetPrice: i.targetPrice * 1000000 };
               }
               return i;
            });
            setItems(fixedItems);
            itemsRef.current = fixedItems;
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

  // Atualiza Refs
  useEffect(() => {
    itemsRef.current = items;
    settingsRef.current = settings;
  }, [items, settings]);


  // -- POLLING (SYNC) --
  // Sincroniza dados com o servidor periodicamente para pegar o "Visto" de outros dispositivos
  useEffect(() => {
    if (!dataLoaded) return;

    const syncInterval = setInterval(async () => {
      // Não sincroniza se estiver editando ou salvando (evita conflitos de UI)
      if (editingItem || isSavingRef.current || processingRef.current) return;

      try {
        const res = await fetch('/api/db');
        if (res.ok) {
          const data = await res.json();
          const serverItems: Item[] = data.items || [];
          
          setItems(currentLocalItems => {
            // Lógica de Fusão (Merge): Servidor x Local
            // Queremos os dados novos do servidor, MAS se o local estiver carregando (scraper rodando),
            // preservamos o status LOADING para não quebrar a automação.
            
            // Se as listas forem idênticas em tamanho e conteúdo chave, não faz nada para evitar re-render
            const hasChanges = JSON.stringify(serverItems) !== JSON.stringify(currentLocalItems);
            // Simplificação: só atualiza se realmente necessário, mas o scraper muda coisas frequentemente
            
            return serverItems.map(sItem => {
              const localItem = currentLocalItems.find(l => l.id === sItem.id);
              
              if (localItem && localItem.status === Status.LOADING) {
                // Se localmente estamos buscando preço, ignoramos o status do servidor,
                // mas aceitamos outras mudanças (como Visto/Target Price)
                return {
                  ...sItem,
                  status: Status.LOADING 
                };
              }
              // Caso contrário, o servidor é a fonte da verdade (incluindo Visto/Acks)
              return sItem;
            });
          });
          
          // Atualiza Settings se mudou lá
          if (data.settings && JSON.stringify(data.settings) !== JSON.stringify(settingsRef.current)) {
              setSettings(data.settings);
          }
        }
      } catch (e) {
        console.error("Sync error", e);
      }
    }, SYNC_INTERVAL_MS);

    return () => clearInterval(syncInterval);
  }, [dataLoaded, editingItem]); // Removemos isSaving/processing das dependências para usar Refs


  // -- Sorting Logic --
  const getSortedItems = useCallback((currentItems: Item[]) => {
    return [...currentItems].sort((a, b) => {
      const aIsDeal = a.lastPrice !== null && a.lastPrice > 0 && a.lastPrice <= a.targetPrice;
      const bIsDeal = b.lastPrice !== null && b.lastPrice > 0 && b.lastPrice <= b.targetPrice;
      
      const aHasDrop = !!a.hasPriceDrop;
      const bHasDrop = !!b.hasPriceDrop;

      const aActive = (aIsDeal || aHasDrop) && !a.isAck;
      const bActive = (bIsDeal || bHasDrop) && !b.isAck;

      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;

      if (aActive && bActive) {
         return a.name.localeCompare(b.name);
      }

      const aInteresting = aIsDeal || aHasDrop;
      const bInteresting = bIsDeal || bHasDrop;

      if (aInteresting && !bInteresting) return -1;
      if (!aInteresting && bInteresting) return 1;

      if (aInteresting && bInteresting) {
          if (aIsDeal && !bIsDeal) return -1;
          if (!aIsDeal && bIsDeal) return 1;
          return a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, []);

  // -- Automation Loop --
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (!isRunningRef.current) {
        setIsNightPause(false); 
        return;
      }

      const currentHour = new Date().getHours();
      const isSleepTime = currentHour >= 1 && currentHour < 8;

      if (!isSleepTime && overrideNightModeRef.current) {
        setOverrideNightMode(false);
      }

      const effectivePause = isSleepTime && !overrideNightModeRef.current;
      setIsNightPause(effectivePause);
      if (effectivePause) return;

      // WATCHDOG MELHORADO: Reseta itens travados
      if (processingRef.current) {
        if (Date.now() - processingStartTimeRef.current > WATCHDOG_TIMEOUT_MS) {
           console.warn("⚠️ Watchdog: Processamento travado detectado. Reiniciando fila e resetando itens.");
           processingRef.current = false;
           // Força reset de itens que ficaram presos em LOADING
           setItems(prev => prev.map(i => i.status === Status.LOADING ? { ...i, status: Status.IDLE } : i));
        }
        return;
      }

      const now = Date.now();
      if (now - lastFetchTimeRef.current < SAFETY_DELAY_MS) return; 

      const currentItems = itemsRef.current;
      const candidates = currentItems
        .filter(i => i.nextUpdate <= now && i.status !== Status.LOADING)
        .slice(0, BATCH_SIZE);

      if (candidates.length > 0) {
        processingRef.current = true;
        processingStartTimeRef.current = Date.now();
        
        const candidateIds = candidates.map(c => c.id);
        setItems(prev => prev.map(i => candidateIds.includes(i.id) ? { ...i, status: Status.LOADING } : i));

        try {
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
          
          let listToSave: Item[] = [];

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
              
              const isDeal = isSuccess && newPrice !== null && newPrice > 0 && newPrice <= i.targetPrice;
              const wasDeal = oldPrice !== null && oldPrice > 0 && oldPrice <= i.targetPrice;
              
              const isPriceDrop = isSuccess && 
                                  newPrice !== null && 
                                  oldPrice !== null && 
                                  newPrice > 0 && 
                                  oldPrice > 0 && 
                                  newPrice < oldPrice;

              const shouldResetAck = isPriceDrop || (isDeal && !wasDeal);

              if (shouldResetAck) {
                if (isDeal) foundDeal = true;
                else if (isPriceDrop) foundDrop = true;
              }

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
                isAck: shouldResetAck ? false : i.isAck, 
                hasPriceDrop: isPriceDrop ? true : i.hasPriceDrop
              };
            });

            if (foundDeal) playDealSound();
            else if (foundDrop) playPriceDropSound();
            
            listToSave = updatedList;
            return updatedList; 
          });
          
          if (listToSave.length > 0) {
              await saveData(listToSave, settingsRef.current);
          }

        } catch (e) {
          console.error("Erro no lote:", e);
          setItems(prev => prev.map(i => candidateIds.includes(i.id) ? { ...i, status: Status.ERRO, nextUpdate: Date.now() + 60000 } : i));
        } finally {
          processingRef.current = false;
        }
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [playDealSound, playPriceDropSound, saveData]); // Adicionado saveData

  // -- Handlers --
  const toggleAutomation = () => {
    initAudio(); 
    if (!isRunning) {
        const h = new Date().getHours();
        if (h >= 1 && h < 8) {
            setOverrideNightMode(true);
        }
    } else {
        setOverrideNightMode(false);
    }
    setIsRunning(!isRunning);
  };

  const handleSaveSettings = () => {
    initAudio();
    setSettings(tempSettings);
    saveData(items, tempSettings); // Save Explícito
  };

  const parseKkInput = (val: string): number => {
    if (!val) return 0;
    let numStr = val.toLowerCase().replace(/\s/g, '').replace(',', '.');
    let multiplier = 1;
    if (numStr.includes('kk')) {
      multiplier = 1000000;
      numStr = numStr.replace('kk', '');
    } else if (numStr.includes('k')) {
      multiplier = 1000;
      numStr = numStr.replace('k', '');
    } else if (numStr.includes('z')) {
      multiplier = 1;
      numStr = numStr.replace('z', '');
    } else {
      const tempNum = parseFloat(numStr);
      if (!isNaN(tempNum) && tempNum < 1000 && tempNum > 0) {
        multiplier = 1000000;
      }
    }
    const num = parseFloat(numStr);
    return isNaN(num) ? 0 : Math.floor(num * multiplier);
  };

  const formatMoney = (val: number | null) => {
    if (val === null) return '--';
    const floorValue = (value: number, decimals: number) => {
      const factor = Math.pow(10, decimals);
      return Math.floor(value * factor) / factor;
    };
    if (val >= 1000000) {
       const inMillions = val / 1000000;
       const displayVal = floorValue(inMillions, 2); 
       return displayVal.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'kk';
    }
    if (val >= 1000) {
       const inThousands = val / 1000;
       const displayVal = floorValue(inThousands, 1);
       return displayVal.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
    }
    return val.toLocaleString('pt-BR'); 
  };

  const addNewItem = () => {
    initAudio();
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
    
    // Atualiza estado E salva
    const newList = [...items, newItem];
    setItems(newList);
    saveData(newList, settings);
    
    setNewItemName('');
    setNewItemTarget('');
  };

  const removeItem = (id: string) => {
    if (confirm("Tem certeza que deseja remover este item?")) {
      const newList = items.filter(i => i.id !== id);
      setItems(newList);
      saveData(newList, settings); // Save Explícito
    }
  };

  const handleEditClick = (item: Item) => {
    setEditingItem({ ...item });
    setEditingTargetInput(formatMoney(item.targetPrice).replace('z', '').trim());
  };

  const saveEdit = () => {
    initAudio();
    if (!editingItem) return;
    const newList = items.map(i => i.id === editingItem.id ? editingItem : i);
    setItems(newList);
    saveData(newList, settings); // Save Explícito
    setEditingItem(null);
  };

  const acknowledgeItem = (id: string) => {
    setItems(prev => {
        const newList = prev.map(i => i.id === id ? { ...i, isAck: true, hasPriceDrop: false } : i);
        // Dispara o save usando a lista calculada, para garantir consistência
        saveData(newList, settingsRef.current);
        return newList;
    });
  };

  const acknowledgeAll = () => {
    if (confirm("Marcar todos os alertas como vistos?")) {
      setItems(prev => {
          const newList = prev.map(i => ({ ...i, isAck: true, hasPriceDrop: false }));
          saveData(newList, settingsRef.current);
          return newList;
      });
    }
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
    <div className="min-h-screen bg-[#0d1117] text-slate-200 p-2 md:p-8 font-sans relative">
      
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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm animate-in fade-in duration-200 p-4">
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
                  value={editingTargetInput}
                  onChange={(e) => {
                     setEditingTargetInput(e.target.value);
                     const val = parseKkInput(e.target.value);
                     setEditingItem({...editingItem, targetPrice: val});
                  }}
                  placeholder="Ex: 30 (entende 30kk)"
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
                >Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="max-w-6xl mx-auto mb-6 md:mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="w-full md:w-auto">
          <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="text-blue-500" />
            Ragnarok Tracker
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
             <span className="text-[10px] text-slate-500 border border-slate-700 px-2 py-0.5 rounded">2 itens / 2s</span>
             
             {isRunning && isNightPause && !overrideNightMode && (
               <span className="flex items-center gap-1 text-[10px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 px-2 py-0.5 rounded font-medium">
                 <Moon size={10} /> Pausa (01h-08h)
               </span>
             )}
             
             {isRunning && isNightPause && overrideNightMode && (
               <span className="flex items-center gap-1 text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded font-medium animate-pulse">
                 <Zap size={10} /> Forçando Execução
               </span>
             )}
             
             {isRunning && !isNightPause && (
                <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 px-2 py-0.5 rounded font-medium">
                  <Sun size={10} /> Monitorando
                </span>
             )}

             {saveStatus === 'saving' && <span className="text-[10px] text-blue-400 flex items-center gap-1"><Database size={10} className="animate-bounce" /> Salvando...</span>}
             {saveStatus === 'saved' && <span className="text-[10px] text-emerald-500 flex items-center gap-1"><CheckCircle2 size={10} /> Salvo</span>}
             {saveStatus === 'error' && <span className="text-[10px] text-red-500 flex items-center gap-1"><X size={10} /> Erro Save</span>}
          </div>
        </div>
        
        <div className="flex gap-2 items-center w-full md:w-auto justify-end">
          {activeAlertsCount > 0 && (
             <button
               onClick={acknowledgeAll}
               className="flex-1 md:flex-none justify-center px-3 py-2 rounded text-white bg-blue-600 hover:bg-blue-500 border border-blue-500 transition flex items-center gap-2 text-xs md:text-sm shadow-lg animate-pulse"
             >
               <ListChecks size={14} /> Visto ({activeAlertsCount})
             </button>
          )}

          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`px-3 py-2 rounded text-slate-200 border transition flex items-center gap-2 text-xs md:text-sm ${showSettings ? 'bg-[#1e293b] border-blue-500' : 'bg-[#161b22] border-[#30363d] hover:bg-[#21262d]'}`}
          >
            <SettingsIcon size={14} />
          </button>
          
          <button 
            onClick={toggleAutomation}
            className={`px-4 py-2 rounded font-bold shadow-lg transition flex items-center gap-2 text-xs md:text-sm ${
              isRunning 
              ? 'bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20' 
              : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500'
            }`}
          >
            {isRunning ? <><Pause size={14} /> PAUSAR</> : <><Play size={14} /> INICIAR</>}
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="max-w-6xl mx-auto mb-6 bg-[#161b22] border border-[#30363d] rounded-lg p-4 md:p-6 animate-in fade-in slide-in-from-top-4 duration-300">
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
                className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded text-sm font-medium transition flex items-center justify-center gap-2"
              >
                <Save size={16} /> SALVAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-6xl mx-auto bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden shadow-2xl mb-10">
        
        {/* Add Item Bar */}
        <div className="p-4 border-b border-[#30363d] bg-[#0d1117] flex flex-col md:flex-row gap-4 items-end">
          <div className="w-full md:flex-1">
            <label className="block text-xs text-slate-500 mb-1 font-mono">NOME DO ITEM</label>
            <input 
              type="text" 
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Nome exato do item..."
              className="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-sm focus:border-blue-500 outline-none text-white placeholder-slate-600"
              onKeyDown={(e) => e.key === 'Enter' && addNewItem()}
            />
          </div>
          <div className="w-full md:w-40">
            <label className="block text-xs text-slate-500 mb-1 font-mono">PREÇO ALVO</label>
            <input 
              type="text" 
              value={newItemTarget}
              onChange={(e) => setNewItemTarget(e.target.value)}
              placeholder="Ex: 30 (30kk)"
              className="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-sm focus:border-blue-500 outline-none text-white placeholder-slate-600"
              onKeyDown={(e) => e.key === 'Enter' && addNewItem()}
            />
          </div>
          <button 
            onClick={addNewItem}
            className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium transition flex items-center justify-center gap-2"
          >
            <Plus size={16} /> ADICIONAR
          </button>
        </div>

        {/* Table Header (Hidden on Mobile) */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 bg-[#161b22] border-b border-[#30363d] text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-4">Item</div>
          <div className="col-span-2 text-right pr-4">Preço Alvo</div>
          <div className="col-span-2 text-right pr-4">Menor Preço</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Ações</div>
        </div>

        {/* Table Body (Cards on Mobile, Grid on Desktop) */}
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
              let rowClass = "hover:bg-[#1c2128] border-l-4 border-l-transparent bg-[#161b22]";
              
              if (isDeal) {
                 if (isActiveEvent) {
                     rowClass = "animate-pulse-green border-l-4 border-l-emerald-500 bg-emerald-900/20";
                 } else {
                     rowClass = "border-l-4 border-l-emerald-600 bg-emerald-900/10 hover:bg-emerald-900/20";
                 }
              } else if (isActiveEvent && item.hasPriceDrop) {
                 rowClass = "animate-pulse-blue border-l-4 border-l-blue-500 bg-blue-900/20";
              }

              return (
                <div 
                  key={item.id} 
                  className={`flex flex-col md:grid md:grid-cols-12 gap-2 md:gap-4 p-4 md:px-6 md:py-4 transition-all duration-500 relative ${rowClass}`}
                >
                  {/* --- Item Details (Mobile: Top / Desktop: Col 1) --- */}
                  <div className="md:col-span-4 flex flex-col justify-center mb-2 md:mb-0">
                    <div className="flex justify-between md:justify-start items-center gap-2 w-full">
                      <span className={`font-semibold text-sm md:text-base ${isDeal ? 'text-emerald-400' : (item.hasPriceDrop ? 'text-blue-400' : 'text-white')}`}>
                        {item.name}
                      </span>
                      
                      {/* Mobile Status Indicator */}
                      <div className="md:hidden flex items-center gap-2">
                        {isLoading && <span className="text-xs text-blue-400 animate-pulse">Atualizando...</span>}
                        {hasError && <span className="text-xs text-red-400">Erro</span>}
                      </div>
                    </div>
                    
                    {/* Desktop Status Msg */}
                    <div className="hidden md:block">
                        {hasError && <div className="text-[10px] text-red-400 mt-1 truncate">{item.message}</div>}
                        {isLoading && <div className="text-[10px] text-blue-400 mt-1 animate-pulse">Atualizando...</div>}
                    </div>
                  </div>

                  {/* --- Price Info (Mobile: Middle Row / Desktop: Cols 2 & 3) --- */}
                  
                  {/* Target Price */}
                  <div className="md:col-span-2 flex md:block justify-between items-center md:text-right md:pr-4 order-3 md:order-none mt-1 md:mt-0">
                    <span className="text-xs text-slate-600 font-mono md:hidden">ALVO:</span>
                    <span className="font-mono text-slate-500 text-sm">{formatMoney(item.targetPrice)}</span>
                  </div>

                  {/* Current Price */}
                  <div className="md:col-span-2 flex md:flex-col justify-between md:items-end md:justify-center md:text-right md:pr-4 bg-[#0d1117] md:bg-transparent p-2 md:p-0 rounded my-1 md:my-0 order-2 md:order-none">
                     <span className="text-xs text-slate-500 font-mono md:hidden self-center">ATUAL:</span>
                     
                     {item.lastPrice !== null ? (
                       <div className="flex items-center gap-1">
                           {item.hasPriceDrop && <TrendingDown size={14} className="text-blue-500 animate-bounce" />}
                           <span className={`font-mono font-bold text-lg ${isDeal ? 'text-emerald-400' : (item.hasPriceDrop ? 'text-blue-400' : 'text-slate-200')}`}>
                             {formatMoney(item.lastPrice)}
                           </span>
                       </div>
                     ) : (
                       <span className="text-slate-600 font-mono">--</span>
                     )}
                  </div>

                  {/* --- Status / Time (Mobile: Bottom Left / Desktop: Col 4) --- */}
                  <div className="md:col-span-2 flex flex-row md:flex-col items-center md:items-start justify-between md:justify-center gap-2 text-xs text-slate-500 order-4 md:order-none mt-2 md:mt-0 border-t border-[#30363d] pt-2 md:border-0 md:pt-0">
                    <div className="flex items-center gap-1">
                        <Clock size={10} />
                        <span>{item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}</span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {isActiveEvent && isDeal && <span className="bg-emerald-900/50 text-emerald-400 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">PREÇO BAIXO!</span>}
                        {isActiveEvent && !isDeal && item.hasPriceDrop && <span className="bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">CAIU</span>}
                    </div>
                  </div>

                  {/* --- Actions (Mobile: Bottom Right / Desktop: Col 5) --- */}
                  <div className="md:col-span-2 flex justify-end gap-3 items-center order-5 md:order-none mt-2 md:mt-0 pt-2 md:pt-0 border-t border-[#30363d] md:border-0 border-dashed md:border-solid">
                    {/* Check Button */}
                    {isActiveEvent && (
                      <button 
                        onClick={() => acknowledgeItem(item.id)}
                        className={`text-white p-2 rounded-full shadow-lg transition-transform active:scale-95 ${isDeal ? 'bg-emerald-600' : 'bg-blue-600'}`}
                      >
                        <Eye size={18} />
                      </button>
                    )}

                    {/* Seen Indicator */}
                    {isDeal && item.isAck && (
                      <div className="text-emerald-700">
                        <CheckCircle2 size={18} />
                      </div>
                    )}

                    <button 
                      onClick={() => handleEditClick(item)}
                      className="text-slate-500 hover:text-blue-400 p-2 hover:bg-blue-500/10 rounded transition"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => removeItem(item.id)}
                      className="text-slate-500 hover:text-red-400 p-2 hover:bg-red-500/10 rounded transition"
                    >
                      <Trash2 size={18} />
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
