import { useState, useEffect } from 'react';
import { Play, Pause, Mic, CheckCircle2, Eye } from 'lucide-react';

interface AstPipelineSectionProps {
  onOpenDiff: () => void;
}

export const AstPipelineSection: React.FC<AstPipelineSectionProps> = ({ onOpenDiff }) => {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlayingAudio) {
      interval = setInterval(() => {
        setAudioProgress((prev) => {
          if (prev >= 100) {
            setIsPlayingAudio(false);
            return 0;
          }
          return prev + 5;
        });
      }, 100);
    } else {
      setAudioProgress(0);
    }
    return () => clearInterval(interval);
  }, [isPlayingAudio]);

  const toggleAudio = () => {
    setIsPlayingAudio(!isPlayingAudio);
  };

  return (
    <section className="flex flex-col gap-4" id="pipeline">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold tracking-widest uppercase text-[#ff5100]">
          WORKFLOW SIMULATOR
        </span>
        <h3 className="text-xl sm:text-2xl font-black tracking-tight text-[#1d110c]">
          AST PATCH PIPELINE // REAL-TIME EXECUTION
        </h3>
      </div>

      <div className="rounded border border-[#ead6cd] bg-[#fcf9f8] p-4 lg:p-6 shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left Diagram / Visual Architecture */}
          <div className="lg:col-span-5">
            <div className="w-full aspect-video rounded border border-[#ead6cd] bg-[#181311] p-4 flex flex-col justify-between text-stone-200 font-mono shadow-inner relative overflow-hidden">
              <div 
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                  backgroundImage: 'radial-gradient(#ff5100 1px, transparent 1px)',
                  backgroundSize: '16px 16px'
                }}
              ></div>

              <div className="flex items-center justify-between text-[10px] text-stone-400 border-b border-stone-800 pb-2 relative z-10">
                <span className="font-bold text-[#ff7836]">EXECUTION PIPELINE</span>
                <span className="text-emerald-400">LATENCY: 1.8s</span>
              </div>

              {/* Node Graph Mockup */}
              <div className="my-auto py-2 flex items-center justify-between gap-2 relative z-10 text-[11px]">
                {/* Node 1: Voice */}
                <div className="flex-1 bg-stone-900 border border-stone-700 rounded p-2 text-center">
                  <div className="text-[9px] text-[#ff7836] font-bold uppercase">WhatsApp</div>
                  <div className="font-bold text-white text-[10px] truncate">Voice Memo</div>
                  <div className="text-[9px] text-stone-500">"Book ride &amp; site"</div>
                </div>

                <div className="text-stone-600 font-bold">→</div>

                {/* Node 2: Computer Engine */}
                <div className="flex-1 bg-stone-900 border border-[#ff5100]/40 rounded p-2 text-center shadow-[0_0_10px_rgba(255,81,0,0.15)]">
                  <div className="text-[9px] text-emerald-400 font-bold uppercase">Local Engine</div>
                  <div className="font-bold text-stone-100 text-[10px] truncate">Weave Daemon</div>
                  <div className="text-[9px] text-stone-400">Cab / Hotel / Web</div>
                </div>

                <div className="text-stone-600 font-bold">→</div>

                {/* Node 3: Result */}
                <div className="flex-1 bg-emerald-950/40 border border-emerald-500/40 rounded p-2 text-center">
                  <div className="text-[9px] text-emerald-400 font-bold uppercase">Confirmed</div>
                  <div className="font-bold text-emerald-200 text-[10px] truncate">100% Passed</div>
                  <div className="text-[9px] text-emerald-400">Sent to Phone ✓</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-stone-400 pt-2 border-t border-stone-800 relative z-10">
                <span className="text-stone-500">Target: Local PC Runtime</span>
                <span className="text-emerald-400 font-bold">0 Cloud Leaks</span>
              </div>
            </div>
          </div>

          {/* Right Column: Voice Player & Actions */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#ff5100]/10 px-2 py-0.5 text-[10px] font-bold text-[#ff5100] tracking-wider uppercase font-mono">
                LOCAL MCP HARNESS
              </span>
              <span className="text-xs text-[#a16245] font-mono">• 1.8s diff latency</span>
            </div>

            {/* Voice Player Bar */}
            <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono">
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleAudio}
                  className="size-9 rounded-full bg-[#ff5100] hover:bg-[#e04500] text-white flex items-center justify-center shrink-0 shadow-sm transition-all active:scale-95 cursor-pointer"
                  title={isPlayingAudio ? 'Pause Voice Note' : 'Play Voice Note'}
                >
                  {isPlayingAudio ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
                </button>

                <div className="flex flex-col">
                  <div className="text-xs font-bold text-[#1d110c] flex items-center gap-1.5">
                    <Mic className="size-3 text-[#ff5100]" />
                    <span>Voice Input: "Book me a cab and build a coffee shop website"</span>
                  </div>
                  <span className="text-[10px] text-obsidian-muted">
                    {isPlayingAudio ? `Processing voice note... (${Math.round((audioProgress / 100) * 4)}s / 4s)` : 'Audio recorded via WhatsApp (3.4s)'}
                  </span>
                </div>
              </div>

              {/* Animated Waveform Bars */}
              <div className="flex items-center gap-1 self-center sm:self-auto h-6 px-2">
                {[12, 24, 18, 30, 15, 28, 20, 32, 16, 22, 28, 14, 26, 18, 10].map((h, i) => (
                  <span
                    key={i}
                    className={`w-1 rounded-full transition-all duration-150 ${
                      isPlayingAudio ? 'bg-[#ff5100]' : 'bg-[#d3cec2]'
                    }`}
                    style={{
                      height: isPlayingAudio ? `${Math.max(6, (h * ((i % 3) + 1) * (audioProgress % 20 + 5)) / 25)}px` : `${h / 2}px`
                    }}
                  ></span>
                ))}
              </div>
            </div>

            <p className="text-xs sm:text-sm font-sans text-[#59534E] leading-relaxed">
              Books cabs, finds hotel rooms, and generates websites right from your WhatsApp message in 1.8 seconds. Runs directly on your PC with zero intermediary cloud storage.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#f4ebe6]">
              <div className="flex items-center gap-3 text-[11px] font-mono text-[#a16245]">
                <span className="flex items-center gap-1 text-emerald-800 font-bold">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  STATUS: VALIDATED
                </span>
                <span>•</span>
                <span>BRANCH: action/whatsapp-sync</span>
              </div>

              <button
                onClick={onOpenDiff}
                className="flex items-center gap-1.5 h-8 px-4 rounded bg-[#ff5100] text-[#fcf9f8] text-xs font-bold font-mono uppercase tracking-wider hover:bg-[#e04500] transition-colors shadow-sm active:scale-98 cursor-pointer"
              >
                <Eye className="size-3.5" />
                <span>Inspect AST Diff</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
