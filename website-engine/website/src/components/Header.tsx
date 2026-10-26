import React, { useState } from 'react';
import { Menu, X, Download } from 'lucide-react';

interface HeaderProps {
  onOpenInstall: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenInstall }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="flex items-center justify-between whitespace-nowrap border-b border-[#ead6cd]/70 pb-4 pt-3 font-sans">
      <div className="flex items-center gap-3">
        <a href="#" className="flex items-center gap-2 group">
          <div className="size-6 rounded-full bg-[#ff5100] flex items-center justify-center text-white font-black text-xs shadow-xs">
            W
          </div>
          <span className="text-lg font-bold tracking-tight text-[#1d110c] group-hover:text-[#ff5100] transition-colors">
            weave
          </span>
        </a>
      </div>

      <div className="flex items-center gap-6">
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#59534E]">
          <a className="hover:text-[#1d110c] transition-colors" href="#what-it-does">
            What it can do
          </a>
          <a className="hover:text-[#1d110c] transition-colors" href="#how-it-works">
            How it works
          </a>
          <a className="hover:text-[#1d110c] transition-colors" href="#privacy">
            Privacy & Trust
          </a>
          <a className="hover:text-[#1d110c] transition-colors" href="#faq">
            FAQ
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenInstall}
            className="flex h-9 items-center justify-center gap-1.5 rounded-full bg-[#ff5100] px-4 text-xs font-semibold text-white hover:bg-[#e04500] shadow-sm hover:shadow transition-all cursor-pointer"
          >
            <Download className="size-3.5" />
            <span>Download Free</span>
          </button>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1.5 rounded-lg text-[#1d110c] hover:bg-[#f4ebe6]"
            aria-label="Toggle Menu"
          >
            {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="absolute top-16 left-4 right-4 z-40 bg-white border border-[#ead6cd] rounded-2xl p-4 shadow-xl flex flex-col gap-2 md:hidden text-sm font-medium text-[#1d110c]">
          <a onClick={() => setMobileMenuOpen(false)} className="p-2.5 hover:bg-[#f4ebe6] rounded-xl" href="#what-it-does">What it can do</a>
          <a onClick={() => setMobileMenuOpen(false)} className="p-2.5 hover:bg-[#f4ebe6] rounded-xl" href="#how-it-works">How it works</a>
          <a onClick={() => setMobileMenuOpen(false)} className="p-2.5 hover:bg-[#f4ebe6] rounded-xl" href="#privacy">Privacy & Trust</a>
          <a onClick={() => setMobileMenuOpen(false)} className="p-2.5 hover:bg-[#f4ebe6] rounded-xl" href="#faq">FAQ</a>
        </div>
      )}
    </header>
  );
};
