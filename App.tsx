
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

const SYNC_INTERVAL_MS = 2000; // Sincroniza com servidor a cada 2s

const App: React.FC = () => {
  // -- State --
  const [items, setItems] = useState<Item[]>(MOCK_ITEMS);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [dataLoaded, setDataLoaded] = useState(false);

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
  const previousItemsRef = useRef<Item[]>([]); // Para detectar mudanças e tocar som
  
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

  const playSound = useCallback((type: 'deal' | 'drop') => {
    try {
      if (!audioCtxRef.current) initAudio();
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const now = ctx.currentTime;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'deal') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(1046.50, now + 0.15);
        
        // VOLUME AUMENTADO (De 0.05 para 0.3)
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        
        osc.start(now);
        osc.stop(now + 0.6);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.3);
        
        // VOLUME AUMENTADO (De 0.1 para 0.4)
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) { console.error(e); }
  }, [initAudio]);

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
          // Se estamos editando, não atualiza a UI drasticamente para não pular o cursor
          if (!editingItem) {
             setItems(data.items || []);
             setSettings(data.settings || INITIAL_SETTINGS);
             
             if (!dataLoaded) {
                 setDataLoaded(true);
                 setTempSettings(data.settings || INITIAL_SETTINGS);
             }
          }
        }
      } catch (e) { console.error("Sync error", e); }
    };

    fetchData(); // Immediate load
    const interval = setInterval(fetchData, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [editingItem, dataLoaded]);

  // -- SOUND EFFECT LOGIC --
  useEffect(() => {
    if (!dataLoaded) return;
    
    // Compara o estado atual com o anterior para ver se houve novidade vinda do servidor
    const prevItems = previousItemsRef.current;
    
    // Detecta novos DEALS ou DROPS que não estavam "ack" (vistos)
    let triggeredSound = false;

    items.forEach(newItem => {
        const oldItem = prevItems.find(p => p.id === newItem.id);
        
        // Se o servidor marcou como não visto (isAck = false) e antes estava visto (ou nem existia)
        // Isso significa que o servidor acabou de detectar algo
        if (!newItem.isAck && (oldItem?.isAck !== false)) {
            const isDeal = newItem.lastPrice && newItem.lastPrice <= newItem.targetPrice;
            if (isDeal) {
                playSound('deal');
                triggeredSound = true;
            } else if (newItem.hasPriceDrop) {
                playSound('drop');
                triggeredSound = true;
            }
        }
    });

    previousItemsRef.current = items;
  }, [items, dataLoaded, playSound]);


  // -- HANDLERS --
  const toggleAutomation = () => {
    initAudio();
    const newSettings = { ...settings, isRunning: !settings.isRunning };
    setSettings(newSettings);
    saveData(items, newSettings);
  };

  const handleSaveSettings = () => {
    initAudio();
    // Preserva o isRunning atual ao salvar configurações do modal
    const mergedSettings = { ...tempSettings, isRunning: settings.isRunning };
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

  const acknowledgeAll = () => {
    if (confirm("Marcar tudo como visto?")) {
      const newList = items.map(i => ({ ...i, isAck: true, hasPriceDrop: false }));
      setItems(newList);
      saveData(newList, settings);
    }
  };
  
  const acknowledgeItem = (id: string) => {
      const newList = items.map(i => i.id === id ? { ...i, isAck: true, hasPriceDrop: false } : i);
      setItems(newList);
      saveData(newList, settings);
  };

  const saveEdit = () => {
      if (!editingItem) return;
      const newList = items.map(i => i.id === editingItem.id ? editingItem : i);
      setItems(newList);
      saveData(newList, settings);
      setEditingItem(null);
  };

  // Sorting for UI
  const sortedItems = [...items].sort((a, b) => {
      const aDeal = (a.lastPrice && a.lastPrice <= a.targetPrice) || a.hasPriceDrop;
      const bDeal = (b.lastPrice && b.lastPrice <= b.targetPrice) || b.hasPriceDrop;
      
      // 1. Alertas ativos (não vistos) primeiro
      const aActive = aDeal && !a.isAck;
      const bActive = bDeal && !b.isAck;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      
      // 2. Deals vistos
      if (aDeal && !bDeal) return -1;
      if (!aDeal && bDeal) return 1;
      
      return a.name.localeCompare(b.name);
  });

  const activeAlertsCount = items.filter(i => ((i.lastPrice && i.lastPrice <= i.targetPrice) || i.hasPriceDrop) && !i.isAck).length;
  const currentHour = new Date().getHours();
  const isNightPause = currentHour >= 1 && currentHour < 8;

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
      `}</style>

      {/* HEADER */}
      <header className="max-w-6xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
           <h1 className="text-xl font-bold text-white flex items-center gap-2"><Activity className="text-blue-500"/> Ragnarok Cloud Tracker</h1>
           <div className="flex gap-2 mt-1">
             <span className="text-[10px] bg-slate-800 px-2 rounded border border-slate-700">Server-Side Auto</span>
             <span className="text-[10px] bg-slate-800 px-2 rounded border border-slate-700 text-slate-400">
               {items.length} {items.length === 1 ? 'Item' : 'Itens'}
             </span>
             {saveStatus === 'saving' && <span className="text-[10px] text-blue-400">Sincronizando...</span>}
           </div>
        </div>
        
        <div className="flex gap-2">
           {activeAlertsCount > 0 && (
             <button onClick={acknowledgeAll} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs flex items-center gap-1 animate-pulse">
                <ListChecks size={14} /> Visto ({activeAlertsCount})
             </button>
           )}
           <button onClick={() => setShowSettings(!showSettings)} className="bg-slate-800 border border-slate-700 p-2 rounded hover:bg-slate-700 transition">
              <SettingsIcon size={16} />
           </button>
           <button 
             onClick={toggleAutomation}
             className={`px-4 py-2 rounded font-bold flex items-center gap-2 text-xs transition ${settings.isRunning ? 'bg-emerald-600 text-white' : 'bg-red-900/30 text-red-400 border border-red-800'}`}
           >
             {settings.isRunning ? <><Pause size={14}/> ONLINE</> : <><Play size={14}/> PAUSADO</>}
           </button>
        </div>
      </header>
      
      {/* STATUS BAR */}
      {settings.isRunning && isNightPause && (
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
