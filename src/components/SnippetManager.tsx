import React, { useState } from 'react';
import { Terminal, Copy, Plus, Trash2, Play, Check } from 'lucide-react';
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

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
      label: label.trim() || 'Custom Script',
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
    setIsModalOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] overflow-hidden select-none">
      <div className="flex items-center justify-between p-6 border-b border-[#30363d] bg-[#161b22]">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="text-purple-400" size={24} />
            Snippets & Command Scripts
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Store commands and execute them quickly across your servers
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-semibold shadow-md"
        >
          <Plus size={18} />
          New Snippet
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {snippets.map((sn) => (
            <div
              key={sn.id}
              className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 hover:border-[#484f58] transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-white text-base">{sn.label}</h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopy(sn.id, sn.command)}
                      className="p-1.5 hover:bg-[#30363d] rounded text-gray-400 hover:text-gray-200"
                      title="Copy command"
                    >
                      {copiedId === sn.id ? (
                        <Check size={15} className="text-green-400" />
                      ) : (
                        <Copy size={15} />
                      )}
                    </button>
                    <button
                      onClick={() => onDeleteSnippet(sn.id)}
                      className="p-1.5 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                      title="Delete snippet"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {sn.description && (
                  <p className="text-xs text-gray-400 mt-1">{sn.description}</p>
                )}

                <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 font-mono text-xs text-green-400 mt-3 overflow-x-auto whitespace-pre">
                  {sn.command}
                </div>

                {sn.tags && sn.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {sn.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 bg-[#21262d] text-gray-400 rounded text-[11px] font-mono"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {onRunSnippet && (
                <button
                  onClick={() => onRunSnippet(sn.command)}
                  className="mt-4 flex items-center justify-center gap-2 py-2 px-3 bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white rounded-lg text-xs font-semibold transition-all"
                >
                  <Play size={14} />
                  Run in Active Terminal
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Create Snippet</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Title</label>
                <input
                  type="text"
                  placeholder="e.g. Restart Nginx"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Shell Command *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="sudo systemctl restart nginx"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-xs text-gray-200 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="Quick explanation of the command"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="nginx, web, restart"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-[#21262d]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-gray-300 rounded-lg text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-semibold shadow-md"
                >
                  Save Snippet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
