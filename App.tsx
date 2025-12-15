
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Item, Settings, Status } from './types';
import { INITIAL_SETTINGS, MOCK_ITEMS } from './constants';
import { 
  Play, 
  Pause, 
  Plus, 
  Trash2, 
  Settings as SettingsIcon, 
  Activity, 
  Edit2,
  ListChecks,
  Clock,
  Eye,
  RefreshCw,
  Moon,
  Volume2,
  VolumeX,
  Calculator
} from 'lucide-react';

const SYNC_INTERVAL_MS = 2000; // Sincroniza com servidor a cada 2s

const App: React.FC = () => {
  // -- State --
  const [items, setItems] = useState<Item[]>(MOCK_ITEMS);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [dataLoaded, setDataLoaded] = useState(false);

  // -- Volume State (Persistente no LocalStorage) --
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('ro_volume');
    return saved !== null ? parseFloat(saved) : 0.5;
  });
  const [showVolumeControl, setShowVolumeControl] = useState(false);

  // -- Calculator State --
  // Inicializa lendo do localStorage, ou vazio se não existir
  const [calcPrice, setCalcPrice] = useState(() => localStorage.getItem('ro_calc_price') || '');
  const [calcQty, setCalcQty] = useState('');
  const [calcTotal, setCalcTotal] = useState('');

  // Salva o preço no localStorage sempre que ele mudar
  useEffect(() => {
    localStorage.setItem('ro_calc_price', calcPrice);
  }, [calcPrice]);

  // -- Calculator Handlers (Bidirectional) --
  const handleCalcPriceChange = (val: string) => {
      setCalcPrice(val);
      const p = parseFloat(val.replace(',', '.'));
      const q = parseFloat(calcQty.replace(',', '.'));
      
      if (!isNaN(p) && !isNaN(q)) {
          setCalcTotal((p * q).toFixed(2).replace('.', ','));
      } else if (val === '') {
          setCalcTotal('');
      }
  };

  const handleCalcQtyChange = (val: string) => {
      setCalcQty(val);
      const p = parseFloat(calcPrice.replace(',', '.'));
      const q = parseFloat(val.replace(',', '.'));

      if (!isNaN(p) && !isNaN(q)) {
          setCalcTotal((p * q).toFixed(2).replace('.', ','));
      } else if (val === '') {
          setCalcTotal('');
      }
  };

  const handleCalcTotalChange = (val: string) => {
      setCalcTotal(val);
      const p = parseFloat(calcPrice.replace(',', '.'));
      const t = parseFloat(val.replace(',', '.'));

      if (!isNaN(p) && p !== 0 && !isNaN(t)) {
          // Calcula a quantidade inversa: Total / Preço
          const result = t / p;
          // Formata para evitar dizimas muito longas, max 3 casas decimais para Kks
          setCalcQty(parseFloat(result.toFixed(3)).toString().replace('.', ','));
      } else if (val === '') {
          setCalcQty('');
      }
  };

  // Local state for settings form
  const [tempSettings, setTempSettings] = useState<Settings>(settings);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'saving' | 'error'>('idle');

  const [showSettings, setShowSettings] = useState(false);
  
  // Inputs for New Item
  const [newItemName, setNewItemName] = useState('');
  const [newItemTarget, setNewItemTarget] = useState<string>('');

  // Editing State
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editingTargetInput, setEditingTargetInput] = useState<string>('');

  // -- Refs & Audio --
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previousItemsRef = useRef<Item[]>([]); 
  
  // -- FIX: Pending ACKs Ref --
  // Armazena IDs que o usuário marcou como visto, mas o servidor ainda não confirmou.
  // Isso evita que o polling do servidor sobrescreva o estado local e toque o som novamente.
  const pendingAcksRef = useRef<Set<string>>(new Set());
  
  // -- AUDIO HELPERS --
  const initAudio = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    } catch (e) { console.error(e); }
  }, []);

  // Handle Volume Change
  const handleVolumeChange = (newVol: number) => {
      setVolume(newVol);
      localStorage.setItem('ro_volume', newVol.toString());
  };

  // Unlock Audio on First Interaction
  useEffect(() => {
    const handleInteraction = () => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().then(() => {
                ['click', 'touchstart', 'keydown'].forEach(evt => 
                    window.removeEventListener(evt, handleInteraction)
                );
            }).catch(console.error);
        }
    };

    ['click', 'touchstart', 'keydown'].forEach(evt => 
        window.addEventListener(evt, handleInteraction)
    );

    return () => {
        ['click', 'touchstart', 'keydown'].forEach(evt => 
            window.removeEventListener(evt, handleInteraction)
        );
    };
  }, []);

  const playSound = useCallback((type: 'deal' | 'drop') => {
    if (volume === 0) return; // Mudo

    try {
      if (!audioCtxRef.current) initAudio();
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const now = ctx.currentTime;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const merger = ctx.createChannelMerger(2);
      
      osc.connect(gain);
      gain.connect(merger, 0, 0); 
      gain.connect(merger, 0, 1);
      
      merger.connect(ctx.destination);

      // Usa o volume do estado
      const targetVol = volume; 

      if (type === 'deal') {
        // SOM VERDE
        osc.type = 'square';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(1046.50, now + 0.15);
        
        gain.gain.setValueAtTime(targetVol, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        
        osc.start(now);
        osc.stop(now + 0.6);
      } else {
        // SOM AZUL
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.3);
        
        gain.gain.setValueAtTime(targetVol, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) { console.error(e); }
  }, [initAudio, volume]);

  // -- API CLIENT --
  const saveData = useCallback(async (currentItems: Item[], currentSettings: Settings) => {
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
      console.error("Failed to save", err);
      setSaveStatus('error');
    }
  }, []);

  // -- MAIN LOOP (POLLING) --
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/db');
        if (res.ok) {
          const data = await res.json();
          if (!editingItem) {
             // Lógica de Fusão (Merge) para evitar Glitch de ACK
             const mergedItems = (data.items || []).map((serverItem: Item) => {
                 // Se este item está na nossa lista de "Aguardando Confirmação do Servidor"
                 if (pendingAcksRef.current.has(serverItem.id)) {
                     // Se o servidor JÁ marcou como visto, removemos da pendência
                     if (serverItem.isAck) {
                         pendingAcksRef.current.delete(serverItem.id);
                         return serverItem;
                     } 
                     // Se o servidor AINDA NÃO marcou, forçamos o estado local como VISTO
                     // para evitar que o som toque novamente
                     else {
                         return { ...serverItem, isAck: true, hasPriceDrop: false };
                     }
                 }
                 return serverItem;
             });

             setItems(mergedItems);
             setSettings(data.settings || INITIAL_SETTINGS);
             
             if (!dataLoaded) {
                 setDataLoaded(true);
                 setTempSettings(data.settings || INITIAL_SETTINGS);
             }
          }
        }
      } catch (e) { console.error("Sync error", e); }
    };

    fetchData(); 
    const interval = setInterval(fetchData, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [editingItem, dataLoaded]);

  // -- SOUND EFFECT LOGIC --
  useEffect(() => {
    if (!dataLoaded) return;
    
    const prevItems = previousItemsRef.current;
    
    items.forEach(newItem => {
        const oldItem = prevItems.find(p => p.id === newItem.id);
        
        // Só toca som se:
        // 1. O item NÃO está visto (é um alerta ativo)
        // 2. E (Ele era novo na lista OU ele JÁ estava visto antes OU ele mudou de timestamp)
        // A lógica do pendingAcksRef acima garante que o newItem.isAck não reverta para false acidentalmente.
        if (!newItem.isAck && (oldItem?.isAck !== false)) {
            const isDeal = newItem.lastPrice && newItem.lastPrice <= newItem.targetPrice;
            if (isDeal) {
                playSound('deal');
            } else if (newItem.hasPriceDrop) {
                playSound('drop');
            }
        }
    });

    previousItemsRef.current = items;
  }, [items, dataLoaded, playSound]);


  // -- HANDLERS --
  const toggleAutomation = () => {
    initAudio();
    const nextIsRunning = !settings.isRunning;
    
    const currentHour = new Date().getHours();
    const isNightTime = currentHour >= 1 && currentHour < 8;
    
    let nextIgnoreNightPause = settings.ignoreNightPause;

    if (nextIsRunning) {
        // LIGANDO A AUTOMAÇÃO
        if (isNightTime) {
            // Se o usuário ligar manualmente DURANTE a noite, assumimos que ele quer forçar o funcionamento
            nextIgnoreNightPause = true;
        } else {
            // Se ligar durante o dia, garantimos que a pausa noturna estará ativa para a próxima noite
            nextIgnoreNightPause = false;
        }
    } else {
        // DESLIGANDO A AUTOMAÇÃO
        // Sempre resetamos o override para garantir comportamento padrão na próxima execução
        nextIgnoreNightPause = false;
    }

    const newSettings = { 
        ...settings, 
        isRunning: nextIsRunning,
        ignoreNightPause: nextIgnoreNightPause
    };
    
    setSettings(newSettings);
    saveData(items, newSettings);
  };

  const handleSaveSettings = () => {
    initAudio();
    // Preservamos o ignoreNightPause e isRunning atuais, salvando apenas o Cookie novo
    const mergedSettings = { 
        ...tempSettings, 
        isRunning: settings.isRunning,
        ignoreNightPause: settings.ignoreNightPause 
    };
    setSettings(mergedSettings);
    saveData(items, mergedSettings);
    setShowSettings(false);
  };

  const parseKkInput = (val: string): number => {
    if (!val) return 0;
    let numStr = val.toLowerCase().replace(/\s/g, '').replace(',', '.');
    let multiplier = 1;
    if (numStr.includes('kk')) { multiplier = 1000000; numStr = numStr.replace('kk', ''); } 
    else if (numStr.includes('k')) { multiplier = 1000; numStr = numStr.replace('k', ''); } 
    else if (numStr.includes('z')) { numStr = numStr.replace('z', ''); }
    else { const tempNum = parseFloat(numStr); if (!isNaN(tempNum) && tempNum < 1000 && tempNum > 0) multiplier = 1000000; }
    const num = parseFloat(numStr);
    return isNaN(num) ? 0 : Math.floor(num * multiplier);
  };

  const formatMoney = (val: number | null) => {
    if (val === null) return '--';
    const floorValue = (value: number, decimals: number) => {
      const factor = Math.pow(10, decimals);
      return Math.floor(value * factor) / factor;
    };
    if (val >= 1000000) return floorValue(val / 1000000, 2).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'kk';
    if (val >= 1000) return floorValue(val / 1000, 1).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
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
    const newList = [...items, newItem];
    setItems(newList);
    saveData(newList, settings);
    setNewItemName('');
    setNewItemTarget('');
  };

  const removeItem = (id: string) => {
    if (confirm("Remover item?")) {
      const newList = items.filter(i => i.id !== id);
      setItems(newList);
      saveData(newList, settings);
    }
  };

  const resetItem = (id: string) => {
      const newList = items.map(i => {
          if (i.id === id) {
              return { 
                  ...i, 
                  lastPrice: null, 
                  lastUpdated: null, 
                  status: Status.IDLE, 
                  nextUpdate: 0,
                  message: undefined,
                  isAck: true 
              };
          }
          return i;
      });
      setItems(newList);
      saveData(newList, settings);
  };

  const acknowledgeAll = async () => {
    if (confirm("Marcar tudo como visto?")) {
      // Adiciona todos aos pendentes
      items.forEach(i => pendingAcksRef.current.add(i.id));

      const newList = items.map(i => ({ ...i, isAck: true, hasPriceDrop: false }));
      setItems(newList);
      
      try {
        await fetch('/api/ack-all', { method: 'POST' });
      } catch (e) {
        console.error("Failed to ack all", e);
      }
    }
  };
  
  const acknowledgeItem = async (id: string) => {
      // Marca como pendente de confirmação do servidor
      pendingAcksRef.current.add(id);

      const newList = items.map(i => i.id === id ? { ...i, isAck: true, hasPriceDrop: false } : i);
      setItems(newList);

      try {
          await fetch(`/api/ack/${id}`, { method: 'POST' });
      } catch (e) {
          console.error("Failed to ack item", e);
      }
  };

  const saveEdit = () => {
      if (!editingItem) return;
      const newList = items.map(i => i.id === editingItem.id ? editingItem : i);
      setItems(newList);
      saveData(newList, settings);
      setEditingItem(null);
  };

  const sortedItems = [...items].sort((a, b) => {
      const aDeal = (a.lastPrice && a.lastPrice <= a.targetPrice) || a.hasPriceDrop;
      const bDeal = (b.lastPrice && b.lastPrice <= b.targetPrice) || b.hasPriceDrop;
      
      const aActive = aDeal && !a.isAck;
      const bActive = bDeal && !b.isAck;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      
      if (aDeal && !bDeal) return -1;
      if (!aDeal && bDeal) return 1;
      
      return a.name.localeCompare(b.name);
  });

  const activeAlertsCount = items.filter(i => ((i.lastPrice && i.lastPrice <= i.targetPrice) || i.hasPriceDrop) && !i.isAck).length;
  const currentHour = new Date().getHours();
  const isNightPause = currentHour >= 1 && currentHour < 8;

  // -- EFEITO DE ABA PISCANDO (BROWSER TAB FLASHING) --
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const defaultTitle = "Ragnarok Market Tracker";

    if (activeAlertsCount > 0) {
       let state = false;
       interval = setInterval(() => {
          document.title = state 
            ? `(${activeAlertsCount}) 🔔 ALERTA!` 
            : `(${activeAlertsCount}) 💰 OPORTUNIDADE!`;
          state = !state;
       }, 1000); // Pisca a cada 1 segundo
    } else {
       document.title = defaultTitle;
    }

    return () => {
       clearInterval(interval);
       // Só reseta se o count zerar, para evitar flicker durante updates
       if (activeAlertsCount === 0) document.title = defaultTitle; 
    };
  }, [activeAlertsCount]);

  if (!dataLoaded) return <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-slate-400"><Activity className="animate-spin mr-2"/> Carregando Nuvem...</div>;

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200 p-2 md:p-8 font-sans">
       <style>{`
        @keyframes pulse-green {
          0% { background-color: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.4); }
          50% { background-color: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 1); box-shadow: 0 0 20px rgba(16, 185, 129, 0.3); }
          100% { background-color: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.4); }
        }
        .animate-pulse-green { animation: pulse-green 1.5s infinite; }
        
        @keyframes pulse-blue {
          0% { background-color: rgba(59, 130, 246, 0.05); border-color: rgba(59, 130, 246, 0.4); }
          50% { background-color: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 1); box-shadow: 0 0 20px rgba(59, 130, 246, 0.3); }
          100% { background-color: rgba(59, 130, 246, 0.05); border-color: rgba(59, 130, 246, 0.4); }
        }
        .animate-pulse-blue { animation: pulse-blue 1.5s infinite; }
        
        input[type=range] {
          -webkit-appearance: none;
          background: transparent;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 12px;
          width: 12px;
          border-radius: 50%;
          background: #3b82f6;
          margin-top: -4px;
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 4px;
          background: #334155;
          border-radius: 2px;
        }
      `}</style>

      {/* HEADER */}
      <header className="max-w-6xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
           {/* Logo removida conforme pedido */}
           <div className="flex gap-2 mt-1">
             {/* Badge Server-Side Auto removida */}
             <span className="text-[10px] bg-slate-800 px-2 rounded border border-slate-700 text-slate-400">
               {items.length} {items.length === 1 ? 'Item' : 'Itens'}
             </span>
             {saveStatus === 'saving' && <span className="text-[10px] text-blue-400">Sincronizando...</span>}
           </div>
        </div>
        
        {/* CALCULADORA (PC ONLY) */}
        <div className="hidden md:flex items-center gap-2 bg-slate-800/50 border border-slate-700 p-2 rounded-lg">
           <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1">Preço KK</span>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded px-2 py-1 w-24">
                 <span className="text-xs text-slate-500 mr-1">R$</span>
                 <input 
                   className="w-full bg-transparent text-xs font-mono text-white focus:outline-none"
                   placeholder="0,00"
                   value={calcPrice}
                   onChange={e => handleCalcPriceChange(e.target.value)}
                 />
              </div>
           </div>
           <span className="text-slate-500 mt-4">×</span>
           <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1">Qtd</span>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded px-2 py-1 w-20">
                 <input 
                   className="w-full bg-transparent text-xs font-mono text-white focus:outline-none text-center"
                   placeholder="0"
                   value={calcQty}
                   onChange={e => handleCalcQtyChange(e.target.value)}
                 />
              </div>
           </div>
           <span className="text-slate-500 mt-4">=</span>
           <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1">Total Reais</span>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded px-2 py-1 w-24">
                 <span className="text-xs text-slate-500 mr-1">R$</span>
                 <input 
                   className="w-full bg-transparent text-xs font-mono text-white focus:outline-none"
                   placeholder="0,00"
                   value={calcTotal}
                   onChange={e => handleCalcTotalChange(e.target.value)}
                 />
              </div>
           </div>
        </div>

        <div className="flex gap-2 items-center">
           {activeAlertsCount > 0 && (
             <button onClick={acknowledgeAll} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs flex items-center gap-1 animate-pulse mr-2">
                <ListChecks size={14} /> Visto ({activeAlertsCount})
             </button>
           )}

           {/* VOLUME CONTROL */}
           <div className="relative group flex items-center bg-slate-800 border border-slate-700 rounded h-[38px] px-2 mr-2">
              <button 
                onClick={() => handleVolumeChange(volume === 0 ? 0.5 : 0)} 
                className="text-slate-400 hover:text-white"
                title="Volume do Alerta"
              >
                 {volume === 0 ? <VolumeX size={16}/> : <Volume2 size={16}/>}
              </button>
              <div className="w-0 overflow-hidden group-hover:w-24 transition-all duration-300 flex items-center ml-1">
                 <input 
                   type="range" 
                   min="0" 
                   max="1" 
                   step="0.05" 
                   value={volume} 
                   onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                   className="w-20 cursor-pointer"
                 />
              </div>
           </div>

           <button onClick={() => setShowSettings(!showSettings)} className="bg-slate-800 border border-slate-700 p-2 rounded hover:bg-slate-700 transition h-[38px]">
              <SettingsIcon size={16} />
           </button>
           <button 
             onClick={toggleAutomation}
             className={`px-4 h-[38px] rounded font-bold flex items-center gap-2 text-xs transition ${settings.isRunning ? 'bg-emerald-600 text-white' : 'bg-red-900/30 text-red-400 border border-red-800'}`}
           >
             {settings.isRunning ? <><Pause size={14}/> ONLINE</> : <><Play size={14}/> PAUSADO</>}
           </button>
        </div>
      </header>
      
      {/* STATUS BAR */}
      {settings.isRunning && isNightPause && !settings.ignoreNightPause && (
        <div className="max-w-6xl mx-auto mb-4 bg-yellow-900/20 border border-yellow-700/50 text-yellow-500 p-2 rounded text-center text-xs flex items-center justify-center gap-2">
           <Moon size={14} /> Pausa Noturna Automática (Servidor: 01h-08h)
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
           <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-lg w-full max-w-lg">
              <h3 className="font-bold mb-4">Configurações do Servidor</h3>
              
              <textarea 
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm font-mono text-slate-300 h-24 mb-4"
                placeholder="Cole o Cookie aqui..."
                value={tempSettings.cookie}
                onChange={e => setTempSettings({...tempSettings, cookie: e.target.value})}
              />
              <div className="flex justify-end gap-2">
                 <button onClick={() => setShowSettings(false)} className="text-slate-400 px-4 py-2">Cancelar</button>
                 <button onClick={handleSaveSettings} className="bg-blue-600 text-white px-4 py-2 rounded">Salvar na Nuvem</button>
              </div>
           </div>
        </div>
      )}
      
      {/* EDIT MODAL */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
           <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-lg w-full max-w-sm shadow-2xl">
              <h3 className="font-bold mb-4 flex gap-2"><Edit2 size={16}/> Editar Item</h3>
              <div className="space-y-3">
                 <input className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-white" value={editingItem.name} onChange={e => setEditingItem({...editingItem, name: e.target.value})} />
                 <input className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-white" value={editingTargetInput} onChange={e => { setEditingTargetInput(e.target.value); setEditingItem({...editingItem, targetPrice: parseKkInput(e.target.value)}); }} />
                 <div className="flex justify-end gap-2 mt-4">
                    <button onClick={() => setEditingItem(null)} className="text-slate-400 px-3">Cancelar</button>
                    <button onClick={saveEdit} className="bg-blue-600 text-white px-4 py-2 rounded">Salvar</button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* MAIN LIST */}
      <div className="max-w-6xl mx-auto bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden shadow-2xl">
         {/* ADD BAR */}
         <div className="p-4 bg-[#0d1117] border-b border-[#30363d] flex flex-col md:flex-row gap-2">
            <input className="flex-1 bg-[#161b22] border border-[#30363d] p-2 rounded text-sm text-white" placeholder="Nome do Item..." value={newItemName} onChange={e => setNewItemName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNewItem()}/>
            <input className="w-full md:w-32 bg-[#161b22] border border-[#30363d] p-2 rounded text-sm text-white" placeholder="Preço (30kk)" value={newItemTarget} onChange={e => setNewItemTarget(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNewItem()}/>
            <button onClick={addNewItem} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-bold flex items-center justify-center gap-1"><Plus size={16}/> ADD</button>
         </div>

         {/* ITEMS */}
         <div className="divide-y divide-[#30363d]">
            {sortedItems.map(item => {
               const isDeal = item.lastPrice && item.lastPrice > 0 && item.lastPrice <= item.targetPrice;
               const isActiveEvent = (isDeal || item.hasPriceDrop) && !item.isAck;
               
               let bgClass = "bg-[#161b22]";
               if (isDeal) bgClass = isActiveEvent ? "animate-pulse-green bg-emerald-900/20 border-l-4 border-emerald-500" : "bg-emerald-900/10 border-l-4 border-emerald-700";
               else if (isActiveEvent && item.hasPriceDrop) bgClass = "animate-pulse-blue bg-blue-900/20 border-l-4 border-blue-500";

               return (
                 <div key={item.id} className={`p-4 flex flex-col md:flex-row items-center gap-4 ${bgClass}`}>
                    <div className="flex-1 text-center md:text-left w-full">
                       <div className="font-bold text-white">{item.name}</div>
                       <div className="flex items-center justify-center md:justify-start gap-2 mt-1">
                          {item.status === 'LOADING' && <span className="text-[10px] text-blue-400 animate-pulse">Verificando...</span>}
                          {item.status === 'ERRO' && <span className="text-[10px] text-red-400">{item.message || 'Erro'}</span>}
                          <span className="text-[10px] text-slate-500 flex items-center gap-1"><Clock size={10}/> {item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString().slice(0,5) : '--:--'}</span>
                       </div>
                    </div>
                    
                    <div className="flex items-center w-full md:w-auto justify-between md:justify-end">
                        <div className="text-right w-24">
                           <div className="text-[10px] text-slate-500 font-bold tracking-wider">ALVO</div>
                           <div className="font-mono text-slate-400">{formatMoney(item.targetPrice)}</div>
                        </div>
                        
                        {/* SEPARADOR VERTICAL */}
                        <div className="h-8 w-px bg-slate-700 mx-4"></div>

                        <div className="text-right w-28">
                           <div className="text-[10px] text-slate-500 font-bold tracking-wider">ATUAL</div>
                           <div className={`font-mono text-lg font-bold ${isDeal ? 'text-emerald-400' : 'text-slate-200'}`}>
                             {formatMoney(item.lastPrice)}
                           </div>
                        </div>
                    </div>

                    <div className="flex gap-2 w-full md:w-auto justify-center border-t border-slate-800 pt-2 md:pt-0 md:border-0 md:ml-4">
                       {isActiveEvent && (
                         <button onClick={() => acknowledgeItem(item.id)} className="bg-emerald-600 text-white p-2 rounded-full shadow-lg"><Eye size={16}/></button>
                       )}
                       <button title="Forçar Atualização" onClick={() => resetItem(item.id)} className="text-slate-500 hover:text-emerald-400 p-2"><RefreshCw size={16}/></button>
                       <button onClick={() => { setEditingItem(item); setEditingTargetInput(formatMoney(item.targetPrice).replace('z','').trim()); }} className="text-slate-500 hover:text-blue-400 p-2"><Edit2 size={16}/></button>
                       <button onClick={() => removeItem(item.id)} className="text-slate-500 hover:text-red-400 p-2"><Trash2 size={16}/></button>
                    </div>
                 </div>
               );
            })}
            {sortedItems.length === 0 && <div className="p-8 text-center text-slate-500">Adicione itens para o servidor monitorar.</div>}
         </div>
      </div>
    </div>
  );
};

export default App;
