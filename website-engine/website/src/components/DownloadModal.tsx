import { useState } from 'react';
import { X, Download, Apple, Monitor, Check, ShieldCheck } from 'lucide-react';
import confetti from 'canvas-confetti';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DownloadModal: React.FC<DownloadModalProps> = ({ isOpen, onClose }) => {
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [selectedOS, setSelectedOS] = useState<'mac' | 'windows'>('mac');

  if (!isOpen) return null;

  const triggerDownload = () => {
    setDownloadStarted(true);
    confetti({
      particleCount: 50,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#ff5100', '#128c7e', '#1d110c', '#f4ebe6']
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn font-sans">
      <div 
        className="w-full max-w-xl rounded-3xl border border-[#ead6cd] bg-[#fcf9f8] shadow-2xl flex flex-col overflow-hidden max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ead6cd] bg-[#f4ebe6]">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-[#ff5100] text-white flex items-center justify-center shadow-xs">
              <Download className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1d110c]">
                Download Weave Free
              </h3>
              <p className="text-xs text-[#59534E]">
                Personal AI on your computer • Works via WhatsApp
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="size-8 rounded-full flex items-center justify-center hover:bg-[#ead6cd] text-[#59534E] hover:text-[#1d110c] transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* OS Switcher */}
          <div className="flex rounded-2xl border border-[#ead6cd] bg-[#f4ebe6] p-1 text-sm font-bold">
            <button
              onClick={() => setSelectedOS('mac')}
              className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                selectedOS === 'mac'
                  ? 'bg-white text-[#1d110c] shadow-sm'
                  : 'text-[#59534E] hover:text-[#1d110c]'
              }`}
            >
              <Apple className="size-4" />
              <span>macOS (Mac)</span>
            </button>
            <button
              onClick={() => setSelectedOS('windows')}
              className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                selectedOS === 'windows'
                  ? 'bg-white text-[#1d110c] shadow-sm'
                  : 'text-[#59534E] hover:text-[#1d110c]'
              }`}
            >
              <Monitor className="size-4" />
              <span>Windows PC</span>
            </button>
          </div>

          {/* Download Buttons for Selected OS */}
          {selectedOS === 'mac' ? (
            <div className="space-y-3">
              <button
                onClick={() => triggerDownload()}
                className="w-full py-3.5 px-4 rounded-2xl bg-[#ff5100] text-white font-bold text-sm flex items-center justify-between hover:bg-[#e04500] active:scale-[0.98] shadow-sm transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Apple className="size-5" />
                  <span>Download for Apple Silicon (M1/M2/M3/M4)</span>
                </div>
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">v2.3 .dmg</span>
              </button>

              <button
                onClick={() => triggerDownload()}
                className="w-full py-3 px-4 rounded-2xl border border-[#ead6cd] bg-white text-[#1d110c] font-semibold text-xs flex items-center justify-between hover:bg-[#f4ebe6] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Apple className="size-4" />
                  <span>Download for Intel Mac</span>
                </div>
                <span className="text-xs text-[#59534E]">Legacy .dmg</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => triggerDownload()}
                className="w-full py-3.5 px-4 rounded-2xl bg-[#ff5100] text-white font-bold text-sm flex items-center justify-between hover:bg-[#e04500] active:scale-[0.98] shadow-sm transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Monitor className="size-5" />
                  <span>Download for Windows (64-bit Installer)</span>
                </div>
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">v2.3 .exe</span>
              </button>
            </div>
          )}

          {downloadStarted && (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-900 flex items-center gap-2 font-medium animate-fadeIn">
              <Check className="size-4 text-emerald-600 shrink-0 stroke-[3]" />
              <span>Your download has started! Open the installer once finished.</span>
            </div>
          )}

          {/* 3 Step Visual Preview */}
          <div className="space-y-3 pt-2 border-t border-[#ead6cd]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#1d110c]">
              How you'll connect in 2 minutes:
            </h4>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-xl bg-[#f4ebe6] border border-[#ead6cd] space-y-1">
                <div className="size-7 mx-auto rounded-full bg-[#ff5100] text-white flex items-center justify-center font-bold text-xs">
                  1
                </div>
                <div className="text-xs font-bold text-[#1d110c]">Open Weave</div>
                <div className="text-[10px] text-[#59534E]">On your PC</div>
              </div>

              <div className="p-3 rounded-xl bg-[#f4ebe6] border border-[#ead6cd] space-y-1">
                <div className="size-7 mx-auto rounded-full bg-[#ff5100] text-white flex items-center justify-center font-bold text-xs">
                  2
                </div>
                <div className="text-xs font-bold text-[#1d110c]">Scan QR Code</div>
                <div className="text-[10px] text-[#59534E]">With WhatsApp</div>
              </div>

              <div className="p-3 rounded-xl bg-[#f4ebe6] border border-[#ead6cd] space-y-1">
                <div className="size-7 mx-auto rounded-full bg-[#ff5100] text-white flex items-center justify-center font-bold text-xs">
                  3
                </div>
                <div className="text-xs font-bold text-[#1d110c]">Ask Anything!</div>
                <div className="text-[10px] text-[#59534E]">Text or voice</div>
              </div>
            </div>
          </div>

          {/* Privacy Guarantee */}
          <div className="flex items-center gap-2 rounded-xl bg-[#f4ebe6] p-3 text-xs text-[#59534E]">
            <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
            <span>100% private. Weave runs on your computer. Your chats never touch any cloud servers.</span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#ead6cd] bg-[#f4ebe6]">
          <span className="text-xs text-[#59534E]">
            Free &amp; Open Source
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#1d110c] text-white text-xs font-bold hover:bg-stone-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
