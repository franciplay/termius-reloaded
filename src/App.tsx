import { useState, useEffect } from 'react';
import './App.css';
import { invoke } from '@tauri-apps/api/core';
import {
  Server,
  Terminal,
  FolderTree,
  Cloud,
  Lock,
  Plus,
  X,
  Zap,
  Trash2,
  Edit2,
  Search,
  Key,
  Shield,
  Eye,
  EyeOff,
  Columns,
  Square,
  ChevronDown,
  Monitor,
  Menu,
  Check
} from 'lucide-react';
import { Host, TerminalTab } from './types';
import { VaultManager } from './services/vault';
import { subscribeToAuth } from './services/firebase';
import { TerminalView } from './components/TerminalView';
import { SftpView } from './components/SftpView';
import { SyncModal } from './components/SyncModal';
import { LockScreen } from './components/LockScreen';

export default function App() {
  const [isLocked, setIsLocked] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [splitMode, setSplitMode] = useState<'single' | 'split'>('single');

  // Vault data (real saved devices)
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostSearch, setHostSearch] = useState('');

  // Tabs & active view
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [primaryTabId, setPrimaryTabId] = useState<string | null>(null);
  const [secondaryTabId, setSecondaryTabId] = useState<string | null>(null);

  // Shells
  const [availableShells, setAvailableShells] = useState<string[]>(['powershell', 'cmd']);
  const [isShellMenuOpen, setIsShellMenuOpen] = useState(false);

  // Modals
  const [isQuickConnectOpen, setIsQuickConnectOpen] = useState(false);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Host | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [currentUserEmail, setCurrentEmail] = useState<string | null>(null);

  // Quick Connect form state (temporary, not saved)
  const [qcAddress, setQcAddress] = useState('');
  const [qcPort, setQcPort] = useState(22);
  const [qcUsername, setQcUsername] = useState('root');
  const [qcAuthType, setQcAuthType] = useState<'password' | 'key'>('password');
  const [qcPassword, setQcPassword] = useState('');
  const [qcKeyPath, setQcKeyPath] = useState('');
  const [qcShowPassword, setQcShowPassword] = useState(false);

  // Add / Edit Device form state (persisted)
  const [devLabel, setDevLabel] = useState('');
  const [devAddress, setDevAddress] = useState('');
  const [devPort, setDevPort] = useState(22);
  const [devUsername, setDevUsername] = useState('root');
  const [devAuthType, setDevAuthType] = useState<'password' | 'key'>('password');
  const [devPassword, setDevPassword] = useState('');
  const [devKeyPath, setDevKeyPath] = useState('');
  const [devColor, setDevColor] = useState('#3b82f6');
  const [devShowPassword, setDevShowPassword] = useState(false);

  // Load real vault from disk at startup
  useEffect(() => {
    const initApp = async () => {
      await VaultManager.init();
      setIsLocked(VaultManager.isLocked());

      const vault = await VaultManager.loadLocal();
      setHosts(vault.hosts || []);
    };
    initApp();

    invoke<string[]>('get_system_shells')
      .then((shells) => setAvailableShells(shells))
      .catch(() => {});

    const unsubscribeAuth = subscribeToAuth((user) => {
      setCurrentEmail(user?.email || null);
      if (user) {
        VaultManager.syncFromRemote().then(async (synced) => {
          if (synced) {
            const updated = await VaultManager.loadLocal();
            setHosts(updated.hosts);
          }
        });
      }
    });

    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, []);

  const handleSaveHosts = async (newHosts: Host[]) => {
    setHosts(newHosts);
    const vault = await VaultManager.loadLocal();
    vault.hosts = newHosts;
    await VaultManager.save(vault);
  };

  // Launch a local terminal tab (PowerShell, CMD, Bash)
  const spawnLocalTerminal = async (shellType: string) => {
    setIsShellMenuOpen(false);
    const sessionId = `local_${Date.now()}`;
    try {
      await invoke('pty_spawn', {
        sessionId,
        shell: shellType,
        cols: 100,
        rows: 30,
      });

      const newTab: TerminalTab = {
        id: sessionId,
        title: shellType.toUpperCase(),
        type: 'local',
        sessionId,
        shell: shellType,
        active: true,
      };

      setTabs((prev) => [...prev, newTab]);
      if (!primaryTabId) {
        setPrimaryTabId(sessionId);
      } else if (splitMode === 'split' && !secondaryTabId) {
        setSecondaryTabId(sessionId);
      } else {
        setPrimaryTabId(sessionId);
      }
    } catch (err) {
      console.error('Failed to spawn local terminal:', err);
    }
  };

  // Connect to an SSH host (saved or quick)
  const connectSsh = (host: Host) => {
    const sessionId = `ssh_${Date.now()}`;
    const newTab: TerminalTab = {
      id: sessionId,
      title: host.label || host.address,
      type: 'ssh',
      sessionId,
      host,
      active: true,
    };

    setTabs((prev) => [...prev, newTab]);
    if (!primaryTabId) {
      setPrimaryTabId(sessionId);
    } else if (splitMode === 'split' && !secondaryTabId) {
      setSecondaryTabId(sessionId);
    } else {
      setPrimaryTabId(sessionId);
    }

    invoke('ssh_connect', {
      params: {
        session_id: sessionId,
        host: host.address,
        port: host.port,
        username: host.username,
        auth_type: host.authType,
        password: host.password,
        key_path: host.keyPath,
        key_data: host.keyData,
        passphrase: host.passphrase,
        cols: 100,
        rows: 30,
      },
    }).catch(console.error);
  };

  const retryTab = (tabToRetry: TerminalTab) => {
    if (tabToRetry.type === 'ssh' && tabToRetry.host) {
      const newSessionId = `ssh_${Date.now()}`;
      const updatedTab: TerminalTab = {
        ...tabToRetry,
        id: newSessionId,
        sessionId: newSessionId,
      };

      setTabs((prev) => prev.map((t) => (t.id === tabToRetry.id ? updatedTab : t)));
      if (primaryTabId === tabToRetry.id) setPrimaryTabId(newSessionId);
      if (secondaryTabId === tabToRetry.id) setSecondaryTabId(newSessionId);

      invoke('ssh_connect', {
        params: {
          session_id: newSessionId,
          host: tabToRetry.host.address,
          port: tabToRetry.host.port,
          username: tabToRetry.host.username,
          auth_type: tabToRetry.host.authType,
          password: tabToRetry.host.password,
          key_path: tabToRetry.host.keyPath,
          key_data: tabToRetry.host.keyData,
          passphrase: tabToRetry.host.passphrase,
          cols: 100,
          rows: 30,
        },
      }).catch(console.error);
    }
  };

  // Quick connect: connects directly WITHOUT saving to devices
  const handleQuickConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qcAddress.trim()) return;

    const quickHost: Host = {
      id: `qc_${Date.now()}`,
      label: `${qcUsername}@${qcAddress}`,
      address: qcAddress.trim(),
      port: Number(qcPort) || 22,
      username: qcUsername.trim() || 'root',
      authType: qcAuthType,
      password: qcAuthType === 'password' ? qcPassword : undefined,
      keyPath: qcAuthType === 'key' ? qcKeyPath : undefined,
      tags: [],
      createdAt: Date.now(),
    };

    setIsQuickConnectOpen(false);
    connectSsh(quickHost);

    // Reset password for security
    setQcPassword('');
  };

  // Open the Add Device modal
  const openAddDeviceModal = () => {
    setEditingDevice(null);
    setDevLabel('');
    setDevAddress('');
    setDevPort(22);
    setDevUsername('root');
    setDevAuthType('password');
    setDevPassword('');
    setDevKeyPath('');
    setDevColor('#3b82f6');
    setIsDeviceModalOpen(true);
  };

  // Open the Edit Device modal
  const openEditDeviceModal = (h: Host, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingDevice(h);
    setDevLabel(h.label);
    setDevAddress(h.address);
    setDevPort(h.port);
    setDevUsername(h.username);
    setDevAuthType(h.authType);
    setDevPassword(h.password || '');
    setDevKeyPath(h.keyPath || '');
    setDevColor(h.color || '#3b82f6');
    setIsDeviceModalOpen(true);
  };

  // Save device (add or update)
  const handleSaveDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!devAddress.trim()) return;

    const hostData: Host = {
      id: editingDevice ? editingDevice.id : `dev_${Date.now()}`,
      label: devLabel.trim() || devAddress.trim(),
      address: devAddress.trim(),
      port: Number(devPort) || 22,
      username: devUsername.trim() || 'root',
      authType: devAuthType,
      password: devAuthType === 'password' ? devPassword : undefined,
      keyPath: devAuthType === 'key' && devKeyPath.trim() ? devKeyPath.trim() : undefined,
      tags: [],
      color: devColor,
      createdAt: editingDevice ? editingDevice.createdAt : Date.now(),
    };

    if (editingDevice) {
      const updated = hosts.map((h) => (h.id === editingDevice.id ? hostData : h));
      await handleSaveHosts(updated);
    } else {
      await handleSaveHosts([...hosts, hostData]);
    }

    setIsDeviceModalOpen(false);
  };

  // Delete a device
  const handleDeleteDevice = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this device?')) {
      const updated = hosts.filter((h) => h.id !== id);
      await handleSaveHosts(updated);
    }
  };

  // Close tab
  const closeTab = (id: string) => {
    const tabToClose = tabs.find((t) => t.id === id);
    if (tabToClose) {
      if (tabToClose.type === 'local') {
        invoke('pty_kill', { sessionId: tabToClose.sessionId }).catch(console.error);
      } else if (tabToClose.type === 'ssh') {
        invoke('ssh_disconnect', { sessionId: tabToClose.sessionId }).catch(console.error);
      }
    }

    const updated = tabs.filter((t) => t.id !== id);
    setTabs(updated);

    if (primaryTabId === id) {
      setPrimaryTabId(updated.length > 0 ? updated[0].id : null);
    }
    if (secondaryTabId === id) {
      setSecondaryTabId(updated.length > 1 ? updated[1].id : null);
    }
  };

  if (isLocked) {
    return <LockScreen onUnlocked={() => setIsLocked(false)} />;
  }

  const primaryTab = tabs.find((t) => t.id === primaryTabId);
  const secondaryTab = tabs.find((t) => t.id === secondaryTabId);
  const filteredHosts = hosts.filter((h) =>
    h.label.toLowerCase().includes(hostSearch.toLowerCase()) ||
    h.address.toLowerCase().includes(hostSearch.toLowerCase()) ||
    h.username.toLowerCase().includes(hostSearch.toLowerCase())
  );

  return (
    <div className="flex h-screen w-screen bg-[#0d0e13] text-[#c9d1d9] font-sans antialiased overflow-hidden select-none">
      {/* SIDEBAR: DEVICES & CONNECTIONS */}
      {isSidebarOpen && (
        <aside className="w-72 bg-[#121318] border-r border-[#1f222e] flex flex-col justify-between flex-shrink-0 z-20">
          <div className="flex flex-col h-full overflow-hidden">
            {/* 1. App Header */}
            <div className="p-3.5 border-b border-[#1f222e] flex items-center justify-between bg-[#0e0f14]">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-600/30">
                  <Terminal size={15} />
                </div>
                <div>
                  <h1 className="font-bold text-white text-xs tracking-tight">Termius Reloaded</h1>
                  <p className="text-[10px] text-gray-500 font-mono">Open Source Terminal</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsSyncModalOpen(true)}
                  className={`p-1.5 rounded-md hover:bg-[#1a1c26] transition-colors ${
                    currentUserEmail ? 'text-emerald-400' : 'text-gray-400 hover:text-gray-200'
                  }`}
                  title={currentUserEmail ? `Synced as: ${currentUserEmail}` : 'Cloud Sync'}
                >
                  <Cloud size={15} />
                </button>
                <button
                  onClick={() => {
                    VaultManager.lock();
                    setIsLocked(true);
                  }}
                  className="p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Lock Vault"
                >
                  <Lock size={14} />
                </button>
              </div>
            </div>

            {/* 2. Main Action Buttons */}
            <div className="p-3 border-b border-[#1f222e] space-y-2 bg-[#121318]">
              {/* Quick Connect Button */}
              <button
                onClick={() => setIsQuickConnectOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold shadow-sm transition-all active:scale-[0.98]"
              >
                <Zap size={14} className="fill-amber-400 text-amber-400" />
                Quick Connect
              </button>

              {/* Add Device Button */}
              <button
                onClick={openAddDeviceModal}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md transition-all active:scale-[0.98]"
              >
                <Plus size={14} />
                Add Device
              </button>

              {/* Local Terminal dropdown */}
              <div className="relative">
                <button
                  onClick={() => setIsShellMenuOpen(!isShellMenuOpen)}
                  className="w-full flex items-center justify-between py-1.5 px-3 bg-[#1a1c26] hover:bg-[#222533] text-gray-300 border border-[#2a2d3d] rounded-lg text-xs transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Monitor size={13} className="text-gray-400" />
                    <span>Local Terminal</span>
                  </div>
                  <ChevronDown size={13} className="text-gray-400" />
                </button>

                {isShellMenuOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1c26] border border-[#2a2d3d] rounded-lg shadow-xl z-50 py-1 overflow-hidden">
                    {availableShells.map((shell) => (
                      <button
                        key={shell}
                        onClick={() => spawnLocalTerminal(shell)}
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-blue-600 hover:text-white flex items-center gap-2"
                      >
                        <Terminal size={12} />
                        <span>{shell.toUpperCase()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Devices Header & Search */}
            <div className="px-3 pt-3 pb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Server size={12} />
                Devices ({hosts.length})
              </span>
            </div>

            {hosts.length > 2 && (
              <div className="px-3 pb-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-2 text-gray-500" />
                  <input
                    type="text"
                    value={hostSearch}
                    onChange={(e) => setHostSearch(e.target.value)}
                    placeholder="Search devices..."
                    className="w-full pl-7 pr-2.5 py-1 bg-[#0d0e13] border border-[#1f222e] rounded-md text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            {/* 4. Devices List */}
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
              {filteredHosts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center text-gray-500">
                  <Server size={28} className="mb-2 opacity-30 text-gray-400" />
                  <p className="text-xs font-medium text-gray-400">No devices saved yet</p>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Click <strong>Add Device</strong> to save a server for 1-click access.
                  </p>
                </div>
              ) : (
                filteredHosts.map((host) => (
                  <div
                    key={host.id}
                    onClick={() => connectSsh(host)}
                    className="group relative flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#1a1c26] cursor-pointer transition-colors border border-transparent hover:border-[#2a2d3d]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: host.color || '#3b82f6',
                          boxShadow: `0 0 6px ${(host.color || '#3b82f6')}66`,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-200 text-xs truncate group-hover:text-blue-400">
                          {host.label}
                        </p>
                        <p className="text-[10px] text-gray-500 font-mono truncate">
                          {host.username}@{host.address}:{host.port}
                        </p>
                      </div>
                    </div>

                    {/* Action buttons on hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => openEditDeviceModal(host, e)}
                        className="p-1 text-gray-400 hover:text-blue-400 hover:bg-[#252836] rounded"
                        title="Edit Device"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteDevice(host.id, e)}
                        className="p-1 text-gray-400 hover:text-red-400 hover:bg-[#252836] rounded"
                        title="Delete Device"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      )}

      {/* MAIN WORKSPACE */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0b0e]">
        {/* Top Tab Bar */}
        <div className="h-10 bg-[#121318] border-b border-[#1f222e] flex items-center justify-between px-2 flex-shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto flex-1 h-full py-1">
            {/* Toggle sidebar button */}
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-[#1a1c26] mr-1 flex-shrink-0"
              title={isSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
            >
              <Menu size={15} />
            </button>

            {/* Tab list */}
            {tabs.map((tab) => {
              const isPrimary = tab.id === primaryTabId;
              const isSecondary = tab.id === secondaryTabId && splitMode === 'split';
              const isActive = isPrimary || isSecondary;

              return (
                <div
                  key={tab.id}
                  onClick={() => setPrimaryTabId(tab.id)}
                  className={`group flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono cursor-pointer transition-all border flex-shrink-0 ${
                    isActive
                      ? 'bg-[#1e202e] text-white border-blue-500/40 shadow-sm'
                      : 'bg-[#15161d] text-gray-400 border-transparent hover:bg-[#1a1c26] hover:text-gray-200'
                  }`}
                >
                  {tab.type === 'local' ? (
                    <Terminal size={12} className="text-emerald-400" />
                  ) : tab.type === 'sftp' ? (
                    <FolderTree size={12} className="text-amber-400" />
                  ) : (
                    <Server size={12} className="text-blue-400" />
                  )}
                  <span className="truncate max-w-[120px]">{tab.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="opacity-60 hover:opacity-100 hover:text-red-400 rounded p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            {/* New tab quick button */}
            <button
              onClick={() => spawnLocalTerminal('powershell')}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#1a1c26] flex-shrink-0"
              title="Open New Local Terminal"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Right Toolbar */}
          <div className="flex items-center gap-1.5 pl-2 flex-shrink-0">
            {tabs.length > 1 && (
              <button
                onClick={() => setSplitMode(splitMode === 'single' ? 'split' : 'single')}
                className={`p-1.5 rounded transition-colors text-xs flex items-center gap-1 ${
                  splitMode === 'split'
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-[#1a1c26]'
                }`}
                title="Toggle Split View"
              >
                {splitMode === 'split' ? <Columns size={14} /> : <Square size={14} />}
              </button>
            )}
          </div>
        </div>

        {/* Workspace Body */}
        <div className="flex-1 flex overflow-hidden relative">
          {tabs.length === 0 ? (
            /* Welcome / Empty State Screen */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0d0e13]">
              <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-6 shadow-xl">
                <Terminal size={32} />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Ready to Connect</h2>
              <p className="text-xs text-gray-400 max-w-md mb-8">
                Connect to any SSH server on the fly without saving, or add your servers to the sidebar for instant one-click access.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-xl">
                {/* Quick Connect Card */}
                <div
                  onClick={() => setIsQuickConnectOpen(true)}
                  className="p-4 rounded-xl bg-[#121318] hover:bg-[#181a22] border border-[#1f222e] hover:border-amber-500/40 cursor-pointer transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3">
                    <Zap size={16} />
                  </div>
                  <h3 className="font-semibold text-white text-xs mb-1 group-hover:text-amber-300">
                    Quick Connect
                  </h3>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    Connect immediately to an IP or host without saving it.
                  </p>
                </div>

                {/* Add Device Card */}
                <div
                  onClick={openAddDeviceModal}
                  className="p-4 rounded-xl bg-[#121318] hover:bg-[#181a22] border border-[#1f222e] hover:border-blue-500/40 cursor-pointer transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-3">
                    <Plus size={16} />
                  </div>
                  <h3 className="font-semibold text-white text-xs mb-1 group-hover:text-blue-300">
                    Add Device
                  </h3>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    Save a device to your sidebar list for 1-click access.
                  </p>
                </div>

                {/* Local Shell Card */}
                <div
                  onClick={() => spawnLocalTerminal('powershell')}
                  className="p-4 rounded-xl bg-[#121318] hover:bg-[#181a22] border border-[#1f222e] hover:border-emerald-500/40 cursor-pointer transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-3">
                    <Terminal size={16} />
                  </div>
                  <h3 className="font-semibold text-white text-xs mb-1 group-hover:text-emerald-300">
                    Local Terminal
                  </h3>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    Open PowerShell or CMD directly on your computer.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Terminal Panes */
            <div className="flex-1 flex overflow-hidden">
              {primaryTab && (
                <div className="flex-1 flex h-full overflow-hidden">
                  <TerminalView
                    key={primaryTab.id}
                    tab={primaryTab}
                    active={true}
                    onExit={() => closeTab(primaryTab.id)}
                    onRetry={() => retryTab(primaryTab)}
                  />
                </div>
              )}

              {splitMode === 'split' && secondaryTab && (
                <div className="flex-1 flex h-full overflow-hidden border-l border-[#1f222e]">
                  <TerminalView
                    key={secondaryTab.id}
                    tab={secondaryTab}
                    active={true}
                    onExit={() => closeTab(secondaryTab.id)}
                    onRetry={() => retryTab(secondaryTab)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* QUICK CONNECT MODAL (CONNECT WITHOUT SAVING) */}
      {isQuickConnectOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121318] border border-[#1f222e] rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#1f222e] flex items-center justify-between bg-[#15161f]">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Zap size={15} />
                </div>
                <div>
                  <h2 className="font-bold text-white text-sm">Quick Connect</h2>
                  <p className="text-[11px] text-gray-400">Connect to SSH without saving</p>
                </div>
              </div>
              <button
                onClick={() => setIsQuickConnectOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#1f222e]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleQuickConnect} className="p-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-gray-300 font-medium mb-1">Host / IP *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="192.168.1.1 or example.com"
                    value={qcAddress}
                    onChange={(e) => setQcAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Port</label>
                  <input
                    type="number"
                    value={qcPort}
                    onChange={(e) => setQcPort(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Username</label>
                <input
                  type="text"
                  placeholder="root"
                  value={qcUsername}
                  onChange={(e) => setQcUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Authentication</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setQcAuthType('password')}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-medium transition-colors ${
                      qcAuthType === 'password'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-[#0d0e13] border-[#1f222e] text-gray-400 hover:text-white'
                    }`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    onClick={() => setQcAuthType('key')}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-medium transition-colors ${
                      qcAuthType === 'key'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-[#0d0e13] border-[#1f222e] text-gray-400 hover:text-white'
                    }`}
                  >
                    Private Key
                  </button>
                </div>
              </div>

              {qcAuthType === 'password' ? (
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={qcShowPassword ? 'text' : 'password'}
                      placeholder="Enter password"
                      value={qcPassword}
                      onChange={(e) => setQcPassword(e.target.value)}
                      className="w-full pl-3 pr-9 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setQcShowPassword(!qcShowPassword)}
                      className="absolute right-2.5 top-2.5 text-gray-400 hover:text-white"
                    >
                      {qcShowPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Private Key Path</label>
                  <input
                    type="text"
                    placeholder="C:\Users\username\.ssh\id_rsa"
                    value={qcKeyPath}
                    onChange={(e) => setQcKeyPath(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f222e]">
                <button
                  type="button"
                  onClick={() => setIsQuickConnectOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#1f222e] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg shadow-md transition-all active:scale-[0.98]"
                >
                  <Zap size={14} />
                  Connect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT DEVICE MODAL (SAVED TO VAULT) */}
      {isDeviceModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121318] border border-[#1f222e] rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#1f222e] flex items-center justify-between bg-[#15161f]">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
                  <Server size={15} />
                </div>
                <div>
                  <h2 className="font-bold text-white text-sm">
                    {editingDevice ? 'Edit Device' : 'Add New Device'}
                  </h2>
                  <p className="text-[11px] text-gray-400">Save device for quick 1-click connection</p>
                </div>
              </div>
              <button
                onClick={() => setIsDeviceModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#1f222e]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveDevice} className="p-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-gray-300 font-medium mb-1">Device Name / Label</label>
                <input
                  type="text"
                  placeholder="e.g. Home Router, Ubuntu Server"
                  value={devLabel}
                  onChange={(e) => setDevLabel(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-gray-300 font-medium mb-1">Host / IP *</label>
                  <input
                    type="text"
                    required
                    placeholder="192.168.1.1 or myserver.com"
                    value={devAddress}
                    onChange={(e) => setDevAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Port</label>
                  <input
                    type="number"
                    value={devPort}
                    onChange={(e) => setDevPort(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Username</label>
                <input
                  type="text"
                  placeholder="root"
                  value={devUsername}
                  onChange={(e) => setDevUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Authentication</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDevAuthType('password')}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-medium transition-colors ${
                      devAuthType === 'password'
                        ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                        : 'bg-[#0d0e13] border-[#1f222e] text-gray-400 hover:text-white'
                    }`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    onClick={() => setDevAuthType('key')}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-medium transition-colors ${
                      devAuthType === 'key'
                        ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                        : 'bg-[#0d0e13] border-[#1f222e] text-gray-400 hover:text-white'
                    }`}
                  >
                    Private Key
                  </button>
                </div>
              </div>

              {devAuthType === 'password' ? (
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={devShowPassword ? 'text' : 'password'}
                      placeholder="Enter password (stored encrypted on disk)"
                      value={devPassword}
                      onChange={(e) => setDevPassword(e.target.value)}
                      className="w-full pl-3 pr-9 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setDevShowPassword(!devShowPassword)}
                      className="absolute right-2.5 top-2.5 text-gray-400 hover:text-white"
                    >
                      {devShowPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Private Key Path</label>
                  <input
                    type="text"
                    placeholder="C:\Users\username\.ssh\id_rsa"
                    value={devKeyPath}
                    onChange={(e) => setDevKeyPath(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0d0e13] border border-[#1f222e] rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Color Tag Picker */}
              <div>
                <label className="block text-gray-300 font-medium mb-1">Color Tag</label>
                <div className="flex items-center gap-2">
                  {['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ef4444'].map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setDevColor(color)}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform ${
                        devColor === color ? 'scale-110 ring-2 ring-white/50' : 'opacity-70 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: color }}
                    >
                      {devColor === color && <Check size={12} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f222e]">
                <button
                  type="button"
                  onClick={() => setIsDeviceModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#1f222e] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shadow-md transition-all active:scale-[0.98]"
                >
                  {editingDevice ? 'Save Changes' : 'Add Device'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CLOUD SYNC MODAL */}
      {isSyncModalOpen && (
        <SyncModal
          isOpen={isSyncModalOpen}
          onClose={() => setIsSyncModalOpen(false)}
          currentUserEmail={currentUserEmail}
          onAuthChange={(email) => setCurrentEmail(email)}
        />
      )}
    </div>
  );
}
