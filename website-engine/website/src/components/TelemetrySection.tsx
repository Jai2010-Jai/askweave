import { useState } from 'react';
import { Activity, Smartphone } from 'lucide-react';

export const TelemetrySection: React.FC = () => {
  const [metricView, setMetricView] = useState<'realtime' | 'aggregate'>('realtime');

  return (
    <section className="flex flex-col gap-6 pt-4 border-t border-[#f4ebe6]" id="metrics">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold tracking-widest uppercase text-[#ff5100]">
            SOVEREIGN METRICS
          </span>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-[#1d110c]">
            Developer Impact Telemetry
          </h2>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 bg-[#f4ebe6] p-1 rounded border border-[#ead6cd] font-mono text-[11px]">
          <button
            onClick={() => setMetricView('realtime')}
            className={`px-3 py-1 rounded transition-colors font-bold cursor-pointer ${
              metricView === 'realtime'
                ? 'bg-[#181311] text-white shadow-sm'
                : 'text-obsidian-muted hover:text-[#1d110c]'
            }`}
          >
            Live Daemon Stats
          </button>
          <button
            onClick={() => setMetricView('aggregate')}
            className={`px-3 py-1 rounded transition-colors font-bold cursor-pointer ${
              metricView === 'aggregate'
                ? 'bg-[#181311] text-white shadow-sm'
                : 'text-obsidian-muted hover:text-[#1d110c]'
            }`}
          >
            All-Time Impact
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Metric 1: 0% Cloud Leaks */}
        <div className="flex flex-col gap-3 rounded border border-[#ead6cd] bg-[#fcf9f8] p-5 shadow-sm">
          <div className="aspect-video w-full rounded border border-[#ead6cd] bg-[#181311] p-4 flex flex-col justify-between text-stone-200 font-mono shadow-inner relative overflow-hidden">
            <div className="flex justify-between items-center text-[10px] text-stone-400 border-b border-stone-800 pb-1.5">
              <span>SECURITY BOUNDARY</span>
              <span className="text-emerald-400 font-bold">AIR-GAPPED RAM</span>
            </div>

            <div className="flex items-center justify-center my-auto gap-4">
              <svg className="size-18 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#292524" strokeWidth="3" />
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeDasharray="88, 100"
                  strokeLinecap="round"
                />
              </svg>
              <div className="text-left font-mono">
                <div className="text-[10px] text-stone-400">HOST RAM ONLY</div>
                <div className="text-lg font-black text-emerald-400">0.00 B</div>
                <div className="text-[9px] text-stone-500">Cloud Exfiltration</div>
              </div>
            </div>

            <div className="flex justify-between text-[9px] text-stone-500 pt-1 border-t border-stone-800">
              <span>Token Storage: OS Keychain</span>
              <span className="text-emerald-400 font-semibold">100% Sovereign</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-3xl font-extrabold text-[#1d110c]">0%</span>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#1d110c]">
              Cloud Leaks
            </h4>
            <p className="text-xs font-sans text-[#59534E]">
              All token keys and audio files remain strictly ephemeral inside host RAM.
            </p>
          </div>
        </div>

        {/* Metric 2: 1.8s Local Test Cycles */}
        <div className="flex flex-col gap-3 rounded border border-[#ead6cd] bg-[#fcf9f8] p-5 shadow-sm">
          <div className="aspect-video w-full rounded border border-[#ead6cd] bg-[#181311] p-4 flex flex-col justify-between text-stone-200 font-mono shadow-inner relative overflow-hidden">
            <div className="flex justify-between items-center text-[10px] text-stone-400 border-b border-stone-800 pb-1.5">
              <span>PIPELINE VELOCITY</span>
              <span className="text-[#ff7836] font-bold">1.8s MEAN</span>
            </div>

            <div className="my-auto py-2">
              <svg className="w-full h-14" viewBox="0 0 200 60" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="gradient-latency" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff5100" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#ff5100" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,45 Q30,40 50,25 T100,20 T150,15 T200,10 L200,60 L0,60 Z"
                  fill="url(#gradient-latency)"
                />
                <path
                  d="M0,45 Q30,40 50,25 T100,20 T150,15 T200,10"
                  fill="none"
                  stroke="#ff5100"
                  strokeWidth="2.5"
                />
                <circle cx="200" cy="10" r="3.5" fill="#ff5100" className="animate-ping" />
                <circle cx="200" cy="10" r="3" fill="#ffffff" />
              </svg>
            </div>

            <div className="flex justify-between text-[9px] text-stone-500 pt-1 border-t border-stone-800">
              <span>Cold Start: 142ms</span>
              <span className="text-[#ff7836] font-semibold">12 Tests in 410ms</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-3xl font-extrabold text-[#1d110c]">1.8s</span>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#1d110c]">
              Local Test Cycles
            </h4>
            <p className="text-xs font-sans text-[#59534E]">
              Mean pipeline traversal time from voice receipt to test suite completion.
            </p>
          </div>
        </div>

        {/* Metric 3: 14.2k PRs Shipped from Mobile / 0 New Apps Needed */}
        <div className="flex flex-col gap-3 rounded border border-[#ead6cd] bg-[#fcf9f8] p-5 shadow-sm">
          <div className="aspect-video w-full rounded border border-[#ead6cd] bg-[#181311] p-4 flex flex-col justify-between text-stone-200 font-mono shadow-inner relative overflow-hidden">
            <div className="flex justify-between items-center text-[10px] text-stone-400 border-b border-stone-800 pb-1.5">
              <span>DEVICE MESH TELEMETRY</span>
              <span className="text-emerald-400 font-bold">NATIVE PROTOCOL</span>
            </div>

            <div className="my-auto flex items-center justify-around py-1">
              <div className="flex flex-col items-center gap-1">
                <div className="size-9 rounded-full bg-emerald-600/20 border border-emerald-500 flex items-center justify-center text-emerald-400">
                  <Smartphone className="size-4" />
                </div>
                <span className="text-[9px] text-stone-300">WhatsApp</span>
              </div>

              <div className="flex-1 px-2 flex flex-col items-center">
                <span className="text-[8px] text-[#ff7836] font-bold">DIRECT NOISE WSS</span>
                <div className="w-full h-0.5 bg-stone-700 relative">
                  <div className="absolute top-0 bottom-0 left-0 bg-[#ff5100] w-1/2 animate-pulse"></div>
                </div>
                <span className="text-[8px] text-stone-500">Port 4848</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <div className="size-9 rounded-full bg-stone-800 border border-[#ff5100]/60 flex items-center justify-center text-[#ff5100]">
                  <Activity className="size-4" />
                </div>
                <span className="text-[9px] text-stone-300">Localhost</span>
              </div>
            </div>

            <div className="flex justify-between text-[9px] text-stone-500 pt-1 border-t border-stone-800">
              <span>Protocol: Multi-Device WSS</span>
              <span className="text-emerald-400 font-semibold">14,200+ Actions</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-3xl font-extrabold text-[#1d110c]">14.2k</span>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#1d110c]">
              PRs Shipped from Mobile
            </h4>
            <p className="text-xs font-sans text-[#59534E]">
              Clean merges committed outside IDE environments with full CI pass rates.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
