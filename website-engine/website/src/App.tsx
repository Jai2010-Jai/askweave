import React, { useState } from 'react';
import { ArrowRight, Download, X, QrCode, Laptop, Check } from 'lucide-react';
import confetti from 'canvas-confetti';

interface TaskReaction {
  id: string;
  label: string;
  emoji: string;
  detail: string;
}

const TASKS: TaskReaction[] = [
  {
    id: 'apps',
    label: 'spin up full-stack apps',
    emoji: '🚀',
    detail: 'Scaffolds complete frontend and backend applications from a single prompt'
  },
  {
    id: 'code',
    label: 'write or fix code',
    emoji: '💻',
    detail: 'Detects bugs, refactors syntax, and edits files across your entire repository'
  },
  {
    id: 'deploy',
    label: 'test and deploy projects',
    emoji: '⚡',
    detail: 'Runs automated test suites and deploys live preview and production builds'
  },
  {
    id: 'manage',
    label: 'manage repositories',
    emoji: '📂',
    detail: 'Handles git branches, tracks project milestones, and commits changes remotely'
  },
  {
    id: 'messages',
    label: 'draft messages that secure meetings',
    emoji: '🤝',
    detail: 'Polishes outreach, pitches, and emails to get appointments confirmed'
  }
];

export function App() {
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [downloadTab, setDownloadTab] = useState<'mac' | 'windows' | 'qr'>('mac');
  const [copiedCode, setCopiedCode] = useState(false);

  const openDownloadModal = () => {
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#ff5100', '#ffffff', '#34d399', '#f97316']
    });
    setIsModalOpen(true);
  };

  const copyQuickInstall = () => {
    navigator.clipboard.writeText('npm i -g weave-agent');
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const currentTask = TASKS.find(t => t.id === (hoveredTask || activeTask));

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex flex-col justify-between selection:bg-[#ff5100] selection:text-white px-6 sm:px-12 md:px-20 lg:px-28 py-10 sm:py-16 transition-colors duration-300 font-sans">
      
      {/* Top Header / Emblem */}
      <header className="w-full max-w-3xl mx-auto flex items-center justify-between pb-12 sm:pb-20">
        <a href="/" className="inline-flex items-center gap-3 group">
          {/* Weave custom woven companion emblem in dark mode */}
          <div className="relative size-10 rounded-full border border-[#27272a] bg-[#18181b] flex items-center justify-center shadow-xs group-hover:border-[#ff5100] group-hover:scale-105 transition-all">
            <svg
              className="size-5 text-white group-hover:text-[#ff5100] transition-colors"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4 21l3.5-.96A8.93 8.93 0 0 0 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z" />
              <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.5" />
            </svg>
            <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-[#ff5100] ring-2 ring-[#09090b]" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white group-hover:text-[#ff5100] transition-colors">
            weave
          </span>
        </a>

        <button
          onClick={openDownloadModal}
          className="text-sm font-medium text-[#a1a1aa] hover:text-[#ff5100] transition-colors flex items-center gap-1 cursor-pointer"
        >
          <span>Get Weave</span>
          <ArrowRight className="size-3.5" />
        </button>
      </header>

      {/* Main Editorial Body with White Text on Black */}
      <main className="w-full max-w-3xl mx-auto my-auto flex flex-col gap-8 sm:gap-10">
        
        {/* Core Big Statement */}
        <h1 className="text-2xl sm:text-4xl md:text-[2.65rem] font-bold leading-[1.28] tracking-[-0.02em] text-white">
          Send a WhatsApp message. Watch your computer take care of the rest.
        </h1>

        {/* Unique Weave Explanation */}
        <p className="text-lg sm:text-2xl font-normal leading-[1.55] text-[#a1a1aa]">
          Weave connects your computer directly to WhatsApp so you can get things done from anywhere. Speak or type naturally in chat, and your laptop handles the task in the background—privately, safely, and without needing your attention.
        </p>

        {/* Interactive Tasks with Popup Reactions */}
        <div className="relative text-lg sm:text-2xl font-normal leading-[1.7] text-[#d4d4d8]">
          <span>You can message it to </span>

          {TASKS.map((task, index) => {
            const isLast = index === TASKS.length - 1;
            const isPenultimate = index === TASKS.length - 2;
            const isHovered = hoveredTask === task.id || activeTask === task.id;

            return (
              <React.Fragment key={task.id}>
                <span
                  onMouseEnter={() => setHoveredTask(task.id)}
                  onMouseLeave={() => setHoveredTask(null)}
                  onClick={() => setActiveTask(activeTask === task.id ? null : task.id)}
                  className="relative inline cursor-pointer underline decoration-[#3f3f46] underline-offset-4 decoration-1 hover:decoration-[#ff5100] hover:text-white transition-all group select-none"
                ><span className={isHovered ? 'text-[#ff5100] font-medium' : ''}>{task.label}</span><span
                    className={`absolute -top-8 left-1/2 -translate-x-1/2 pointer-events-none transition-all duration-300 ease-out flex items-center justify-center ${
                      isHovered
                        ? 'opacity-100 -translate-y-2 scale-110'
                        : 'opacity-0 translate-y-1 scale-75'
                    }`}
                  ><span className="size-8 rounded-full bg-[#18181b] border border-[#27272a] shadow-lg flex items-center justify-center text-lg">{task.emoji}</span></span></span>{isPenultimate ? ', or ' : isLast ? '.' : ', '}
              </React.Fragment>
            );
          })}
        </div>

        {/* Dynamic Detail Pill when a task is hovered/tapped */}
        <div className="h-8 flex items-center">
          {currentTask ? (
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#18181b] border border-[#27272a] shadow-sm text-xs sm:text-sm text-[#d4d4d8] animate-fade-in">
              <span className="text-base">{currentTask.emoji}</span>
              <span>{currentTask.detail}</span>
            </div>
          ) : (
            <div className="text-xs sm:text-sm text-[#71717a]">
              Hover or tap any highlighted task above
            </div>
          )}
        </div>

        {/* Primary Call to Action Button (Crisp White on Black with Orange Hover) */}
        <div className="pt-2 sm:pt-4">
          <button
            onClick={openDownloadModal}
            className="group inline-flex items-center gap-3 px-6 py-3.5 rounded-full bg-white text-[#09090b] hover:bg-[#ff5100] hover:text-white text-base sm:text-lg font-semibold shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer active:scale-98"
          >
            <span>Download Weave</span>
            <ArrowRight className="size-4 sm:size-5 group-hover:translate-x-1 transition-transform" />
          </button>
          
          <div className="flex flex-wrap items-center gap-4 pt-3 text-xs sm:text-sm text-[#71717a]">
            <span>✓ 100% Free</span>
            <span>•</span>
            <span>✓ Runs privately on your laptop</span>
            <span>•</span>
            <span>✓ Pairs with WhatsApp in 1 scan</span>
          </div>
        </div>

      </main>

      {/* Minimal Editorial Footer */}
      <footer className="w-full max-w-3xl mx-auto pt-16 sm:pt-24 border-t border-[#27272a] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs sm:text-sm text-[#71717a]">
        <div>
          Copyright © 2026 Weave
        </div>

        <nav className="flex flex-wrap items-center gap-6">
          <button
            onClick={openDownloadModal}
            className="hover:text-white transition-colors cursor-pointer"
          >
            Download
          </button>
          <a
            href="https://github.com/tinchu/weave"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white transition-colors"
          >
            GitHub
          </a>
          <a
            href="mailto:hello@weave.run"
            className="hover:text-white transition-colors"
          >
            hello@weave.run
          </a>
        </nav>
      </footer>

      {/* Inverted 1-Click Download Modal (Dark Slate & Obsidian) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div
            className="relative w-full max-w-md bg-[#121214] rounded-3xl border border-[#27272a] p-6 sm:p-8 shadow-2xl flex flex-col gap-6 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 p-1.5 rounded-full text-[#71717a] hover:text-white hover:bg-[#27272a] transition-colors cursor-pointer"
            >
              <X className="size-5" />
            </button>

            {/* Modal Header */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#ff5100]" />
                <span className="text-xs font-semibold tracking-wider uppercase text-[#ff5100]">
                  Get Weave
                </span>
              </div>
              <h3 className="text-2xl font-bold tracking-tight text-white">
                Set up in 60 seconds
              </h3>
              <p className="text-sm text-[#a1a1aa]">
                Download Weave to your Mac or Windows PC, link your WhatsApp with a quick scan, and your assistant is ready to help.
              </p>
            </div>

            {/* Platform Selector Tabs */}
            <div className="flex rounded-xl bg-[#1c1c1f] p-1 text-xs font-medium">
              <button
                onClick={() => setDownloadTab('mac')}
                className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
                  downloadTab === 'mac'
                    ? 'bg-[#27272a] text-white shadow-xs font-semibold'
                    : 'text-[#a1a1aa] hover:text-white'
                }`}
              >
                macOS
              </button>
              <button
                onClick={() => setDownloadTab('windows')}
                className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
                  downloadTab === 'windows'
                    ? 'bg-[#27272a] text-white shadow-xs font-semibold'
                    : 'text-[#a1a1aa] hover:text-white'
                }`}
              >
                Windows
              </button>
              <button
                onClick={() => setDownloadTab('qr')}
                className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
                  downloadTab === 'qr'
                    ? 'bg-[#27272a] text-white shadow-xs font-semibold'
                    : 'text-[#a1a1aa] hover:text-white'
                }`}
              >
                Pair Phone
              </button>
            </div>

            {/* Tab Contents */}
            {downloadTab === 'mac' && (
              <div className="flex flex-col gap-3">
                <a
                  href="https://github.com/tinchu/weave/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-[#18181b] border border-[#27272a] hover:border-[#ff5100] hover:shadow-sm transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Laptop className="size-5 text-[#ff5100]" />
                    <div className="text-left">
                      <div className="text-sm font-semibold text-white">
                        Apple Silicon Mac
                      </div>
                      <div className="text-xs text-[#a1a1aa]">M1, M2, M3, M4 (.dmg)</div>
                    </div>
                  </div>
                  <Download className="size-4 text-[#a1a1aa] group-hover:text-[#ff5100] group-hover:translate-y-0.5 transition-all" />
                </a>

                <a
                  href="https://github.com/tinchu/weave/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-[#18181b] border border-[#27272a] hover:border-[#ff5100] hover:shadow-sm transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Laptop className="size-5 text-[#a1a1aa]" />
                    <div className="text-left">
                      <div className="text-sm font-semibold text-white">
                        Intel Mac
                      </div>
                      <div className="text-xs text-[#a1a1aa]">Older Intel models (.dmg)</div>
                    </div>
                  </div>
                  <Download className="size-4 text-[#a1a1aa] group-hover:text-[#ff5100] group-hover:translate-y-0.5 transition-all" />
                </a>
              </div>
            )}

            {downloadTab === 'windows' && (
              <div className="flex flex-col gap-3">
                <a
                  href="https://github.com/tinchu/weave/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-4 rounded-2xl bg-[#18181b] border border-[#27272a] hover:border-[#ff5100] hover:shadow-sm transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Laptop className="size-5 text-[#ff5100]" />
                    <div className="text-left">
                      <div className="text-sm font-semibold text-white">
                        Windows 10 / 11 Installer
                      </div>
                      <div className="text-xs text-[#a1a1aa]">Standard 64-bit installer (.exe)</div>
                    </div>
                  </div>
                  <Download className="size-4 text-[#a1a1aa] group-hover:text-[#ff5100] group-hover:translate-y-0.5 transition-all" />
                </a>
              </div>
            )}

            {downloadTab === 'qr' && (
              <div className="flex flex-col items-center gap-3 p-4 rounded-2xl bg-[#18181b] border border-[#27272a] text-center">
                <div className="size-32 bg-white rounded-xl flex items-center justify-center p-2">
                  <QrCode className="size-24 text-black" />
                </div>
                <div className="text-xs text-[#a1a1aa]">
                  Open <strong className="text-white">WhatsApp &gt; Linked Devices</strong> and scan the code displayed by the Weave desktop app.
                </div>
              </div>
            )}

            {/* Quick terminal install note */}
            <div className="pt-2 border-t border-[#27272a] flex items-center justify-between text-xs text-[#71717a]">
              <span>Or install via terminal:</span>
              <button
                onClick={copyQuickInstall}
                className="font-mono bg-[#18181b] text-white px-2 py-1 rounded border border-[#27272a] hover:border-[#ff5100] flex items-center gap-1 cursor-pointer transition-colors"
              >
                {copiedCode ? (
                  <>
                    <Check className="size-3 text-emerald-400" />
                    <span className="text-emerald-400 font-semibold">Copied!</span>
                  </>
                ) : (
                  <span>$ npm i -g weave-agent</span>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default App;
