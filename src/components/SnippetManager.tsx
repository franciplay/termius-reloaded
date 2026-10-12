import React, { useState } from 'react';
import {
  Code2,
  Terminal,
  Copy,
  Plus,
  Trash2,
  Play,
  Check,
  Search,
  Tag,
  Sliders,
  Sparkles,
  Layers,
  ChevronRight,
  Edit3,
  X,
  FileCode,
  Zap,
  CornerDownLeft,
  CheckCircle2
} from 'lucide-react';
import { Snippet } from '../types';

interface SnippetManagerProps {
  snippets: Snippet[];
  onAddSnippet: (snippet: Snippet) => void;
  onDeleteSnippet: (id: string) => void;
  onRunSnippet?: (command: string) => void;
}

export const SnippetManager: React.FC<SnippetManagerProps> = ({
  snippets,
  onAddSnippet,
  onDeleteSnippet,
  onRunSnippet,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'all' | 'kubernetes' | 'docker' | 'system' | 'network'>('all');

  // Form State
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [shortcutKey, setShortcutKey] = useState('');

  const displaySnippets: Snippet[] = snippets;

  const allTags = Array.from(new Set(displaySnippets.flatMap((s) => s.tags || [])));

  const filteredSnippets = displaySnippets.filter((s) => {
    const matchesQuery =
      s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesTag = selectedTag ? s.tags?.includes(selectedTag) : true;
    return matchesQuery && matchesTag;
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    onAddSnippet({
      id: `sn_${Date.now()}`,
      label: label.trim() || 'Custom Runbook Script',
      command: command.trim(),
      description: description.trim(),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });

    setLabel('');
    setCommand('');
    setDescription('');
    setTags('');
    setShortcutKey('');
    setIsModalOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d0e13] text-[#c9d1d9] overflow-hidden select-none font-sans">
      {/* 1. Header Toolbar matching TermStation Obsidian Theme */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f222e] bg-[#121318] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-600/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Code2 size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                Command Vault & Runbooks
              </h1>
              <span className="text-[10px] font-mono bg-[#1c182a] text-purple-400 px-2 py-0.5 rounded border border-[#3b2b52]">
                {displaySnippets.length} Script Templates
              </span>
            </div>
            <p className="text-[11px] text-gray-500 font-mono mt-0.5">
              Parameterized shell triggers, DevOps playbooks, and terminal runbooks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-mono bg-[#121318] border border-[#1f222e] px-2.5 py-1 rounded text-gray-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            Active Runner: <strong className="text-gray-300">Alt + S</strong>
          </span>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-purple-600/20 transition-all active:scale-[0.98]"
          >
            <Plus size={14} />
            New Runbook
          </button>
        </div>
      </div>

      {/* 2. Filter & Command Search Rail */}
      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-[#1f222e] bg-[#0d0e13] flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 text-gray-500" size={14} />
          <input
            type="text"
            placeholder="Search runbook title, command flags, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#121318] border border-[#232736] rounded-lg pl-9 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 font-mono focus:outline-none focus:border-purple-500 transition-colors"
          />
        </div>

        {/* Tag Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          <button
            onClick={() => setSelectedTag(null)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
              selectedTag === null
                ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                : 'bg-[#14161f] text-gray-400 hover:bg-[#1a1c28] border border-transparent'
            }`}
          >
            ALL
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors uppercase ${
                selectedTag === tag
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                  : 'bg-[#14161f] text-gray-400 hover:bg-[#1a1c28] border border-[#1f222e]'
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Snippets Grid matching TermStation Workstation Cards */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSnippets.map((sn) => {
            const isK8s = sn.tags?.some((t) => t.includes('k8s') || t.includes('kubernetes'));
            const isDocker = sn.tags?.some((t) => t.includes('docker'));

            return (
              <div
                key={sn.id}
                className="bg-[#121318] border border-[#1f222e] hover:border-[#2f2742] rounded-xl p-4 transition-all flex flex-col justify-between group shadow-sm hover:shadow-lg hover:shadow-purple-950/20"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#0a0b0e] border border-[#232736] flex items-center justify-center text-purple-400 flex-shrink-0 group-hover:border-purple-500/40 transition-colors">
                        <Terminal size={15} />
                      </div>
                      <div className="truncate">
                        <h3 className="font-mono text-xs font-bold text-gray-200 group-hover:text-purple-300 transition-colors truncate">
                          {sn.label}
                        </h3>
                        {sn.description && (
                          <p className="text-[11px] text-gray-500 font-mono mt-0.5 truncate max-w-[200px]">
                            {sn.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => handleCopy(sn.id, sn.command)}
                        className="p-1 hover:bg-[#1f222e] rounded text-gray-400 hover:text-gray-200 transition-colors"
                        title="Copy Command to Clipboard"
                      >
                        {copiedId === sn.id ? (
                          <Check size={13} className="text-emerald-400" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                      <button
                        onClick={() => onDeleteSnippet(sn.id)}
                        className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition-colors"
                        title="Delete Runbook"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Code Block Terminal Preview */}
                  <div className="mt-3 bg-[#0a0b0e] border border-[#1c1f2b] rounded-lg p-3 font-mono text-[11px] text-emerald-400/90 relative group/code overflow-hidden shadow-inner leading-relaxed">
                    <div className="flex items-center justify-between text-[9px] text-gray-500 pb-1.5 mb-1.5 border-b border-[#181a24] uppercase tracking-wider font-mono">
                      <span className="flex items-center gap-1 text-gray-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
                        bash script
                      </span>
                      <span>UTF-8</span>
                    </div>

                    <div className="overflow-x-auto whitespace-pre-wrap break-all text-gray-300 font-mono max-h-20 scrollbar-thin">
                      <span className="text-purple-400 select-none">$ </span>
                      {sn.command}
                    </div>
                  </div>

                  {/* Tags */}
                  {sn.tags && sn.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {sn.tags.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 bg-[#171922] border border-[#212534] text-gray-400 rounded text-[10px] font-mono group-hover:border-purple-500/20 transition-colors"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bottom Trigger CTA */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#1a1c27]">
                  <button
                    onClick={() => onRunSnippet && onRunSnippet(sn.command)}
                    className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 bg-purple-600/15 hover:bg-purple-600 text-purple-300 hover:text-white rounded-lg text-xs font-mono font-medium transition-all shadow-sm active:scale-[0.98]"
                  >
                    <Play size={12} className="fill-current" />
                    <span>Run in Active Shell</span>
                  </button>

                  <button
                    onClick={() => handleCopy(sn.id, sn.command)}
                    className="flex items-center justify-center p-1.5 bg-[#171922] hover:bg-[#202330] text-gray-400 hover:text-gray-200 rounded-lg text-xs font-mono transition-colors"
                    title="Quick Copy"
                  >
                    <CornerDownLeft size={13} />
                  </button>
                </div>
              </div>
            );
          })}

          {filteredSnippets.length === 0 && (
            <div className="col-span-full text-center py-16 bg-[#121318]/50 rounded-xl border border-dashed border-[#232736]">
              <Code2 className="mx-auto text-gray-600 mb-3" size={36} />
              <p className="text-gray-300 text-xs font-mono font-medium">No runbooks or snippets match your filter</p>
              <p className="text-[11px] text-gray-500 mt-1 font-mono">Create a template to execute quick routines across your clusters</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="mt-4 px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-mono font-semibold"
              >
                + New Runbook
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4. New / Edit Runbook Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121318] border border-[#232736] rounded-xl w-full max-w-lg p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#1f222e] mb-4">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <Code2 size={14} className="text-purple-400" />
                Register New Command Runbook
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-[#1c1e28] rounded text-gray-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">Runbook Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Restart Production Nginx Pod"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] font-mono text-gray-400 mb-1">
                  <span>Shell Command Script *</span>
                  <span className="text-[10px] text-purple-400">Environment variables ($VAR) supported</span>
                </div>
                <textarea
                  required
                  rows={4}
                  placeholder="kubectl rollout restart deployment/api-server -n production"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg p-2.5 text-xs text-emerald-400 font-mono focus:outline-none focus:border-purple-500 resize-none leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">Description & Purpose</label>
                <input
                  type="text"
                  placeholder="Explain when and where this runbook should be invoked"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    placeholder="kubernetes, nginx, prod"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">Hot-trigger Key</label>
                  <input
                    type="text"
                    placeholder="e.g. Alt+1"
                    value={shortcutKey}
                    onChange={(e) => setShortcutKey(e.target.value)}
                    className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#1f222e]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 bg-[#171922] hover:bg-[#202330] text-gray-300 rounded-lg text-xs font-mono"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-mono font-semibold shadow-md"
                >
                  Save Runbook
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SnippetManager;
