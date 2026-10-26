import { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, ShieldCheck } from 'lucide-react';
import type { TerminalLog } from '../types';

export const TerminalSimulator: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [activeTab, setActiveTab] = useState<'stream' | 'sockets' | 'system'>('stream');
  const [visibleCount, setVisibleCount] = useState(6);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const initialLogs: TerminalLog[] = [
    { id: '1', time: '14:22:01.102', level: 'info', message: '[WHATSAPP] Phone paired via QR code (port 4848)' },
    { id: '2', time: '14:22:01.145', level: 'accent', message: '[SECURITY] Running 100% locally on your computer' },
    { id: '3', time: '14:22:03.204', level: 'info', message: '[VOICE NOTE] "Book me a cab to the airport in 20 mins"' },
    { id: '4', time: '14:22:03.580', level: 'accent', message: '[CAB] Checking Uber & Lyft... Found UberX for $24.50' },
    { id: '5', time: '14:22:04.012', level: 'success', message: '[CONFIRMED] UberX booked! Driver Michael arriving in 8m' },
    { id: '6', time: '14:22:04.420', level: 'info', message: '[VOICE NOTE] "Find a cozy hotel in Paris under $150"' },
    { id: '7', time: '14:22:04.810', level: 'accent', message: '[HOTEL] Hotel Gustave ($135/night, 4.8★) reserved' },
    { id: '8', time: '14:22:05.110', level: 'info', message: '[TEXT] "Make a modern website for my coffee shop"' },
    { id: '9', time: '14:22:05.320', level: 'success', message: '[WEBSITE] Page published live: dailyroast.pages.dev' },
    { id: '10', time: '14:22:05.350', level: 'dim', message: '[SCREENSHOT] Confirmation screenshot texted back to WhatsApp' },
    { id: '11', time: '14:22:08.100', level: 'info', message: '[DAEMON] Ready for next request • 0 cloud data leaks' },
  ];

  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setVisibleCount((prev) => {
        if (prev < initialLogs.length) {
          return prev + 1;
        }
        return 4;
      });
    }, 2400);

    return () => clearInterval(timer);
  }, [isPlaying, initialLogs.length]);

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [visibleCount]);

  return (
    <div className="rounded border border-[#ead6cd] bg-[#fcf9f8] p-3 shadow-sm overflow-hidden flex flex-col font-mono text-xs">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between border-b border-[#f4ebe6] pb-2 px-1 mb-2 text-[11px] text-[#a16245]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-1">
            <span className="size-2 rounded-full bg-rose-400"></span>
            <span className="size-2 rounded-full bg-amber-400"></span>
            <span className="size-2 rounded-full bg-emerald-400"></span>
          </div>
          <span className="font-bold tracking-wider uppercase text-[#1d110c]">daemon-runtime.tty</span>
          <span className="hidden sm:inline text-obsidian-muted font-normal">• port 4848 [synced]</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>LIVE</span>
          </div>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Pause log stream' : 'Resume log stream'}
            className="p-1 rounded hover:bg-[#ead6cd] text-[#59534E] hover:text-[#1d110c] transition-colors cursor-pointer"
          >
            {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 text-[#ff5100]" />}
          </button>

          <button
            onClick={() => setVisibleCount(4)}
            title="Reset logs"
            className="p-1 rounded hover:bg-[#ead6cd] text-[#59534E] hover:text-[#1d110c] transition-colors cursor-pointer"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-2 px-1 text-[11px] border-b border-[#f4ebe6] pb-1.5">
        <button
          onClick={() => setActiveTab('stream')}
          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
            activeTab === 'stream'
              ? 'bg-[#181311] text-white'
              : 'text-obsidian-muted hover:text-[#1d110c] hover:bg-[#f4ebe6]'
          }`}
        >
          Live Stream
        </button>
        <button
          onClick={() => setActiveTab('sockets')}
          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
            activeTab === 'sockets'
              ? 'bg-[#181311] text-white'
              : 'text-obsidian-muted hover:text-[#1d110c] hover:bg-[#f4ebe6]'
          }`}
        >
          WhatsApp Socket
        </button>
        <button
          onClick={() => setActiveTab('system')}
          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
            activeTab === 'system'
              ? 'bg-[#181311] text-white'
              : 'text-obsidian-muted hover:text-[#1d110c] hover:bg-[#f4ebe6]'
          }`}
        >
          RAM &amp; Privacy
        </button>
      </div>

      {/* Terminal Screen Container */}
      <div className="relative rounded border border-[#ead6cd] bg-[#181311] text-[#f3f1eb] p-3.5 font-mono text-[11px] shadow-inner min-h-[220px] max-h-[270px] overflow-hidden flex flex-col justify-between">
        {activeTab === 'stream' && (
          <div ref={logsContainerRef} className="space-y-1.5 overflow-y-auto pr-1">
            {initialLogs.slice(0, visibleCount).map((log) => {
              let badgeColor = 'text-stone-400';
              if (log.level === 'success') badgeColor = 'text-emerald-400 font-semibold';
              if (log.level === 'accent') badgeColor = 'text-[#ff7836] font-semibold';
              if (log.level === 'dim') badgeColor = 'text-stone-500 italic';

              return (
                <div key={log.id} className="flex items-start gap-2 leading-relaxed animate-fadeIn">
                  <span className="text-stone-600 select-none shrink-0">{log.time}</span>
                  <span className={badgeColor}>{log.message}</span>
                </div>
              );
            })}

            <div className="flex items-center gap-1.5 pt-1 text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="text-stone-400 text-[10px]">daemon listening on ws://127.0.0.1:4848</span>
              <span className="inline-block w-2 h-3.5 bg-[#ff5100] animate-pulse ml-1"></span>
            </div>
          </div>
        )}

        {activeTab === 'sockets' && (
          <div className="space-y-2 py-1">
            <div className="flex items-center justify-between text-stone-400 border-b border-stone-800 pb-1.5">
              <span>PROTOCOL: WhatsApp Multi-Device Sync</span>
              <span className="text-emerald-400">STATE: PAIRED</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="bg-stone-900 p-2 rounded border border-stone-800">
                <div className="text-stone-400">Connection</div>
                <div className="text-stone-100 font-bold">127.0.0.1:4848</div>
              </div>
              <div className="bg-stone-900 p-2 rounded border border-stone-800">
                <div className="text-stone-400">Security</div>
                <div className="text-emerald-400 font-bold">End-to-End Encrypted</div>
              </div>
              <div className="bg-stone-900 p-2 rounded border border-stone-800">
                <div className="text-stone-400">Voice Note Transcriber</div>
                <div className="text-[#ff7836] font-bold">Local Machine Engine</div>
              </div>
              <div className="bg-stone-900 p-2 rounded border border-stone-800">
                <div className="text-stone-400">Average Speed</div>
                <div className="text-stone-100 font-bold">&lt; 1.8s Response</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="space-y-2 py-1">
            <div className="flex items-center justify-between text-stone-400 border-b border-stone-800 pb-1.5">
              <span>PRIVACY AUDIT</span>
              <span className="text-emerald-400">0% CLOUD LEAKS</span>
            </div>
            <div className="space-y-1.5 text-[10px]">
              <div className="flex justify-between items-center text-stone-300">
                <span>Memory Footprint</span>
                <span className="font-bold text-stone-100">46.2 MB (Super Lightweight)</span>
              </div>
              <div className="w-full bg-stone-800 h-1.5 rounded overflow-hidden">
                <div className="bg-[#ff5100] h-full w-[4%]"></div>
              </div>

              <div className="flex justify-between items-center text-stone-300 pt-1">
                <span>Execution Speed</span>
                <span className="font-bold text-emerald-400">Sub-200ms Instant Wakeup</span>
              </div>
              <div className="w-full bg-stone-800 h-1.5 rounded overflow-hidden">
                <div className="bg-emerald-500 h-full w-[85%]"></div>
              </div>

              <div className="text-stone-400 pt-1 flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-emerald-400" />
                <span>Runs 100% locally. Zero data leaves your computer.</span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-2 pt-2 border-t border-stone-800/80 flex items-center justify-between text-[10px] text-stone-500">
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold">●</span>
            <span>WhatsApp Port 4848</span>
          </div>
          <span>WEAVE-DAEMON v2.3</span>
        </div>
      </div>
    </div>
  );
};
