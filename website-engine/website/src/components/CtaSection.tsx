import { Check, Sparkles, Apple, Monitor } from 'lucide-react';
import confetti from 'canvas-confetti';

interface CtaSectionProps {
  onOpenDownload: () => void;
}

export const CtaSection: React.FC<CtaSectionProps> = ({ onOpenDownload }) => {
  const handleDownload = () => {
    confetti({
      particleCount: 50,
      spread: 70,
      origin: { y: 0.8 },
      colors: ['#ff5100', '#128c7e', '#f4ebe6']
    });
    onOpenDownload();
  };

  return (
    <section className="my-6 rounded-3xl border border-[#ead6cd] bg-gradient-to-br from-[#f4ebe6] to-[#fcf9f8] p-8 sm:p-12 text-center flex flex-col items-center gap-6 shadow-sm font-sans">
      <div className="size-14 rounded-2xl bg-[#ff5100] text-white flex items-center justify-center shadow-md">
        <Sparkles className="size-7" />
      </div>

      <div className="flex flex-col gap-3 max-w-xl">
        <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-[#1d110c]">
          Ready to let your computer work for you?
        </h2>
        <p className="text-sm sm:text-base text-[#59534E] leading-relaxed">
          Download Weave for free, scan the QR code with WhatsApp, and send your first request in under 2 minutes.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
        <button
          onClick={handleDownload}
          className="flex h-13 items-center justify-center gap-2.5 rounded-2xl bg-[#ff5100] px-8 text-base font-bold text-white hover:bg-[#e04500] active:scale-[0.98] shadow-lg shadow-[#ff5100]/25 transition-all cursor-pointer"
        >
          <Apple className="size-5" />
          <span>Download for macOS</span>
        </button>

        <button
          onClick={handleDownload}
          className="flex h-13 items-center justify-center gap-2.5 rounded-2xl border-2 border-[#d3cec2] bg-white px-8 text-base font-bold text-[#1d110c] hover:bg-[#f4ebe6] active:scale-[0.98] transition-all cursor-pointer"
        >
          <Monitor className="size-5" />
          <span>Download for Windows</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-semibold text-[#59534E] pt-2">
        <span className="flex items-center gap-1.5 text-emerald-800">
          <Check className="size-4 text-emerald-600 stroke-[3]" /> Free Forever
        </span>
        <span>•</span>
        <span className="flex items-center gap-1.5 text-emerald-800">
          <Check className="size-4 text-emerald-600 stroke-[3]" /> No Credit Card Required
        </span>
        <span>•</span>
        <span className="flex items-center gap-1.5 text-emerald-800">
          <Check className="size-4 text-emerald-600 stroke-[3]" /> 100% Private on Your PC
        </span>
      </div>
    </section>
  );
};
