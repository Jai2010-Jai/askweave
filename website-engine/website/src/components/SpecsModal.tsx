import React, { useState } from 'react';
import { X, Cpu, Layers, Lock } from 'lucide-react';

interface SpecsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SpecsModal: React.FC<SpecsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'architecture' | 'harness' | 'security'>('architecture');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-obsidian-dark/70 backdrop-blur-sm animate-fadeIn">
      <div 
        className="w-full max-w-4xl rounded-xl border border-border-strong bg-[#fcf9f8] shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ead6cd] bg-[#f4ebe6]/60">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded bg-[#ff5100] text-white flex items-center justify-center">
              <Cpu className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-mono tracking-tight text-[#1d110c]">
                DAEMON 2.3 // TECHNICAL SPECIFICATION
              </h3>
              <p className="text-xs text-obsidian-muted font-sans">
                Native Host MCP Architecture & Sovereign Hardware Runtime
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

        {/* Tab Navigation */}
        <div className="flex border-b border-[#ead6cd] bg-[#fbf9f5] px-6 text-xs font-mono">
          <button
            onClick={() => setActiveTab('architecture')}
            className={`py-3 px-4 font-bold border-b-2 transition-colors ${
              activeTab === 'architecture'
                ? 'border-[#ff5100] text-[#ff5100]'
                : 'border-transparent text-obsidian-muted hover:text-[#1d110c]'
            }`}
          >
            01. System Architecture
          </button>
          <button
            onClick={() => setActiveTab('harness')}
            className={`py-3 px-4 font-bold border-b-2 transition-colors ${
              activeTab === 'harness'
                ? 'border-[#ff5100] text-[#ff5100]'
                : 'border-transparent text-obsidian-muted hover:text-[#1d110c]'
            }`}
          >
            02. MCP Harness &amp; Sandbox
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`py-3 px-4 font-bold border-b-2 transition-colors ${
              activeTab === 'security'
                ? 'border-[#ff5100] text-[#ff5100]'
                : 'border-transparent text-obsidian-muted hover:text-[#1d110c]'
            }`}
          >
            03. Zero-Cloud Cryptography
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs leading-relaxed text-[#59534E]">
          {activeTab === 'architecture' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3.5 space-y-1">
                  <div className="text-[10px] font-mono font-bold text-[#ff5100] uppercase">Memory Footprint</div>
                  <div className="text-xl font-black font-mono text-[#1d110c]">~48 MB</div>
                  <p className="text-[11px] font-sans">Lean sovereign C++/Node daemon requiring minimal system overhead.</p>
                </div>
                <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3.5 space-y-1">
                  <div className="text-[10px] font-mono font-bold text-[#ff5100] uppercase">Cold Start Latency</div>
                  <div className="text-xl font-black font-mono text-[#1d110c]">&lt; 180 ms</div>
                  <p className="text-[11px] font-sans">Instant wake on WhatsApp WebSocket frame notification.</p>
                </div>
                <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3.5 space-y-1">
                  <div className="text-[10px] font-mono font-bold text-[#ff5100] uppercase">Socket Protocol</div>
                  <div className="text-xl font-black font-mono text-[#1d110c]">Baileys WSS</div>
                  <p className="text-[11px] font-sans">End-to-end Signal noise protocol connection directly with your phone.</p>
                </div>
              </div>

              <div className="rounded border border-[#ead6cd] bg-[#181311] p-4 text-[#f3f1eb] font-mono text-[11px] space-y-2">
                <div className="text-emerald-400 font-bold">// DAEMON RUNTIME TOPOLOGY</div>
                <div className="text-stone-300">
                  Phone (WhatsApp Audio/Text) ──[WSS Noise]──&gt; Host Daemon (Port 4848)
                  <br />
                  &nbsp;&nbsp;├── Voice Parser (Local Whisper / VAD)
                  <br />
                  &nbsp;&nbsp;├── Antigravity AST Engine (Deterministic Tree Transform)
                  <br />
                  &nbsp;&nbsp;├── Isolated Headless Sandbox (Playwright Verification)
                  <br />
                  &nbsp;&nbsp;└── Push Response &amp; Visual Screenshot Back to WhatsApp
                </div>
              </div>
            </div>
          )}

          {activeTab === 'harness' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded border border-[#ead6cd] bg-[#fbf9f5] p-4">
                <Layers className="size-5 text-[#ff5100] shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-[#1d110c] font-mono">Model Context Protocol (MCP) Integration</h4>
                  <p className="font-sans text-[11px]">
                    Weave registers as a high-speed MCP server conforming to the open Model Context Protocol spec. It exposes native tools to Claude Code, Antigravity CLI, or Cursor with zero configuration.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3.5 space-y-1">
                  <div className="font-bold text-[#1d110c] font-mono">Headless Playwright Sandbox</div>
                  <p className="font-sans text-[11px]">
                    Before committing any code edit, Weave executes verification scripts in an ephemeral browser context and snapshots the rendered UI.
                  </p>
                </div>
                <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3.5 space-y-1">
                  <div className="font-bold text-[#1d110c] font-mono">Deterministic Syntax Trees</div>
                  <p className="font-sans text-[11px]">
                    Bypasses fuzzy string replaces by parsing real Babel/SWC and TypeScript AST nodes. Only targeted functions or elements are modified.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded border border-emerald-200 bg-emerald-50/50 p-4">
                <Lock className="size-5 text-emerald-700 shrink-0 mt-0.5" />
                <div className="space-y-1 text-emerald-900">
                  <h4 className="font-bold font-mono">Strict Sovereign Privacy Guarantee</h4>
                  <p className="font-sans text-[11px]">
                    Your code, WhatsApp credentials, audio recordings, and git keys never leave your physical computer. There is zero telemetry, zero analytics, and zero cloud middleman.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3.5 space-y-1">
                  <div className="font-bold text-[#1d110c] font-mono">Hardware Keychain Storage</div>
                  <p className="font-sans text-[11px]">
                    Multi-device session keys are encrypted in OS-native secure enclaves (Apple Keychain, Linux Secret Service, or Windows DPAPI).
                  </p>
                </div>
                <div className="rounded border border-[#ead6cd] bg-[#fbf9f5] p-3.5 space-y-1">
                  <div className="font-bold text-[#1d110c] font-mono">Ephemeral Memory Lifecycle</div>
                  <p className="font-sans text-[11px]">
                    Incoming audio chunks and temporary AST diff buffers are zeroed out in RAM immediately after transmission.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#ead6cd] bg-[#f4ebe6]/60">
          <span className="text-[11px] font-mono text-obsidian-muted">
            WEAVE MCP CORE • v2.3.0-edge
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-[#ff5100] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#e04500] transition-colors"
          >
            Close Specs
          </button>
        </div>
      </div>
    </div>
  );
};
