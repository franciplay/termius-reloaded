import React, { useState } from 'react';
import {
  Server,
  Plus,
  Terminal,
  FolderTree,
  Trash2,
  Edit2,
  Search,
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
  const [authType, setAuthType] = useState<'password' | 'key'>('password');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [keyData, setKeyData] = useState('');
  const [tags, setTags] = useState('');
  const [color, setColor] = useState('#3b82f6');

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
    setAuthType('password');
    setPassword('');
    setKeyPath('');
    setKeyData('');
    setTags('');
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
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] overflow-hidden select-none">
      {/* Header bar */}
      <div className="flex items-center justify-between p-6 border-b border-[#30363d] bg-[#161b22]">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Server className="text-blue-500" size={24} />
            Hosts & Servers
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Manage your remote machines, SSH profiles, and cloud instances
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold shadow-md transition-all active:scale-95"
        >
          <Plus size={18} />
          New Host
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-[#21262d] bg-[#0d1117]">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-2.5 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search by name, IP, or username..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] rounded-lg pl-10 pr-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Tag Filters */}
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          <button
            onClick={() => setSelectedTag(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedTag === null
                ? 'bg-blue-600 text-white'
                : 'bg-[#21262d] text-gray-400 hover:bg-[#30363d] hover:text-gray-200'
            }`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedTag === tag
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#21262d] text-gray-400 hover:bg-[#30363d] hover:text-gray-200'
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>

      {/* Host Cards Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredHosts.map((h) => (
            <div
              key={h.id}
              className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 hover:border-[#484f58] transition-all flex flex-col justify-between group shadow-lg hover:shadow-xl"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3.5 h-3.5 rounded-full ring-2 ring-white/10"
                      style={{ backgroundColor: h.color || '#3b82f6' }}
                    />
                    <div>
                      <h3 className="font-semibold text-white text-base group-hover:text-blue-400 transition-colors">
                        {h.label}
                      </h3>
                      <p className="text-xs font-mono text-gray-400 mt-0.5">
                        {h.username}@{h.address}:{h.port}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEditModal(h)}
                      className="p-1.5 hover:bg-[#30363d] rounded text-gray-400 hover:text-gray-200"
                      title="Edit Host"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => onDeleteHost(h.id)}
                      className="p-1.5 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                      title="Delete Host"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Tags */}
                {h.tags && h.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {h.tags.map((t) => (
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

              {/* Action Buttons */}
              <div className="flex items-center gap-2 mt-5 pt-4 border-t border-[#21262d]">
                <button
                  onClick={() => onConnectSsh(h)}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white rounded-lg text-xs font-semibold transition-all"
                >
                  <Terminal size={15} />
                  SSH Shell
                </button>
                <button
                  onClick={() => onConnectSftp(h)}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-[#21262d] hover:bg-[#30363d] text-gray-300 hover:text-white rounded-lg text-xs font-semibold transition-all"
                  title="Open SFTP Files"
                >
                  <FolderTree size={15} />
                  SFTP
                </button>
              </div>
            </div>
          ))}

          {filteredHosts.length === 0 && (
            <div className="col-span-full text-center py-16 bg-[#161b22]/40 rounded-xl border border-dashed border-[#30363d]">
              <Server className="mx-auto text-gray-600 mb-3" size={40} />
              <p className="text-gray-400 font-medium">No servers found</p>
              <p className="text-xs text-gray-500 mt-1">Add your first host to get started</p>
              <button
                onClick={openAddModal}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold"
              >
                + Add Host
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">
              {editingHost ? 'Edit Host' : 'New SSH Host'}
            </h2>

            <form onSubmit={handleSaveHost} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-300 mb-1">Label</label>
                  <input
                    type="text"
                    placeholder="e.g. Production Web"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Color</label>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-full h-9 bg-[#0d1117] border border-[#30363d] rounded-lg p-1 cursor-pointer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Hostname or IP *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="192.168.1.1 or example.com"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Username</label>
                <input
                  type="text"
                  placeholder="root / ubuntu / admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* Authentication Type selector */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Authentication Method
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthType('password')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      authType === 'password'
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-[#0d1117] text-gray-400 border-[#30363d]'
                    }`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthType('key')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      authType === 'key'
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-[#0d1117] text-gray-400 border-[#30363d]'
                    }`}
                  >
                    SSH Key
                  </button>
                </div>
              </div>

              {authType === 'password' ? (
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Password</label>
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1">
                      Private Key File Path
                    </label>
                    <input
                      type="text"
                      placeholder="C:\Users\you\.ssh\id_ed25519"
                      value={keyPath}
                      onChange={(e) => setKeyPath(e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1">
                      Or Paste Private Key Text
                    </label>
                    <textarea
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                      rows={3}
                      value={keyData}
                      onChange={(e) => setKeyData(e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="production, web, debian"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
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
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold shadow-md"
                >
                  Save Host
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
