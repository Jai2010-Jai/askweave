import React from 'react';

interface FooterProps {
  onOpenInstall: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenInstall }) => {
  return (
    <footer className="flex flex-col sm:flex-row items-center justify-between border-t border-[#ead6cd]/70 py-10 text-sm text-[#59534E] gap-4 font-sans max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-2">
        <span className="font-bold text-[#1d110c]">weave</span>
        <span>•</span>
        <span>Your Personal Assistant on WhatsApp</span>
      </div>
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <button
          onClick={onOpenInstall}
          className="hover:text-[#ff5100] transition-colors cursor-pointer"
        >
          Download Free
        </button>
        <a
          href="#privacy"
          className="hover:text-[#ff5100] transition-colors cursor-pointer"
        >
          Privacy
        </a>
        <a
          href="https://github.com/tinchu/weave"
          target="_blank"
          rel="noreferrer"
          className="hover:text-[#ff5100] transition-colors cursor-pointer"
        >
          GitHub
        </a>
        <a
          href="#faq"
          className="hover:text-[#ff5100] transition-colors cursor-pointer"
        >
          FAQ
        </a>
      </div>
    </footer>
  );
};
