import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import { TerminalSimulator } from './TerminalSimulator';

interface HeroProps {
  onOpenInstall: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onOpenInstall }) => {
  const [copied, setCopied] = useState(false);
  const commandText = 'npm i -g weave-agent';

  const handleCopy = () => {
    navigator.clipboard.writeText(commandText);
    setCopied(true);
    confetti({
      particleCount: 35,
      spread: 50,
      origin: { y: 0.7 },
      colors: ['#ff5100', '#1d110c', '#f4ebe6']
    });
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center pt-4">
      {/* Left Column: Plain Simple Messaging */}
      <div className="lg:col-span-6 flex flex-col gap-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[#f4ebe6] border border-[#ead6cd] w-fit">
          <span className="size-2 rounded-full bg-[#ff5100] animate-pulse"></span>
          <span className="text-[11px] font-bold tracking-widest uppercase text-[#a16245]">
            DAEMON 2.3 // ZERO-CLOUD RELAY
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-[1.08] tracking-[-0.04em] text-[#1d110c]">
            Book cabs, reserve hotels, and build websites—all from WhatsApp.
          </h1>
          <p className="text-xs sm:text-sm leading-relaxed text-[#59534E] font-sans font-normal max-w-[520px]">
            No complicated terminal commands or cloud logins. Send a voice note or text on WhatsApp, and Weave books your ride, finds your stay, and creates your website right on your computer. 100% private.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={onOpenInstall}
            className="flex h-11 items-center justify-center rounded bg-[#ff5100] px-5 text-xs font-bold uppercase tracking-widest text-[#fcf9f8] hover:bg-[#e04500] shadow-sm transition-all cursor-pointer"
          >
            <span>Download Binary</span>
          </button>

          <div className="relative group">
            <button
              onClick={handleCopy}
              className="flex h-11 items-center justify-center rounded border border-[#ead6cd] bg-[#fcf9f8] px-4 text-xs font-semibold text-[#1d110c] hover:bg-[#f4ebe6] transition-all font-mono cursor-pointer"
            >
              <span className="text-[#ff5100] mr-2 font-bold">$</span>
              <span>npm i -g weave-agent</span>
              <span className="ml-2 text-obsidian-muted group-hover:text-[#ff5100]">
                {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              </span>
            </button>

            {copied && (
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#181311] text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded shadow-lg animate-fadeIn whitespace-nowrap">
                ✓ Copied to clipboard
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6 pt-2 border-t border-[#f4ebe6] text-[11px] text-[#59534E]">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-[#ff5100]">bolt</span>
            <span>Sub-200ms cold start</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-[#ff5100]">lock</span>
            <span>Zero cloud leaks</span>
          </div>
        </div>
      </div>

      {/* Right Column: Exact Stitch Terminal Simulator */}
      <div className="lg:col-span-6 relative">
        <TerminalSimulator />
      </div>
    </section>
  );
};
