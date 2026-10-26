import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface McpHarnessSectionProps {
  onOpenSpecs: () => void;
}

export const McpHarnessSection: React.FC<McpHarnessSectionProps> = ({ onOpenSpecs }) => {
  const [expandedCard, setExpandedCard] = useState<number | null>(null);

  const cards = [
    {
      id: 1,
      icon: 'verified_user',
      title: 'Headless Verification',
      badge: 'AUTOMATED TESTS',
      subtitle: 'Checks its own work',
      description: 'Automatically tests before saving any changes so nothing breaks. Playwright verification inside isolated daemon sandbox.',
      details: 'Whether booking a ride, securing a hotel, or building a website, Weave runs local assertions in an isolated sandbox before confirming.'
    },
    {
      id: 2,
      icon: 'account_tree',
      title: 'Deterministic AST',
      badge: 'ZERO HALLUCINATIONS',
      subtitle: 'Accurate & Reliable',
      description: 'Follows your instructions without hallucinating or making unwanted edits. Strict grammar enforcement on all synthesized patches.',
      details: 'Modifies clean, real code and API actions directly. No guesswork, no broken layouts, and no unauthorized orders.'
    },
    {
      id: 3,
      icon: 'lock',
      title: 'Socket Encrypted',
      badge: 'ZERO CLOUD LEAKS',
      subtitle: '100% Sovereign & Private',
      description: 'Local key-pair handshake. Zero cloud leaks. Session tokens stay securely in system keychain on your machine.',
      details: 'Your phone talks directly to your computer using encrypted WhatsApp protocols. No external servers ever hold your data.'
    }
  ];

  return (
    <section className="flex flex-col gap-6 py-4" id="features">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-2 max-w-xl">
          <span className="text-[11px] font-bold tracking-widest uppercase text-[#ff5100]">
            LOCAL DAEMON SPECIFICATION
          </span>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-[#1d110c]">
            Native MCP Harness
          </h2>
          <p className="text-xs sm:text-sm font-sans text-[#59534E]">
            Direct WhatsApp socket to local Antigravity runtime. Telegraphic latency, total host isolation.
          </p>
        </div>

        <button
          onClick={onOpenSpecs}
          className="h-10 px-4 rounded bg-[#ff5100] text-[#fcf9f8] text-xs font-bold font-mono uppercase tracking-widest hover:bg-[#e04500] transition-colors self-start sm:self-auto shadow-sm active:scale-98 cursor-pointer"
        >
          View Specs
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card, idx) => {
          const isExpanded = expandedCard === idx;
          return (
            <div
              key={card.id}
              onClick={() => setExpandedCard(isExpanded ? null : idx)}
              className={`flex flex-col justify-between rounded border transition-all duration-200 cursor-pointer p-5 ${
                isExpanded
                  ? 'border-[#ff5100] bg-[#fbf9f5] shadow-md ring-1 ring-[#ff5100]/20'
                  : 'border-[#ead6cd] bg-[#fcf9f8] hover:border-[#d3cec2] hover:shadow-sm'
              } ${idx === 2 ? 'sm:col-span-2 lg:col-span-1' : ''}`}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="size-8 rounded bg-[#f4ebe6] flex items-center justify-center text-[#ff5100] border border-[#ead6cd]">
                    <span className="material-symbols-outlined text-lg">{card.icon}</span>
                  </div>
                  <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-[#f4ebe6] text-[#a16245]">
                    {card.badge}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-bold tracking-tight text-[#1d110c] font-mono">
                    {card.title}
                  </h3>
                  <div className="text-[11px] font-mono font-semibold text-[#ff5100]">
                    {card.subtitle}
                  </div>
                  <p className="text-xs font-sans text-[#59534E] leading-normal pt-1">
                    {card.description}
                  </p>
                </div>

                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-[#ead6cd] text-[11px] font-sans text-stone-700 bg-[#f4ebe6]/50 p-2.5 rounded animate-fadeIn">
                    <p className="leading-relaxed">{card.details}</p>
                  </div>
                )}
              </div>

              <div className="mt-3 pt-2 border-t border-[#f4ebe6] flex items-center justify-between text-[10px] font-mono text-obsidian-muted">
                <span>{isExpanded ? 'Click to collapse' : 'Click for technical details'}</span>
                {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
