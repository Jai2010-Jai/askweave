import { useState } from 'react';
import { Cpu, Send, Check, Play, Smartphone, Laptop } from 'lucide-react';

export const ExecutionMatrixSection: React.FC = () => {
  const [activePhase, setActivePhase] = useState(0);

  const phases = [
    {
      phaseNumber: 'PHASE 01',
      title: 'Voice Relay',
      fullTitle: 'Send a WhatsApp Voice Note or Text',
      description: 'Audio ingestion via secure WhatsApp socket connection.',
      subtext: 'Speak naturally from anywhere in the world. Weave receives your WhatsApp message over an encrypted direct socket.',
      visualType: 'whatsapp-inbound'
    },
    {
      phaseNumber: 'PHASE 02',
      title: 'AST Compilation',
      fullTitle: 'Deterministic Tree Traversal & Execution',
      description: 'Deterministic tree traversal and patch synthesis.',
      subtext: 'Checks rides, finds hotels, or writes full website code without hallucinating or making unwanted edits.',
      visualType: 'ast-diff'
    },
    {
      phaseNumber: 'PHASE 03',
      title: 'Sandbox Verification',
      fullTitle: 'Headless Sandbox Verification',
      description: 'Headless Playwright run with zero host footprint.',
      subtext: 'Tests the changes, confirms fares and room availability, and captures a high-resolution preview screenshot.',
      visualType: 'test-runner'
    },
    {
      phaseNumber: 'PHASE 04',
      title: 'Signed Commit',
      fullTitle: 'Confirmation & Direct WhatsApp Reply',
      description: 'GPG signed push direct to remote target branch.',
      subtext: 'Preview screenshot and confirmation sent straight back to your WhatsApp chat with one-tap approval.',
      visualType: 'whatsapp-outbound'
    }
  ];

  return (
    <section className="flex flex-col gap-6" id="matrix">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold tracking-widest uppercase text-[#ff5100]">
            DEVICE MESH
          </span>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-[#1d110c]">
            Execution Matrix
          </h2>
          <p className="text-xs sm:text-sm font-sans text-[#59534E]">
            WhatsApp trigger to production artifact lifecycle.
          </p>
        </div>

        {/* Phase pills */}
        <div className="flex items-center gap-1.5 bg-[#f4ebe6] p-1 rounded border border-[#ead6cd] font-mono text-[10px]">
          {phases.map((_, i) => (
            <button
              key={i}
              onClick={() => setActivePhase(i)}
              className={`px-2.5 py-1 rounded transition-colors font-bold cursor-pointer ${
                activePhase === i
                  ? 'bg-[#ff5100] text-white shadow-sm'
                  : 'text-obsidian-muted hover:text-[#1d110c]'
              }`}
            >
              Step 0{i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* 4 Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {phases.map((phase, idx) => {
          const isActive = activePhase === idx;
          return (
            <div
              key={idx}
              onClick={() => setActivePhase(idx)}
              className={`flex flex-col rounded border overflow-hidden cursor-pointer transition-all duration-200 ${
                isActive
                  ? 'border-[#ff5100] bg-[#fbf9f5] shadow-md ring-2 ring-[#ff5100]/20 scale-[1.01]'
                  : 'border-[#ead6cd] bg-[#fcf9f8] hover:border-[#d3cec2] hover:shadow-sm'
              }`}
            >
              {/* Visual Mockup Card */}
              <div className="aspect-[4/3] w-full bg-[#181311] border-b border-[#ead6cd] p-3 flex flex-col justify-between text-stone-200 font-mono text-[10px] relative overflow-hidden select-none">
                {phase.visualType === 'whatsapp-inbound' && (
                  <div className="h-full flex flex-col justify-between py-1">
                    <div className="flex items-center justify-between text-stone-400 border-b border-stone-800 pb-1 text-[9px]">
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <Smartphone className="size-3" /> WhatsApp
                      </span>
                      <span>14:22 PM</span>
                    </div>

                    <div className="bg-[#1f2c34] rounded-lg p-2.5 my-auto border border-emerald-900/40 space-y-1.5 shadow-md">
                      <div className="flex items-center gap-2">
                        <div className="size-6 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                          <Play className="size-3 ml-0.5" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="h-1 bg-emerald-500 rounded w-4/5"></div>
                          <div className="flex justify-between text-[8px] text-stone-400">
                            <span>0:04</span>
                            <span className="text-emerald-400">✓✓ Delivered</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-[9px] text-stone-300 font-sans italic border-t border-stone-700/60 pt-1">
                        "Book me a cab and build a coffee shop site"
                      </div>
                    </div>

                    <div className="text-[8px] text-stone-500 text-right">Encrypted Noise Protocol</div>
                  </div>
                )}

                {phase.visualType === 'ast-diff' && (
                  <div className="h-full flex flex-col justify-between py-1">
                    <div className="flex items-center justify-between text-stone-400 border-b border-stone-800 pb-1 text-[9px]">
                      <span className="text-[#ff7836] font-bold flex items-center gap-1">
                        <Cpu className="size-3" /> AST Compiler
                      </span>
                      <span className="text-emerald-400">0.3s</span>
                    </div>

                    <div className="bg-stone-900 rounded p-2 my-auto border border-stone-800 space-y-1 text-[9px] font-mono leading-tight">
                      <div className="text-stone-400">sites/dailyroast/index.html</div>
                      <div className="text-rose-400 bg-rose-950/40 px-1 py-0.5 rounded-sm line-through">
                        - &lt;div class="placeholder"&gt;
                      </div>
                      <div className="text-emerald-400 bg-emerald-950/40 px-1 py-0.5 rounded-sm">
                        + &lt;section menu="specialty-brews"&gt;
                      </div>
                      <div className="text-stone-500 text-[8px]">+ &lt;UberX eta="8min" fare="$24.50"&gt;</div>
                    </div>

                    <div className="text-[8px] text-emerald-400 text-right">Deterministic Grammar Valid</div>
                  </div>
                )}

                {phase.visualType === 'test-runner' && (
                  <div className="h-full flex flex-col justify-between py-1">
                    <div className="flex items-center justify-between text-stone-400 border-b border-stone-800 pb-1 text-[9px]">
                      <span className="text-cyan-400 font-bold flex items-center gap-1">
                        <Laptop className="size-3" /> Sandbox Test
                      </span>
                      <span className="text-emerald-400">PASS</span>
                    </div>

                    <div className="bg-stone-900 rounded p-2 my-auto border border-stone-800 space-y-1 text-[9px] font-mono">
                      <div className="flex items-center gap-1 text-emerald-400">
                        <Check className="size-3" /> <span>ride-fare-check.spec.ts</span>
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400">
                        <Check className="size-3" /> <span>hotel-availability.spec.ts</span>
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400">
                        <Check className="size-3" /> <span>site-responsive.spec.ts</span>
                      </div>
                      <div className="text-[8px] text-stone-400 pt-0.5">12 assertions in 410ms</div>
                    </div>

                    <div className="text-[8px] text-stone-500 text-right">Isolated Host Sandbox</div>
                  </div>
                )}

                {phase.visualType === 'whatsapp-outbound' && (
                  <div className="h-full flex flex-col justify-between py-1">
                    <div className="flex items-center justify-between text-stone-400 border-b border-stone-800 pb-1 text-[9px]">
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <Send className="size-3" /> WhatsApp Reply
                      </span>
                      <span>Instant</span>
                    </div>

                    <div className="bg-[#1f2c34] rounded-lg p-2 my-auto border border-emerald-900/40 space-y-1 shadow-md">
                      <div className="bg-stone-800 rounded p-1.5 border border-stone-700 flex items-center justify-center">
                        <div className="text-[8px] text-stone-300 font-sans flex items-center gap-1">
                          <span className="size-1.5 rounded-full bg-emerald-400"></span>
                          <span>[Preview: UberX $24.50 + Live Website]</span>
                        </div>
                      </div>
                      <div className="text-[8px] text-stone-300 font-sans">
                        "Done! Ride confirmed, site published to dailyroast.pages.dev"
                      </div>
                    </div>

                    <div className="text-[8px] text-emerald-400 text-right">Zero Cloud Storage</div>
                  </div>
                )}
              </div>

              {/* Card Meta Content */}
              <div className="p-4 flex flex-col gap-1.5 flex-1 justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold tracking-widest text-[#a16245] font-mono">
                      {phase.phaseNumber}
                    </span>
                    {isActive && (
                      <span className="size-1.5 rounded-full bg-[#ff5100]"></span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold uppercase text-[#1d110c] font-mono mt-0.5">
                    {phase.title}
                  </h4>
                  <p className="text-xs font-sans text-[#59534E] mt-1 leading-normal">
                    {phase.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-[#f4ebe6] text-[10px] font-mono text-[#a16245]">
                  {phase.fullTitle}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Active Phase Callout Banner */}
      <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs">
        <div className="flex items-center gap-3">
          <div className="size-7 rounded bg-[#ff5100] text-white flex items-center justify-center font-bold text-xs shrink-0">
            0{activePhase + 1}
          </div>
          <div>
            <span className="font-bold text-[#1d110c]">{phases[activePhase].fullTitle}: </span>
            <span className="text-obsidian-muted font-sans text-xs">{phases[activePhase].subtext}</span>
          </div>
        </div>

        <button
          onClick={() => setActivePhase((prev) => (prev + 1) % phases.length)}
          className="self-end sm:self-auto px-3 py-1 rounded border border-[#ead6cd] bg-[#fcf9f8] hover:bg-[#f4ebe6] text-[11px] font-bold text-[#ff5100] transition-colors shrink-0 cursor-pointer"
        >
          Next Step →
        </button>
      </div>
    </section>
  );
};
