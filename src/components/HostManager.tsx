import React, { useState } from 'react';
import {
  Server,
  Plus,
  Terminal,
  FolderTree,
  Trash2,
  Edit2,
  Search,
  Activity,
  Shield,
  Layers,
  ChevronRight,
  Sliders,
  Check,
  X,
  Lock,
  Key
} from 'lucide-react';
import { Host } from '../types';

interface HostManagerProps {
  hosts: Host[];
  onAddHost: (host: Host) => void;
  onUpdateHost: (host: Host) => void;
  onDeleteHost: (id: string) => void;
  onConnectSsh: (host: Host) => void;
  onConnectSftp: (host: Host) => void;
}

export const HostManager: React.FC<HostManagerProps> = ({
  hosts,
  onAddHost,
  onUpdateHost,
  onDeleteHost,
  onConnectSsh,
  onConnectSftp,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);

  // Form State
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [authType, setAuthType] = useState<'password' | 'key'>('key');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [keyData, setKeyData] = useState('');
  const [tags, setTags] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [envGroup, setEnvGroup] = useState<'prod' | 'staging' | 'edge' | 'internal'>('prod');

  const allTags = Array.from(new Set(hosts.flatMap((h) => h.tags || [])));

  const filteredHosts = hosts.filter((h) => {
    const matchesSearch =
      h.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.username.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTag = selectedTag ? h.tags?.includes(selectedTag) : true;
    return matchesSearch && matchesTag;
  });

  const openAddModal = () => {
    setEditingHost(null);
    setLabel('');
    setAddress('');
    setPort(22);
    setUsername('root');
    setAuthType('key');
    setPassword('');
    setKeyPath('');
    setKeyData('');
    setTags('prod, us-east');
    setColor('#3b82f6');
    setIsModalOpen(true);
  };

  const openEditModal = (h: Host) => {
    setEditingHost(h);
    setLabel(h.label);
    setAddress(h.address);
    setPort(h.port);
    setUsername(h.username);
    setAuthType(h.authType);
    setPassword(h.password || '');
    setKeyPath(h.keyPath || '');
    setKeyData(h.keyData || '');
    setTags(h.tags?.join(', ') || '');
    setColor(h.color || '#3b82f6');
    setIsModalOpen(true);
  };

  const handleSaveHost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;

    const hostData: Host = {
      id: editingHost ? editingHost.id : `host_${Date.now()}`,
      label: label.trim() || address.trim(),
      address: address.trim(),
      port: Number(port) || 22,
      username: username.trim() || 'root',
      authType,
      password: authType === 'password' ? password : undefined,
      keyPath: authType === 'key' && keyPath.trim() ? keyPath.trim() : undefined,
      keyData: authType === 'key' && keyData.trim() ? keyData.trim() : undefined,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      color,
      createdAt: editingHost ? editingHost.createdAt : Date.now(),
    };

    if (editingHost) {
      onUpdateHost(hostData);
    } else {
      onAddHost(hostData);
    }

    setIsModalOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d0e13] text-[#c9d1d9] overflow-hidden select-none font-sans">
      {/* Top Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f222e] bg-[#121318]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Server size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                Host Topology & Inventory
              </h1>
              <span className="text-[10px] font-mono bg-[#1c1f2b] text-blue-400 px-2 py-0.5 rounded border border-[#2b3044]">
                {hosts.length} Hosts Active
              </span>
            </div>
            <p className="text-[11px] text-gray-500 font-mono mt-0.5">
              Encrypted SSH profiles, bastions, and microservice clusters
            </p>
          </div>
        </div>

        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98]"
        >
          <Plus size={14} />
          Provision Host
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-[#1f222e] bg-[#0d0e13]">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 text-gray-500" size={14} />
          <input
            type="text"
            placeholder="Search hostname, IP, tag or identity..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#121318] border border-[#232736] rounded-lg pl-9 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Tag Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          <button
            onClick={() => setSelectedTag(null)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
              selectedTag === null
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
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
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'bg-[#14161f] text-gray-400 hover:bg-[#1a1c28] border border-[#1f222e]'
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>

      {/* Host Cards Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredHosts.map((h) => {
            const isProd = h.tags?.some((t) => t.toLowerCase().includes('prod'));
            return (
              <div
                key={h.id}
                className="bg-[#121318] border border-[#1f222e] hover:border-[#2d3245] rounded-xl p-4 transition-all flex flex-col justify-between group shadow-sm hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full ring-2 ring-white/10"
                        style={{ backgroundColor: h.color || '#3b82f6' }}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-mono text-sm font-semibold text-gray-200 group-hover:text-blue-400 transition-colors">
                            {h.label}
                          </h3>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${
                              isProd
                                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            }`}
                          >
                            {isProd ? 'PROD' : 'ACTIVE'}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-gray-500 mt-0.5">
                          {h.username}@{h.address}:{h.port}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEditModal(h)}
                        className="p-1 hover:bg-[#1f222e] rounded text-gray-400 hover:text-gray-200"
                        title="Edit Host"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => onDeleteHost(h.id)}
                        className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                        title="Delete Host"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Telemetry info */}
                  <div className="mt-3 py-2 px-2.5 bg-[#0a0b0e] border border-[#1b1d28] rounded-lg flex items-center justify-between text-[10px] font-mono text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <Shield size={11} className="text-emerald-400" />
                      {h.authType === 'key' ? 'ed25519 key' : 'password auth'}
                    </span>
                    <span className="text-emerald-400">12ms RTT</span>
                  </div>

                  {/* Tags */}
                  {h.tags && h.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {h.tags.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 bg-[#171922] border border-[#212534] text-gray-400 rounded text-[10px] font-mono"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#1a1c27]">
                  <button
                    onClick={() => onConnectSsh(h)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-blue-600/15 hover:bg-blue-600 text-blue-300 hover:text-white rounded-lg text-xs font-mono font-medium transition-all"
                  >
                    <Terminal size={13} />
                    SSH Terminal
                  </button>
                  <button
                    onClick={() => onConnectSftp(h)}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-[#181a24] hover:bg-[#232736] text-gray-300 hover:text-white rounded-lg text-xs font-mono font-medium transition-all"
                    title="Open SFTP Files"
                  >
                    <FolderTree size={13} className="text-emerald-400" />
                    SFTP
                  </button>
                </div>
              </div>
            );
          })}

          {filteredHosts.length === 0 && (
            <div className="col-span-full text-center py-16 bg-[#121318]/50 rounded-xl border border-dashed border-[#232736]">
              <Server className="mx-auto text-gray-600 mb-3" size={36} />
              <p className="text-gray-300 text-xs font-mono font-medium">No host configurations matched</p>
              <p className="text-[11px] text-gray-500 mt-1 font-mono">Provision a host profile to start connecting</p>
              <button
                onClick={openAddModal}
                className="mt-4 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-mono font-semibold"
              >
                + Provision Host
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Modal with obsidian styling */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121318] border border-[#232736] rounded-xl w-full max-w-lg p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#1f222e] mb-4">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <Server size={14} className="text-blue-400" />
                {editingHost ? 'Modify Host Identity' : 'Provision New SSH Host'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 hover:bg-[#1c1e28] rounded text-gray-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSaveHost} className="space-y-3.5">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">Server Label</label>
                  <input
                    type="text"
                    placeholder="e.g. prod-us-east-1"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">Indicator</label>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-full h-8 bg-[#0a0b0e] border border-[#232736] rounded-lg p-1 cursor-pointer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">Host Address / IP *</label>
                  <input
                    type="text"
                    required
                    placeholder="10.0.12.84 or api.company.internal"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">SSH Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">Login User</label>
                <input
                  type="text"
                  placeholder="ubuntu / root / devsecops"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Auth selection */}
              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">Authentication Method</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthType('key')}
                    className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-lg border transition-all flex items-center justify-center gap-1.5 ${
                      authType === 'key'
                        ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                        : 'bg-[#0a0b0e] text-gray-400 border-[#232736]'
                    }`}
                  >
                    <Key size={12} />
                    SSH Key (ed25519)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthType('password')}
                    className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-lg border transition-all flex items-center justify-center gap-1.5 ${
                      authType === 'password'
                        ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                        : 'bg-[#0a0b0e] text-gray-400 border-[#232736]'
                    }`}
                  >
                    <Lock size={12} />
                    Password
                  </button>
                </div>
              </div>

              {authType === 'password' ? (
                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">Encrypted Password</label>
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] font-mono text-gray-400 mb-1">Private Key Path</label>
                    <input
                      type="text"
                      placeholder="~/.ssh/id_ed25519"
                      value={keyPath}
                      onChange={(e) => setKeyPath(e.target.value)}
                      className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-gray-400 mb-1">Or Paste OpenSSH Key Text</label>
                    <textarea
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                      rows={2}
                      value={keyData}
                      onChange={(e) => setKeyData(e.target.value)}
                      className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg p-2 text-[11px] text-gray-200 font-mono focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  placeholder="prod, kubernetes, edge"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                />
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
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-mono font-semibold shadow-md"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
