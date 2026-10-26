import React, { useState } from 'react';
import { X, Copy, Check, Download, ShieldCheck } from 'lucide-react';
import confetti from 'canvas-confetti';

interface InstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallModal: React.FC<InstallModalProps> = ({ isOpen, onClose }) => {
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'npm' | 'binary' | 'homebrew'>('npm');

  if (!isOpen) return null;

  const handleCopy = (text: string, tab: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    confetti({
      particleCount: 40,
      spread: 60,
      origin: { y: 0.8 },
      colors: ['#ff5100', '#e04500', '#f4ebe6', '#1d110c']
    });
    setTimeout(() => setCopiedTab(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-obsidian-dark/70 backdrop-blur-sm animate-fadeIn">
      <div 
        className="w-full max-w-2xl rounded-xl border border-border-strong bg-[#fcf9f8] shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ead6cd] bg-[#f4ebe6]/70">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded bg-[#ff5100] text-white flex items-center justify-center">
              <Download className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-mono tracking-tight text-[#1d110c]">
                GET WEAVE DAEMON // v2.3
              </h3>
              <p className="text-xs text-obsidian-muted font-sans">
                Install on your local computer in under 30 seconds
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded flex items-center justify-center hover:bg-[#ead6cd] text-obsidian-muted hover:text-[#1d110c] transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Method selector */}
          <div className="flex rounded border border-[#ead6cd] bg-[#fbf9f5] p-1 text-xs font-mono">
            <button
              onClick={() => setSelectedMethod('npm')}
              className={`flex-1 py-1.5 rounded text-center font-bold transition-all ${
                selectedMethod === 'npm' ? 'bg-[#ff5100] text-white shadow-sm' : 'text-obsidian-muted hover:text-[#1d110c]'
              }`}
            >
              npm / pnpm
            </button>
            <button
              onClick={() => setSelectedMethod('homebrew')}
              className={`flex-1 py-1.5 rounded text-center font-bold transition-all ${
                selectedMethod === 'homebrew' ? 'bg-[#ff5100] text-white shadow-sm' : 'text-obsidian-muted hover:text-[#1d110c]'
              }`}
            >
              Homebrew (macOS)
            </button>
            <button
              onClick={() => setSelectedMethod('binary')}
              className={`flex-1 py-1.5 rounded text-center font-bold transition-all ${
                selectedMethod === 'binary' ? 'bg-[#ff5100] text-white shadow-sm' : 'text-obsidian-muted hover:text-[#1d110c]'
              }`}
            >
              Direct Binary (Curl)
            </button>
          </div>

          {/* Command display */}
          <div className="rounded border border-[#ead6cd] bg-[#181311] p-4 text-[#f3f1eb] font-mono text-xs flex items-center justify-between gap-3">
            <div className="truncate">
              <span className="text-[#ff5100] mr-2 select-none">$</span>
              {selectedMethod === 'npm' && 'npm install -g weave-agent'}
              {selectedMethod === 'homebrew' && 'brew install tinchu/tap/weave-daemon'}
              {selectedMethod === 'binary' && 'curl -fsSL https://get.weave.sh | sh'}
            </div>
            <button
              onClick={() => {
                const cmd = selectedMethod === 'npm' 
                  ? 'npm install -g weave-agent' 
                  : selectedMethod === 'homebrew' 
                  ? 'brew install tinchu/tap/weave-daemon' 
                  : 'curl -fsSL https://get.weave.sh | sh';
                handleCopy(cmd, selectedMethod);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-stone-800 hover:bg-stone-700 text-white text-xs font-mono transition-colors shrink-0"
            >
              {copiedTab === selectedMethod ? (
                <>
                  <Check className="size-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-bold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5 text-[#ff5100]" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* 3 Step Quickstart Guide */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#1d110c] font-mono">
              Simple 3-Step Setup
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3 space-y-1">
                <div className="size-6 rounded-full bg-[#ff5100]/10 text-[#ff5100] flex items-center justify-center font-bold text-xs font-mono">
                  1
                </div>
                <div className="text-xs font-bold text-[#1d110c] font-mono">Install Daemon</div>
                <p className="text-[11px] text-[#59534E] font-sans">Run the install command in your terminal.</p>
              </div>

              <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3 space-y-1">
                <div className="size-6 rounded-full bg-[#ff5100]/10 text-[#ff5100] flex items-center justify-center font-bold text-xs font-mono">
                  2
                </div>
                <div className="text-xs font-bold text-[#1d110c] font-mono">Pair WhatsApp</div>
                <p className="text-[11px] text-[#59534E] font-sans">Run `weave start` and scan the terminal QR code from WhatsApp.</p>
              </div>

              <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3 space-y-1">
                <div className="size-6 rounded-full bg-[#ff5100]/10 text-[#ff5100] flex items-center justify-center font-bold text-xs font-mono">
                  3
                </div>
                <div className="text-xs font-bold text-[#1d110c] font-mono">Send Message</div>
                <p className="text-[11px] text-[#59534E] font-sans">Send any voice note or text to start editing code instantly.</p>
              </div>
            </div>
          </div>

          {/* Privacy Note */}
          <div className="flex items-center gap-2 rounded bg-emerald-50 border border-emerald-200 p-3 text-[11px] text-emerald-900 font-sans">
            <ShieldCheck className="size-4 text-emerald-700 shrink-0" />
            <span>Zero telemetry or third-party server relays. Your WhatsApp pairing keys remain encrypted on your physical machine.</span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#ead6cd] bg-[#f4ebe6]/70">
          <span className="text-[11px] font-mono text-obsidian-muted">
            Free &amp; Open Source (Apache 2.0)
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-[#ff5100] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#e04500] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
