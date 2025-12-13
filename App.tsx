import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Item, Settings, Status } from './types';
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
  CheckCircle2
} from 'lucide-react';

// Simple notification sound (beep)
const playAlertSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // High pitch
    oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.5);
    
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (e) {
    console.error("Audio play failed", e);
  }
};

const UPDATE_INTERVAL_MS = 2 * 60 * 1000; // 2 Minutes
const SAFETY_DELAY_MS = 5000; // 5 Seconds safety delay between requests (matches Google Sheets)

const App: React.FC = () => {
  // -- State --
  const [items, setItems] = useState<Item[]>(() => {
    const saved = localStorage.getItem('ro_items');
    return saved ? JSON.parse(saved) : MOCK_ITEMS;
  });
  
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('ro_settings');
    return saved ? JSON.parse(saved) : INITIAL_SETTINGS;
  });

  // Local state for settings form (to allow "Save" action)
  const [tempSettings, setTempSettings] = useState<Settings>(settings);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  const [isRunning, setIsRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Inputs
  const [newItemName, setNewItemName] = useState('');
  const [newItemTarget, setNewItemTarget] = useState<string>('');

  // -- Refs for loop control --
  const isRunningRef = useRef(isRunning);
  const itemsRef = useRef(items);
  const settingsRef = useRef(settings);
  const processingRef = useRef(false);
  const lastFetchTimeRef = useRef<number>(0);

  // Sync refs with state
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => { itemsRef.current = items; localStorage.setItem('ro_items', JSON.stringify(items)); }, [items]);
  
  // Sync settings ref only when actually saved
  useEffect(() => { 
    settingsRef.current = settings; 
    localStorage.setItem('ro_settings', JSON.stringify(settings)); 
    // Also sync temp settings if settings change externally
    setTempSettings(settings);
  }, [settings]);

  // -- Sorting Logic --
  // Items that are "Good Deals" (Price <= Target) go to top.
  const getSortedItems = useCallback((currentItems: Item[]) => {
    return [...currentItems].sort((a, b) => {
      const aIsDeal = a.lastPrice !== null && a.lastPrice > 0 && a.lastPrice <= a.targetPrice;
      const bIsDeal = b.lastPrice !== null && b.lastPrice > 0 && b.lastPrice <= b.targetPrice;

      if (aIsDeal && !bIsDeal) return -1;
      if (!aIsDeal && bIsDeal) return 1;
      
      // If both are deals or both are not, sort by ID (stable) or Last Updated
      return 0; 
    });
  }, []);

  // -- Automation Loop --
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (!isRunningRef.current || processingRef.current) return;

      // Enforce safety delay between ANY request (Global Throttle)
      const now = Date.now();
      if (now - lastFetchTimeRef.current < SAFETY_DELAY_MS) {
        return; 
      }

      const currentItems = itemsRef.current;
      
      // Find one item that needs update
      // Logic: Find item where nextUpdate < now
      const candidate = currentItems.find(i => i.nextUpdate <= now && i.status !== Status.LOADING);

      if (candidate) {
        processingRef.current = true;
        
        // Mark as loading
        setItems(prev => prev.map(i => i.id === candidate.id ? { ...i, status: Status.LOADING } : i));

        try {
          // Fetch
          const result = await fetchPrice(
            candidate.name, 
            settingsRef.current.cookie,
            settingsRef.current.useProxy,
            settingsRef.current.proxyUrl
          );

          // Update timestamp for throttle
          lastFetchTimeRef.current = Date.now();

          setItems(prev => {
            const updatedList = prev.map(i => {
              if (i.id !== candidate.id) return i;

              const isSuccess = result.success;
              const newPrice = result.price;
              
              // Alert Logic
              const isDeal = isSuccess && newPrice !== null && newPrice > 0 && newPrice <= i.targetPrice;
              
              if (isDeal) {
                playAlertSound();
              }

              return {
                ...i,
                lastPrice: newPrice,
                lastUpdated: new Date().toISOString(),
                status: isSuccess ? (newPrice === 0 ? Status.ALERTA : Status.OK) : Status.ERRO,
                message: result.error || undefined,
                nextUpdate: Date.now() + UPDATE_INTERVAL_MS // Schedule next update in 2 mins
              };
            });
            
            return updatedList; 
          });

        } catch (e) {
          console.error(e);
          setItems(prev => prev.map(i => i.id === candidate.id ? { ...i, status: Status.ERRO, nextUpdate: Date.now() + UPDATE_INTERVAL_MS } : i));
        } finally {
          processingRef.current = false;
        }
      }
    }, 1000); // Check every second who needs an update

    return () => clearInterval(intervalId);
  }, []);

  // -- Handlers --
  const toggleAutomation = () => {
    setIsRunning(!isRunning);
  };

  const handleSaveSettings = () => {
    setSettings(tempSettings);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  const addNewItem = () => {
    if (!newItemName.trim()) return;
    const target = parseInt(newItemTarget.replace(/\./g, '')) || 1000000; // Default 1M if empty

    const newItem: Item = {
      id: Date.now().toString(),
      name: newItemName.trim(),
      targetPrice: target,
      lastPrice: null,
      lastUpdated: null,
      status: Status.IDLE,
      nextUpdate: 0 // Ready immediately
    };
    setItems(prev => [...prev, newItem]);
    setNewItemName('');
    setNewItemTarget('');
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const editTargetPrice = (id: string) => {
    const newPrice = prompt("Novo Preço Alvo:");
    if (newPrice) {
      const val = parseInt(newPrice.replace(/\D/g, ''));
      if (!isNaN(val)) {
        setItems(prev => prev.map(i => i.id === id ? { ...i, targetPrice: val } : i));
      }
    }
  };

  // -- Render Helpers --
  const formatMoney = (val: number | null) => {
    if (val === null) return '--';
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  };

  const sortedItems = getSortedItems(items);

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200 p-4 md:p-8 font-sans">
      
      {/* CSS for Pulse Animation */}
      <style>{`
        @keyframes pulse-green {
          0% { background-color: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.2); }
          50% { background-color: rgba(16, 185, 129, 0.2); border-color: rgba(16, 185, 129, 0.8); box-shadow: 0 0 15px rgba(16, 185, 129, 0.2); }
          100% { background-color: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.2); }
        }
        .animate-pulse-green {
          animation: pulse-green 2s infinite;
        }
      `}</style>

      {/* Header */}
      <header className="max-w-6xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="text-blue-500" />
            Ragnarok Market Tracker
          </h1>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`px-4 py-2 rounded text-slate-200 border transition flex items-center gap-2 text-sm ${showSettings ? 'bg-[#1e293b] border-blue-500' : 'bg-[#161b22] border-[#30363d] hover:bg-[#21262d]'}`}
          >
            <SettingsIcon size={16} /> Configurações
          </button>
          
          <button 
            onClick={toggleAutomation}
            className={`px-6 py-2 rounded font-bold shadow-lg transition flex items-center gap-2 text-sm ${
              isRunning 
              ? 'bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20' 
              : 'bg-blue-600 hover:bg-blue-500 text-white border border-blue-500'
            }`}
          >
            {isRunning ? <><Pause size={16} /> PAUSAR MONITORAMENTO</> : <><Play size={16} /> INICIAR MONITORAMENTO</>}
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="max-w-6xl mx-auto mb-6 bg-[#161b22] border border-[#30363d] rounded-lg p-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider flex items-center gap-2">
            Configurações de Acesso
            {saveStatus === 'saved' && <span className="text-emerald-500 text-xs flex items-center gap-1 normal-case font-normal"><CheckCircle2 size={12} /> Salvo com sucesso!</span>}
          </h3>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Cookie de Sessão</label>
              <textarea 
                value={tempSettings.cookie}
                onChange={(e) => setTempSettings({...tempSettings, cookie: e.target.value})}
                placeholder="Cole aqui todo o conteúdo do Cookie..."
                className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-sm focus:border-blue-500 outline-none font-mono text-slate-300 min-h-[80px]"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Acesse ro.gnjoylatam.com, faça login, abra o Console (F12) &rarr; Network. Copie o valor de "Cookie" de qualquer requisição.
              </p>
            </div>
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
                 <input 
                    type="checkbox"
                    checked={tempSettings.useProxy}
                    onChange={(e) => setTempSettings({...tempSettings, useProxy: e.target.checked})}
                    className="rounded border-slate-700 bg-slate-900"
                 />
                 Usar Proxy (Necessário para Web/Browser)
              </label>

              <button 
                onClick={handleSaveSettings}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded text-sm font-medium transition flex items-center gap-2 shadow-lg shadow-emerald-900/20"
              >
                <Save size={16} /> SALVAR CONFIGURAÇÕES
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
            <label className="block text-xs text-slate-500 mb-1 font-mono">NOME DO ITEM</label>
            <input 
              type="text" 
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Ex: Carta Hidra"
              className="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-sm focus:border-blue-500 outline-none text-white placeholder-slate-600"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-slate-500 mb-1 font-mono">PREÇO ALVO</label>
            <input 
              type="number" 
              value={newItemTarget}
              onChange={(e) => setNewItemTarget(e.target.value)}
              placeholder="1000000"
              className="w-full bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-sm focus:border-blue-500 outline-none text-white placeholder-slate-600"
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
          <div className="col-span-5">Item</div>
          <div className="col-span-2">Preço Alvo</div>
          <div className="col-span-2">Preço Atual</div>
          <div className="col-span-2">Atualizado</div>
          <div className="col-span-1 text-right">Ações</div>
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
              
              return (
                <div 
                  key={item.id} 
                  className={`grid grid-cols-12 gap-4 px-6 py-4 items-center transition-all duration-500 
                    ${isDeal ? 'animate-pulse-green border-l-4 border-l-emerald-500' : 'hover:bg-[#1c2128] border-l-4 border-l-transparent'}
                  `}
                >
                  {/* Item Column */}
                  <div className="col-span-5 flex flex-col justify-center">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white text-sm">{item.name}</span>
                    </div>
                    {hasError && <div className="text-[10px] text-red-400 mt-1 truncate max-w-[250px]">{item.message}</div>}
                  </div>

                  {/* Target Price */}
                  <div className="col-span-2 font-mono text-slate-400 text-sm">
                    {formatMoney(item.targetPrice)}
                  </div>

                  {/* Current Price */}
                  <div className="col-span-2">
                     {item.lastPrice !== null ? (
                       <span className={`font-mono font-bold text-lg ${isDeal ? 'text-emerald-400' : 'text-white'}`}>
                         {formatMoney(item.lastPrice)}
                       </span>
                     ) : (
                       <span className="text-slate-600 font-mono">--</span>
                     )}
                  </div>

                  {/* Last Update */}
                  <div className="col-span-2 text-sm text-slate-500">
                    {item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Nunca'}
                  </div>

                  {/* Actions */}
                  <div className="col-span-1 flex justify-end gap-2">
                    <button 
                      onClick={() => editTargetPrice(item.id)}
                      className="text-slate-500 hover:text-blue-400 p-1 transition"
                      title="Editar Preço Alvo"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={() => removeItem(item.id)}
                      className="text-slate-500 hover:text-red-400 p-1 transition"
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