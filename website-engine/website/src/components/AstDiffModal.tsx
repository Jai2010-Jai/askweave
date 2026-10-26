import React, { useState } from 'react';
import { X, Copy, Check, GitCommit, FileCode } from 'lucide-react';

interface AstDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AstDiffModal: React.FC<AstDiffModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');

  if (!isOpen) return null;

  const diffLines = [
    { type: 'context', oldLine: 18, newLine: 18, text: ' <header className="sticky top-0 z-50 w-full backdrop-blur">' },
    { type: 'context', oldLine: 19, newLine: 19, text: '   <div className="max-w-7xl mx-auto px-4 sm:px-6">' },
    { type: 'delete',  oldLine: 20, newLine: null, text: '-    <div className="flex items-center justify-between min-w-max">' },
    { type: 'add',     oldLine: null, newLine: 20, text: '+    <div className="flex items-center justify-between w-full overflow-x-hidden">' },
    { type: 'delete',  oldLine: 21, newLine: null, text: '-      <nav className="flex items-center space-x-8">' },
    { type: 'add',     oldLine: null, newLine: 21, text: '+      <nav className="hidden md:flex items-center space-x-6 shrink-0">' },
    { type: 'context', oldLine: 22, newLine: 22, text: '         <a href="#features">Features</a>' },
    { type: 'context', oldLine: 23, newLine: 23, text: '         <a href="#pipeline">AST Pipeline</a>' },
    { type: 'context', oldLine: 24, newLine: 24, text: '       </nav>' },
    { type: 'add',     oldLine: null, newLine: 25, text: '+      <button aria-label="Toggle menu" className="md:hidden p-2 text-primary">' },
    { type: 'add',     oldLine: null, newLine: 26, text: '+        <MenuIcon className="size-5" />' },
    { type: 'add',     oldLine: null, newLine: 27, text: '+      </button>' },
    { type: 'context', oldLine: 25, newLine: 28, text: '     </div>' },
    { type: 'context', oldLine: 26, newLine: 29, text: '   </div>' },
    { type: 'context', oldLine: 27, newLine: 30, text: ' </header>' },
  ];

  const handleCopy = () => {
    const rawDiff = diffLines.map(l => l.text).join('\n');
    navigator.clipboard.writeText(rawDiff);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-obsidian-dark/70 backdrop-blur-sm animate-fadeIn">
      <div 
        className="w-full max-w-3xl rounded-xl border border-border-strong bg-[#fcf9f8] shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#ead6cd] bg-[#f4ebe6]/50">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded bg-[#ff5100]/10 flex items-center justify-center text-primary">
              <FileCode className="size-4 text-[#ff5100]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold font-mono tracking-wider text-[#1d110c]">AST SYNTAX DIFF</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 font-mono">
                  AST VALIDATED
                </span>
              </div>
              <p className="text-[11px] text-obsidian-muted font-mono">
                src/components/Header.tsx • target branch: patch/nav-fix
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex rounded border border-[#ead6cd] bg-[#fcf9f8] p-0.5 text-[10px] font-mono">
              <button
                onClick={() => setViewMode('unified')}
                className={`px-2 py-1 rounded transition-colors ${viewMode === 'unified' ? 'bg-[#ff5100] text-white font-bold' : 'text-obsidian-muted hover:text-[#1d110c]'}`}
              >
                Unified
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`px-2 py-1 rounded transition-colors ${viewMode === 'split' ? 'bg-[#ff5100] text-white font-bold' : 'text-obsidian-muted hover:text-[#1d110c]'}`}
              >
                Split
              </button>
            </div>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-3 py-1.5 rounded border border-[#ead6cd] bg-[#fcf9f8] text-xs font-mono font-semibold text-[#1d110c] hover:bg-[#f4ebe6] transition-colors"
            >
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5 text-[#ff5100]" />}
              <span>{copied ? 'Copied' : 'Copy Patch'}</span>
            </button>

            <button
              onClick={onClose}
              className="size-8 rounded flex items-center justify-center hover:bg-[#ead6cd] text-obsidian-muted hover:text-[#1d110c] transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Diff summary stats */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-[#fbf9f5] border-b border-[#ead6cd] text-[11px] font-mono text-obsidian-muted">
          <div className="flex items-center gap-4">
            <span className="text-emerald-700 font-semibold">+4 lines added</span>
            <span className="text-rose-700 font-semibold">-2 lines removed</span>
            <span>AST tree node: JSXElement &gt; HeaderContainer</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#a16245]">
            <GitCommit className="size-3.5" />
            <span>hash: e4b91f0</span>
          </div>
        </div>

        {/* Diff Body */}
        <div className="overflow-auto font-mono text-xs p-3 bg-[#181311] text-[#f3f1eb]">
          <div className="space-y-0.5">
            {diffLines.map((line, idx) => {
              const isAdd = line.type === 'add';
              const isDel = line.type === 'delete';
              return (
                <div
                  key={idx}
                  className={`flex items-start px-2 py-0.5 rounded-sm font-mono text-[11px] leading-relaxed transition-colors ${
                    isAdd
                      ? 'bg-emerald-950/60 text-emerald-300 border-l-2 border-emerald-500'
                      : isDel
                      ? 'bg-rose-950/60 text-rose-300 border-l-2 border-rose-500'
                      : 'text-stone-300 hover:bg-stone-800/40'
                  }`}
                >
                  <span className="w-8 text-right select-none opacity-40 pr-2">
                    {line.oldLine ?? ' '}
                  </span>
                  <span className="w-8 text-right select-none opacity-40 pr-3">
                    {line.newLine ?? ' '}
                  </span>
                  <span className="w-4 select-none font-bold text-center">
                    {isAdd ? '+' : isDel ? '-' : ' '}
                  </span>
                  <span className="flex-1 whitespace-pre">{line.text.replace(/^[+-]/, '')}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Verification Footer Banner */}
        <div className="px-5 py-3 border-t border-[#ead6cd] bg-[#f4ebe6] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2 text-[#1d110c]">
            <span className="size-2 rounded-full bg-emerald-500"></span>
            <span>Headless sandbox test passed (12/12 test assertions)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-[#ff5100] hover:bg-[#e04500] text-white font-bold uppercase tracking-wider text-[11px] transition-colors"
            >
              Close Diff
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
