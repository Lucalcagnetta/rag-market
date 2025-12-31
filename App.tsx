
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Item, Settings, Status } from './types';
import { INITIAL_SETTINGS, MOCK_ITEMS } from './constants';
import { 
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
  X,
  Pin,
  ThumbsUp,
  Check,
  AlertTriangle,
  Filter
} from 'lucide-react';

const SYNC_INTERVAL_MS = 2000;

const App: React.FC = () => {
  const [items, setItems] = useState<Item[]>(MOCK_ITEMS);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [filterRedAlerts, setFilterRedAlerts] = useState(false);
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('ro_volume');
    return saved !== null ? parseFloat(saved) : 0.5;
  });

  // --- CALCULADORA ---
  const [calcPrice, setCalcPrice] = useState(() => localStorage.getItem('ro_calc_price') || '0,85');
  const [calcQty, setCalcQty] = useState('1');
  const [calcTotal, setCalcTotal] = useState('');
  const isCalculatingRef = useRef(false);

  const [isAddExpanded, setIsAddExpanded] = useState(false);
  const [tempSettings, setTempSettings] = useState<Settings>(settings);
  const [showSettings, setShowSettings] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemTarget, setNewItemTarget] = useState<string>('');
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editingTargetInput, setEditingTargetInput] = useState<string>('');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const previousItemsRef = useRef<Item[]>([]); 
  const pendingAcksRef = useRef<Set<string>>(new Set());

  // --- LÓGICA DA CALCULADORA ---
  useEffect(() => {
    if (isCalculatingRef.current) return;
    isCalculatingRef.current = true;
    const p = parseFloat(calcPrice.replace(',', '.'));
    const q = parseFloat(calcQty.replace(',', '.'));
    if (!isNaN(p) && !isNaN(q)) {
      const total = (p * q).toFixed(2).replace('.', ',');
      setCalcTotal(total);
      localStorage.setItem('ro_calc_price', calcPrice);
    }
    isCalculatingRef.current = false;
  }, [calcPrice, calcQty]);

  const handleTotalChange = (val: string) => {
    setCalcTotal(val);
    if (isCalculatingRef.current) return;
    isCalculatingRef.current = true;
    const p = parseFloat(calcPrice.replace(',', '.'));
    const t = parseFloat(val.replace(',', '.'));
    if (!isNaN(p) && p > 0 && !isNaN(t)) {
      setCalcQty(Math.floor(t / p).toString());
    }
    isCalculatingRef.current = false;
  };

  const initAudio = useCallback(() => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    } catch (e) { console.error(e); }
  }, []);

  const handleVolumeChange = (newVol: number) => {
      setVolume(newVol);
      localStorage.setItem('ro_volume', newVol.toString());
  };

  const playSound = useCallback((type: 'deal' | 'drop' | 'competition') => {
    if (volume === 0) return;
    try {
      if (!audioCtxRef.current) initAudio();
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const now = ctx.currentTime;
      
      const createOsc = (freq: number, startTime: number, duration: number, wave: OscillatorType = 'sine') => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      if (type === 'deal') {
        createOsc(523.25, now, 0.2, 'square');
        createOsc(1046.50, now + 0.1, 0.4, 'square');
      } else if (type === 'competition') {
        createOsc(330, now, 0.15, 'sawtooth');
        createOsc(330, now + 0.2, 0.3, 'sawtooth');
      } else {
        createOsc(880, now, 0.3, 'triangle');
      }
    } catch (e) { console.error(e); }
  }, [initAudio, volume]);

  const saveData = useCallback(async (currentItems: Item[], currentSettings: Settings) => {
    try {
      await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: currentItems, settings: currentSettings })
      });
    } catch (err) { console.error("Failed to save", err); }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/db');
        if (res.ok) {
          const data = await res.json();
          if (!editingItem) {
             const mergedItems = (data.items || []).map((serverItem: Item) => {
                 if (pendingAcksRef.current.has(serverItem.id)) {
                     if (serverItem.isAck) {
                         pendingAcksRef.current.delete(serverItem.id);
                         return serverItem;
                     } else return { ...serverItem, isAck: true, hasPriceDrop: false };
                 }
                 return serverItem;
             });
             setItems(mergedItems);
             setSettings(data.settings || INITIAL_SETTINGS);
             if (!dataLoaded) { setDataLoaded(true); setTempSettings(data.settings || INITIAL_SETTINGS); }
          }
        }
      } catch (e) { console.error("Sync error", e); }
    };
    fetchData(); 
    const interval = setInterval(fetchData, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [editingItem, dataLoaded]);

  // --- LÓGICA DE SOM CORRIGIDA ---
  useEffect(() => {
    if (!dataLoaded) return;
    const prevItems = previousItemsRef.current;
    
    items.forEach(newItem => {
        const oldItem = prevItems.find(p => p.id === newItem.id);
        const isPendingAck = pendingAcksRef.current.has(newItem.id);
        
        // Se o item não está em modo de "visto pendente"
        if (!newItem.isAck && !isPendingAck) {
            const isDeal = newItem.lastPrice && newItem.lastPrice > 0 && newItem.lastPrice <= newItem.targetPrice;
            const isCompAlert = newItem.isUserPrice && newItem.lastPrice !== null && newItem.lastPrice !== newItem.userKnownPrice;
            
            // CONDIÇÃO DE SOM:
            // 1. Mudou de visto para não visto (isAck trocou)
            // 2. OU o preço mudou enquanto ainda estava não visto (queda consecutiva)
            const statusChanged = oldItem?.isAck !== false;
            const priceChanged = oldItem && oldItem.lastPrice !== newItem.lastPrice && newItem.lastPrice !== null;

            if (statusChanged || priceChanged) {
                if (isDeal) playSound('deal');
                else if (isCompAlert) playSound('competition');
                else if (newItem.hasPriceDrop) playSound('drop');
            }
        }
    });
    previousItemsRef.current = items;
  }, [items, dataLoaded, playSound]);

  const toggleAutomation = () => {
    initAudio();
    const nextIsRunning = !settings.isRunning;
    const currentHour = new Date().getHours();
    const isNightTime = currentHour >= 1 && currentHour < 8;
    let nextIgnoreNightPause = settings.ignoreNightPause;
    if (nextIsRunning) nextIgnoreNightPause = isNightTime;
    else nextIgnoreNightPause = false;
    const newSettings = { ...settings, isRunning: nextIsRunning, ignoreNightPause: nextIgnoreNightPause };
    setSettings(newSettings);
    saveData(items, newSettings);
  };

  const handleSaveSettings = () => {
    initAudio();
    const mergedSettings = { ...tempSettings, isRunning: settings.isRunning, ignoreNightPause: settings.ignoreNightPause };
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
    else if (numStr.includes('z')) numStr = numStr.replace('z', '');
    else { const t = parseFloat(numStr); if (!isNaN(t) && t < 1000 && t > 0) multiplier = 1000000; }
    const num = parseFloat(numStr);
    return isNaN(num) ? 0 : Math.floor(num * multiplier);
  };

  const formatMoney = (val: number | null) => {
    if (val === null) return '--';
    const floorValue = (v: number, d: number) => Math.floor(v * Math.pow(10, d)) / Math.pow(10, d);
    if (val >= 1000000) return floorValue(val / 1000000, 2).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'kk';
    if (val >= 1000) return floorValue(val / 1000, 1).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
    return val.toLocaleString('pt-BR'); 
  };
  
  const addNewItem = () => {
    initAudio();
    if (!newItemName.trim()) return;
    const target = parseKkInput(newItemTarget) || 1000000;
    const newItem: Item = { id: Date.now().toString(), name: newItemName.trim(), targetPrice: target, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0, isAck: false, hasPriceDrop: false, isPinned: false, isUserPrice: false, userKnownPrice: null };
    const newList = [...items, newItem];
    setItems(newList);
    saveData(newList, settings);
    setNewItemName('');
    setNewItemTarget('');
    setIsAddExpanded(false);
  };

  const removeItem = (id: string) => {
    if (confirm("Remover item?")) {
      const newList = items.filter(i => i.id !== id);
      setItems(newList);
      saveData(newList, settings);
    }
  };

  const resetItem = (id: string) => {
      const newList = items.map(i => i.id === id ? { ...i, lastPrice: null, lastUpdated: null, status: Status.IDLE, nextUpdate: 0, message: undefined, isAck: true } : i);
      setItems(newList);
      saveData(newList, settings);
  };

  const togglePin = (id: string) => {
    initAudio();
    const newList = items.map(i => i.id === id ? { ...i, isPinned: !i.isPinned } : i);
    setItems(newList);
    saveData(newList, settings);
  };

  const toggleUserPrice = (id: string) => {
    initAudio();
    const newList = items.map(i => {
      if (i.id === id) {
        const isRemoving = i.isUserPrice && i.lastPrice === i.userKnownPrice;
        if (isRemoving) return { ...i, isUserPrice: false, userKnownPrice: null };
        return { ...i, isUserPrice: true, userKnownPrice: i.lastPrice, isAck: true };
      }
      return i;
    });
    setItems(newList);
    saveData(newList, settings);
  };

  const confirmNewUserPrice = (id: string) => {
    initAudio();
    const newList = items.map(i => {
      if (i.id === id && i.lastPrice !== null) {
        return { ...i, userKnownPrice: i.lastPrice, isAck: true, hasPriceDrop: false };
      }
      return i;
    });
    setItems(newList);
    saveData(newList, settings);
    pendingAcksRef.current.add(id);
    fetch(`/api/ack/${id}`, { method: 'POST' }).catch(console.error);
  };

  const acknowledgeAll = async () => {
    if (activeAlertsCount === 0) return;
    if (confirm("Marcar tudo como visto?")) {
      items.forEach(i => pendingAcksRef.current.add(i.id));
      const newList = items.map(i => ({ ...i, isAck: true, hasPriceDrop: false }));
      setItems(newList);
      try { await fetch('/api/ack-all', { method: 'POST' }); } catch (e) { console.error(e); }
    }
  };
  
  const acknowledgeItem = async (id: string) => {
      pendingAcksRef.current.add(id);
      const newList = items.map(i => i.id === id ? { ...i, isAck: true, hasPriceDrop: false } : i);
      setItems(newList);
      try { await fetch(`/api/ack/${id}`, { method: 'POST' }); } catch (e) { console.error(e); }
  };

  const saveEdit = () => {
      if (!editingItem) return;
      const newList = items.map(i => i.id === editingItem.id ? editingItem : i);
      setItems(newList);
      saveData(newList, settings);
      setEditingItem(null);
  };

  const sortedItems = [...items].sort((a, b) => {
      const aDeal = (a.lastPrice && a.lastPrice > 0 && a.lastPrice <= a.targetPrice) || a.hasPriceDrop;
      const bDeal = (b.lastPrice && b.lastPrice > 0 && b.lastPrice <= b.targetPrice) || b.hasPriceDrop;
      const aCompAlert = a.isUserPrice && a.lastPrice !== null && a.lastPrice !== a.userKnownPrice && !aDeal;
      const bCompAlert = b.isUserPrice && b.lastPrice !== null && b.lastPrice !== b.userKnownPrice && !bDeal;
      
      const aActiveGreen = aDeal && !a.isAck;
      const bActiveGreen = bDeal && !b.isAck;
      const aActiveRed = aCompAlert && !a.isAck;
      const bActiveRed = bCompAlert && !b.isAck;

      // PRIORIDADE 1: Novos Negócios (Verde Unseen)
      if (aActiveGreen && !bActiveGreen) return -1;
      if (!aActiveGreen && bActiveGreen) return 1;

      // PRIORIDADE 2: Novas Competições (Vermelho Unseen)
      if (aActiveRed && !bActiveRed) return -1;
      if (!aActiveRed && bActiveRed) return 1;

      // PRIORIDADE 3: Fixados
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      // PRIORIDADE 4: Alertas Vistos (pra não sumirem da vista geral, mas ficarem abaixo dos novos)
      const aAnyAlert = aDeal || aCompAlert;
      const bAnyAlert = bDeal || bCompAlert;
      if (aAnyAlert && !bAnyAlert) return -1;
      if (!aAnyAlert && bAnyAlert) return 1;

      return a.name.localeCompare(b.name);
  });

  const redAlertsTotal = items.filter(item => {
    const isDeal = item.lastPrice && item.lastPrice > 0 && item.lastPrice <= item.targetPrice;
    return item.isUserPrice && item.lastPrice !== null && item.lastPrice !== item.userKnownPrice && !isDeal;
  }).length;

  const displayedItems = filterRedAlerts 
    ? sortedItems.filter(item => {
        const isDeal = item.lastPrice && item.lastPrice > 0 && item.lastPrice <= item.targetPrice;
        return item.isUserPrice && item.lastPrice !== null && item.lastPrice !== item.userKnownPrice && !isDeal;
      })
    : sortedItems;

  const activeAlertsCount = items.filter(i => {
    const isDeal = (i.lastPrice && i.lastPrice > 0 && i.lastPrice <= i.targetPrice) || i.hasPriceDrop;
    const isComp = i.isUserPrice && i.lastPrice !== null && i.lastPrice !== i.userKnownPrice;
    return (isDeal || isComp) && !i.isAck;
  }).length;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (activeAlertsCount > 0) {
       let state = false;
       interval = setInterval(() => {
          document.title = state ? `(${activeAlertsCount}) 🔔 ALERTA!` : `(${activeAlertsCount}) 💰 OPORTUNIDADE!`;
          state = !state;
       }, 1000);
    } else document.title = "Ragnarok Market Tracker";
    return () => clearInterval(interval);
  }, [activeAlertsCount]);

  if (!dataLoaded) return <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-slate-400 font-mono tracking-tighter"><Activity className="animate-spin mr-2 text-blue-500"/> Sincronizando...</div>;

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200 font-sans selection:bg-emerald-500/30">
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

        @keyframes pulse-red {
          0% { background-color: rgba(239, 68, 68, 0.05); border-color: rgba(239, 68, 68, 0.4); }
          50% { background-color: rgba(239, 68, 68, 0.25); border-color: rgba(239, 68, 68, 1); box-shadow: 0 0 20px rgba(239, 68, 68, 0.4); }
          100% { background-color: rgba(239, 68, 68, 0.05); border-color: rgba(239, 68, 68, 0.4); }
        }
        .animate-pulse-red { animation: pulse-red 1s infinite; }

        input[type=range] { -webkit-appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 12px; width: 12px; border-radius: 50%; background: #3b82f6; margin-top: -4px; }
        input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 4px; background: #334155; border-radius: 2px; }
      `}</style>

      <header className="sticky top-0 z-40 bg-[#0d1117]/90 backdrop-blur-md border-b border-slate-800/60 shadow-2xl transition-all w-full">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2">
             <button onClick={acknowledgeAll} disabled={activeAlertsCount === 0} className={`px-3 h-[36px] rounded-lg text-xs font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95 ${activeAlertsCount > 0 ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'}`}>
                <ListChecks size={16} /><span className="hidden sm:inline">Visto Geral</span>
                <span className={`${activeAlertsCount > 0 ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-500'} px-1.5 rounded text-[10px] font-bold`}>{activeAlertsCount}</span>
             </button>

             <button 
                onClick={() => setFilterRedAlerts(!filterRedAlerts)} 
                className={`flex items-center gap-2 px-3 h-[36px] rounded-lg text-xs font-bold transition-all border shadow-lg ${filterRedAlerts ? 'bg-rose-600 border-rose-400 text-white shadow-rose-900/40' : (redAlertsTotal > 0 ? 'bg-slate-800 border-rose-500/50 text-rose-400 hover:bg-rose-950/20' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300')}`}
             >
                <AlertTriangle size={16} className={filterRedAlerts ? 'animate-pulse' : (redAlertsTotal > 0 ? 'text-rose-500' : '')} />
                <span className="hidden md:inline uppercase tracking-tighter">Aba Vermelha</span>
                <span className={`px-1.5 rounded text-[10px] font-bold ${filterRedAlerts ? 'bg-white text-rose-600' : (redAlertsTotal > 0 ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-500')}`}>{redAlertsTotal}</span>
             </button>
          </div>
          
          <div className="hidden lg:flex items-center gap-1 bg-slate-900/50 border border-slate-800 p-1.5 rounded-lg shadow-inner">
             <div className="flex flex-col px-1">
                <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider text-center">Preço (KK)</span>
                <div className="flex items-center bg-slate-950/50 rounded px-2 py-0.5 w-24 border border-slate-800 focus-within:border-slate-600 transition-colors">
                   <span className="text-[10px] text-emerald-600 mr-1">$</span>
                   <input className="w-full bg-transparent text-xs font-mono text-emerald-100 focus:outline-none" placeholder="0,00" value={calcPrice} onChange={e => setCalcPrice(e.target.value)} />
                </div>
             </div>
             <span className="text-slate-600 pb-3">×</span>
             <div className="flex flex-col px-1">
                <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider text-center">Qtd</span>
                <div className="flex items-center bg-slate-950/50 rounded px-2 py-0.5 w-20 border border-slate-800 focus-within:border-slate-600 transition-colors">
                   <input className="w-full bg-transparent text-xs font-mono text-blue-100 focus:outline-none text-center" placeholder="1" value={calcQty} onChange={e => setCalcQty(e.target.value)} />
                </div>
             </div>
             <span className="text-slate-600 pb-3">=</span>
             <div className="flex flex-col px-1">
                <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider text-center">Total (R$)</span>
                <div className="flex items-center bg-slate-950/50 rounded px-2 py-0.5 w-24 border border-slate-800 focus-within:border-slate-600 transition-colors">
                   <span className="text-[10px] text-amber-600 mr-1">R$</span>
                   <input className="w-full bg-transparent text-xs font-mono text-amber-100 focus:outline-none" placeholder="0,00" value={calcTotal} onChange={e => handleTotalChange(e.target.value)} />
                </div>
             </div>
          </div>

          <div className="flex items-center gap-2">
             <div className="relative group flex items-center bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-lg h-[36px] px-2 transition-all cursor-pointer">
                <button onClick={() => handleVolumeChange(volume === 0 ? 0.5 : 0)} className={`transition-colors ${volume === 0 ? 'text-slate-500' : 'text-blue-400'}`}>{volume === 0 ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button>
                <div className="w-0 overflow-hidden group-hover:w-20 transition-all duration-300 flex items-center ml-0 group-hover:ml-2">
                   <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => handleVolumeChange(parseFloat(e.target.value))} className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer" />
                </div>
             </div>
             <button onClick={() => setShowSettings(!showSettings)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 h-[36px] w-[36px] flex items-center justify-center rounded-lg transition-all text-slate-400 hover:text-white"><SettingsIcon size={16} /></button>
             <button onClick={toggleAutomation} className={`h-[36px] px-4 rounded-lg font-bold text-xs flex items-center gap-2 transition-all shadow-lg border ${settings.isRunning ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500/50 text-white' : 'bg-slate-800 border-rose-900/30 text-rose-400'}`}>
               {settings.isRunning ? 'ONLINE' : 'PAUSADO'}
             </button>
          </div>
        </div>
      </header>
      
      <main className="p-2 md:p-8 max-w-6xl mx-auto">
        {filterRedAlerts && (
          <div className="mb-4 bg-rose-950/40 border border-rose-500/50 text-rose-100 p-3 rounded-lg text-center text-xs flex items-center justify-center gap-3 shadow-inner">
            <Filter size={16} className="text-rose-400" /> 
            <span className="font-bold tracking-tight uppercase">Filtro Ativado: Mostrando Apenas Disputas de Preço</span>
            <button onClick={() => setFilterRedAlerts(false)} className="bg-rose-500 hover:bg-rose-400 text-white px-2 py-1 rounded text-[10px] font-bold shadow-lg transition-all active:scale-95">MOSTRAR TUDO</button>
          </div>
        )}

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden shadow-2xl">
           <div className="p-4 bg-[#0d1117] border-b border-[#30363d]">
               <div className={`${isAddExpanded ? 'flex' : 'hidden'} md:flex flex-col md:flex-row gap-2`}>
                  <input className="flex-1 bg-[#161b22] border border-[#30363d] p-2 rounded text-sm text-white" placeholder="Nome do Item..." value={newItemName} onChange={e => setNewItemName(e.target.value)}/>
                  <input className="w-full md:w-32 bg-[#161b22] border border-[#30363d] p-2 rounded text-sm text-white" placeholder="Alvo (ex: 30kk)" value={newItemTarget} onChange={e => setNewItemTarget(e.target.value)}/>
                  <button onClick={addNewItem} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-bold flex items-center justify-center gap-1 shadow-lg shadow-blue-900/20"><Plus size={16}/> ADICIONAR</button>
               </div>
               <div className="md:hidden mt-2">
                   <button onClick={() => setIsAddExpanded(!isAddExpanded)} className="text-slate-500 text-xs w-full py-2 font-bold tracking-widest uppercase">{isAddExpanded ? 'Fechar' : 'Novo Monitoramento'}</button>
               </div>
           </div>
           
           <div className="divide-y divide-[#30363d]">
              {displayedItems.map(item => {
                 const isDeal = item.lastPrice && item.lastPrice > 0 && item.lastPrice <= item.targetPrice;
                 const isCompAlert = item.isUserPrice && item.lastPrice !== null && item.lastPrice !== item.userKnownPrice && !isDeal;
                 const isAck = item.isAck;

                 let bgClass = "bg-[#161b22]";
                 if (isDeal) bgClass = !isAck ? "animate-pulse-green bg-emerald-900/20 border-l-4 border-emerald-500" : "bg-emerald-900/10 border-l-4 border-emerald-700";
                 else if (isCompAlert) bgClass = "animate-pulse-red bg-rose-900/20 border-l-4 border-rose-500";
                 else if (!isAck && item.hasPriceDrop) bgClass = "animate-pulse-blue bg-blue-900/20 border-l-4 border-blue-500";

                 return (
                   <div key={item.id} className={`p-4 flex flex-col md:flex-row items-center gap-4 transition-colors ${bgClass}`}>
                      <div className="flex-1 text-center md:text-left w-full">
                         <div className="font-bold text-white flex items-center justify-center md:justify-start gap-2">
                           {item.isPinned && <Pin size={14} className="text-blue-500 fill-blue-500" />}
                           {item.isUserPrice && <ThumbsUp size={14} className={`${isCompAlert ? 'text-rose-500 fill-rose-500' : 'text-blue-400 fill-blue-400'}`} />}
                           {item.name}
                         </div>
                         <div className="flex items-center justify-center md:justify-start gap-2 mt-1">
                            {item.status === 'LOADING' && <span className="text-[10px] text-blue-400 animate-pulse font-mono uppercase tracking-tighter">Buscando na GNJOY...</span>}
                            <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono"><Clock size={10}/> {item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString().slice(0,5) : '--:--'}</span>
                         </div>
                      </div>

                      <div className="w-full md:w-auto flex items-center justify-center md:justify-end relative min-h-[50px]">
                          <div className="absolute left-0 md:static md:mr-6 flex gap-2">
                              {((isDeal || item.hasPriceDrop) && !isAck) && (
                                   <button onClick={() => acknowledgeItem(item.id)} className="text-emerald-500 hover:bg-emerald-500/10 p-2 rounded-full transition-all" title="Marcar Promoção como Visto"><Eye size={22}/></button>
                              )}
                          </div>
                          <div className="flex items-center justify-center gap-6">
                              <div className="text-center w-24">
                                 <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1 opacity-50">Alvo</div>
                                 <div className="font-mono text-xs text-slate-400">{formatMoney(item.targetPrice)}</div>
                              </div>
                              <div className="h-8 w-px bg-slate-700/50"></div>
                              <div className="text-center w-28">
                                 <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1 opacity-50">Atual</div>
                                 <div className={`font-mono text-lg font-bold ${isDeal ? 'text-emerald-400' : isCompAlert ? 'text-rose-400' : 'text-slate-200'}`}>{formatMoney(item.lastPrice)}</div>
                              </div>
                          </div>
                      </div>

                      <div className="flex gap-2 w-full md:w-auto justify-center md:ml-4 border-t border-slate-800 md:border-0 pt-2 md:pt-0">
                         {isCompAlert && (
                            <button onClick={() => confirmNewUserPrice(item.id)} className="p-2 text-blue-400 animate-pulse bg-blue-400/10 rounded-lg border border-blue-400/30 transition-all hover:bg-blue-400/20" title="Confirmar meu novo preço"><Check size={20}/></button>
                         )}
                         <button title={isCompAlert ? "Atualizar meu preço" : "Marcar como meu preço"} onClick={() => toggleUserPrice(item.id)} className={`p-2 transition-all active:scale-90 ${item.isUserPrice ? (isCompAlert ? 'text-rose-500' : 'text-blue-400') : 'text-slate-500 hover:text-blue-300'}`}><ThumbsUp size={18} className={item.isUserPrice ? (isCompAlert ? "fill-rose-500" : "fill-blue-400") : ""} /></button>
                         <button title="Fixar no Topo" onClick={() => togglePin(item.id)} className={`p-2 transition-all active:scale-90 ${item.isPinned ? 'text-blue-500' : 'text-slate-500 hover:text-blue-400'}`}><Pin size={18} className={item.isPinned ? "fill-blue-500" : ""} /></button>
                         <button title="Forçar Busca" onClick={() => resetItem(item.id)} className="text-slate-500 hover:text-emerald-400 p-2 transition-all"><RefreshCw size={18}/></button>
                         <button title="Editar" onClick={() => { setEditingItem(item); setEditingTargetInput(formatMoney(item.targetPrice).replace('z','').trim()); }} className="text-slate-500 hover:text-blue-400 p-2"><Edit2 size={18}/></button>
                         <button title="Excluir" onClick={() => removeItem(item.id)} className="text-slate-500 hover:text-red-400 p-2"><Trash2 size={18}/></button>
                      </div>
                   </div>
                 );
              })}
              {displayedItems.length === 0 && (
                <div className="p-12 text-center text-slate-500 font-mono text-sm uppercase tracking-widest border-2 border-dashed border-slate-800 m-4 rounded-xl">
                  {filterRedAlerts ? 'Nenhum alerta vermelho ativo' : 'Monitoramento Vazio'}
                </div>
              )}
           </div>
        </div>
      </main>

      {showSettings && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-lg w-full max-w-lg shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold flex items-center gap-2 text-blue-400"><SettingsIcon size={18}/> SERVIDOR LOCAL</h3>
                    <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white"><X size={20}/></button>
                </div>
                <textarea className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-xs font-mono text-slate-300 h-32 mb-6 focus:border-blue-500 outline-none transition-all" placeholder="Cookie..." value={tempSettings.cookie} onChange={e => setTempSettings({...tempSettings, cookie: e.target.value})} />
                <div className="flex justify-end gap-3">
                   <button onClick={() => setShowSettings(false)} className="text-slate-400 px-4 py-2 text-sm hover:text-white transition-all">DESCARTAR</button>
                   <button onClick={handleSaveSettings} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-lg shadow-blue-900/30 transition-all">SALVAR NA NUVEM</button>
                </div>
             </div>
          </div>
      )}

      {editingItem && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-lg w-full max-w-sm shadow-2xl">
                <h3 className="font-bold mb-6 flex items-center gap-2 text-blue-400"><Edit2 size={18}/> AJUSTAR MONITOR</h3>
                <div className="space-y-4">
                    <input className="w-full bg-slate-950 border border-slate-700 p-3 rounded-lg text-white font-medium" value={editingItem.name} onChange={e => setEditingItem({...editingItem, name: e.target.value})} />
                    <input className="w-full bg-slate-950 border border-slate-700 p-3 rounded-lg text-white font-mono" value={editingTargetInput} onChange={e => { setEditingTargetInput(e.target.value); setEditingItem({...editingItem, targetPrice: parseKkInput(e.target.value)}); }} />
                </div>
                <div className="flex justify-end gap-3 mt-8">
                  <button onClick={() => setEditingItem(null)} className="text-slate-400 px-4 py-2 text-sm hover:text-white">CANCELAR</button>
                  <button onClick={saveEdit} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-lg shadow-blue-900/30">CONFIRMAR</button>
                </div>
             </div>
          </div>
      )}
    </div>
  );
};

export default App;
