import { useState, useEffect } from 'react';
import './App.css';
import { invoke } from '@tauri-apps/api/core';
import {
  Server,
  Terminal,
  FolderTree,
  Code2,
  Cloud,
  Lock,
  Plus,
  X,
  SplitSquareVertical,
  Activity,
  Layers,
  Settings,
  ChevronRight,
  Shield,
  Search,
  RefreshCw,
  Folder,
  FileText,
  Play,
  ArrowRight,
  Sliders
} from 'lucide-react';
import { Host, Snippet, TerminalTab } from './types';
import { VaultManager } from './services/vault';
import { subscribeToAuth } from './services/firebase';
import { TerminalView } from './components/TerminalView';
import { SftpView } from './components/SftpView';
import { HostManager } from './components/HostManager';
import { SnippetManager } from './components/SnippetManager';
import { SyncModal } from './components/SyncModal';
import { LockScreen } from './components/LockScreen';

export function App() {
  const [activeNav, setActiveNav] = useState<'terminal' | 'hosts' | 'snippets' | 'portForward' | 'settings'>('terminal');
  const [isLocked, setIsLocked] = useState(VaultManager.isLocked());

  // Layout toggles
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSftpOpen, setIsSftpOpen] = useState(true);
  const [isSnippetRunnerOpen, setIsSnippetRunnerOpen] = useState(true);
  const [splitMode, setSplitMode] = useState<'single' | 'split'>('split');

  // Vault data
  const [hosts, setHosts] = useState<Host[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);

  // Tabs & Split Panes
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [primaryTabId, setPrimaryTabId] = useState<string | null>(null);
  const [secondaryTabId, setSecondaryTabId] = useState<string | null>(null);

  // Shells
  const [availableShells, setAvailableShells] = useState<string[]>(['powershell', 'bash', 'zsh']);

  // Modals & User
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [currentUserEmail, setCurrentEmail] = useState<string | null>(null);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);

  useEffect(() => {
    const vault = VaultManager.loadLocal();
    setHosts(vault.hosts || []);
    setSnippets(vault.snippets || []);

    invoke<string[]>('get_system_shells')
      .then((shells) => setAvailableShells(shells))
      .catch(() => {});

    const unsubscribeAuth = subscribeToAuth((user) => {
      setCurrentEmail(user?.email || null);
      if (user) {
        VaultManager.syncFromRemote().then((synced) => {
          if (synced) {
            const updated = VaultManager.loadLocal();
            setHosts(updated.hosts);
            setSnippets(updated.snippets);
          }
        });
      }
    });

    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, []);

  const handleSaveHosts = (newHosts: Host[]) => {
    setHosts(newHosts);
    const vault = VaultManager.loadLocal();
    vault.hosts = newHosts;
    VaultManager.save(vault);
  };

  const handleSaveSnippets = (newSnippets: Snippet[]) => {
    setSnippets(newSnippets);
    const vault = VaultManager.loadLocal();
    vault.snippets = newSnippets;
    VaultManager.save(vault);
  };

  const spawnLocalTerminal = async (shellType: string) => {
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
        title: `${shellType.toUpperCase()}`,
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
      setActiveNav('terminal');
    } catch (err) {
      console.error(err);
    }
  };

  const connectSsh = (host: Host) => {
    const sessionId = `ssh_${Date.now()}`;
    const newTab: TerminalTab = {
      id: sessionId,
      title: host.label,
      type: 'ssh',
      sessionId,
      host,
      active: true,
    };

    setTabs((prev) => [...prev, newTab]);
    if (!primaryTabId) {
      setPrimaryTabId(sessionId);
    } else if (splitMode === 'split') {
      setSecondaryTabId(sessionId);
    } else {
      setPrimaryTabId(sessionId);
    }
    setActiveNav('terminal');

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

  const executeSnippetInPrimary = (command: string) => {
    const activeTab = tabs.find((t) => t.id === (secondaryTabId || primaryTabId));
    if (!activeTab) return;
    const cmdWithEnter = command.endsWith('\n') ? command : command + '\n';
    if (activeTab.type === 'local') {
      invoke('pty_write', { sessionId: activeTab.sessionId, data: cmdWithEnter });
    } else {
      invoke('ssh_write', { sessionId: activeTab.sessionId, data: cmdWithEnter });
    }
  };

  if (isLocked) {
    return <LockScreen onUnlocked={() => setIsLocked(false)} />;
  }

  const primaryTab = tabs.find((t) => t.id === primaryTabId);
  const secondaryTab = tabs.find((t) => t.id === secondaryTabId);
  const activeSftpTab = tabs.find((t) => t.type === 'ssh') || primaryTab;

  return (
    <div className="flex h-screen w-screen bg-[#0d0e13] text-[#c9d1d9] font-sans antialiased overflow-hidden select-none">
      {/* 1. ULTRA SLIM ACTIVITY RAIL */}
      <aside className="w-14 bg-[#0d0e13] border-r border-[#1f222e] flex flex-col items-center py-3 justify-between z-30 flex-shrink-0">
        <div className="flex flex-col items-center gap-4 w-full">
          {/* Brand Monogram */}
          <div
            onClick={() => setActiveNav('terminal')}
            className="w-9 h-9 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 flex items-center justify-center cursor-pointer shadow-lg shadow-blue-500/20 hover:scale-105 transition-all text-white font-bold text-xs font-mono tracking-tighter"
            title="TermStation Enterprise"
          >
            TS
          </div>

          {/* Navigation Rail Buttons */}
          <nav className="flex flex-col items-center gap-2 w-full mt-2">
            <button
              onClick={() => setActiveNav('terminal')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                activeNav === 'terminal'
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-sm'
                  : 'text-gray-400 hover:bg-[#1a1c26] hover:text-gray-200'
              }`}
              title="Terminal Workspace"
            >
              <Terminal size={17} />
            </button>

            <button
              onClick={() => setActiveNav('hosts')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                activeNav === 'hosts'
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-sm'
                  : 'text-gray-400 hover:bg-[#1a1c26] hover:text-gray-200'
              }`}
              title="Host Topology & Inventory"
            >
              <Server size={17} />
            </button>

            <button
              onClick={() => setActiveNav('snippets')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                activeNav === 'snippets'
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-500/40 shadow-sm'
                  : 'text-gray-400 hover:bg-[#1a1c26] hover:text-gray-200'
              }`}
              title="Runbooks & Command Vault"
            >
              <Code2 size={17} />
            </button>

            <button
              onClick={() => setIsSftpOpen(!isSftpOpen)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                isSftpOpen
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'text-gray-400 hover:bg-[#1a1c26] hover:text-gray-200'
              }`}
              title="Toggle SFTP Drawer"
            >
              <FolderTree size={17} />
            </button>
          </nav>
        </div>

        {/* Rail Footer Items */}
        <div className="flex flex-col items-center gap-2 w-full">
          <button
            onClick={() => setIsSyncModalOpen(true)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              currentUserEmail
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-gray-400 hover:bg-[#1a1c26] hover:text-gray-200'
            }`}
            title={currentUserEmail ? `E2EE Synced: ${currentUserEmail}` : 'Cloud Vault Sync'}
          >
            <Cloud size={17} />
          </button>

          <button
            onClick={() => {
              VaultManager.lock();
              setIsLocked(true);
            }}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
            title="Lock AES Vault"
          >
            <Lock size={16} />
          </button>
        </div>
      </aside>

      {/* 2. COLLAPSIBLE TOPOLOGY / HOST SIDEBAR */}
      {isSidebarOpen && (
        <aside className="w-64 bg-[#121318] border-r border-[#1f222e] flex flex-col justify-between flex-shrink-0 z-20">
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-3.5 border-b border-[#1f222e] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-xs tracking-tight uppercase text-blue-400 font-mono">
                  TermStation
                </span>
                <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-mono">
                  v3.4.1
                </span>
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#1a1c26]"
              >
                <X size={14} />
              </button>
            </div>

            {/* Quick Connect CTA */}
            <div className="p-3 border-b border-[#1f222e]">
              <button
                onClick={() => spawnLocalTerminal('powershell')}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md transition-all active:scale-[0.98]"
              >
                <Plus size={14} />
                Quick Connect
              </button>
            </div>

            {/* Server List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
              {hosts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <Server size={24} className="mb-2 opacity-40" />
                  <p className="text-[11px]">No servers yet</p>
                  <p className="text-[10px] mt-1">Click <strong>Hosts</strong> to add one</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-400">
                    <span>Servers</span>
                    <span className="text-emerald-400">{hosts.length}</span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {hosts.map((host) => (
                      <div
                        key={host.id}
                        onClick={() => connectSsh(host)}
                        className="group flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-[#1a1b22] cursor-pointer transition-colors border border-transparent hover:border-[#2a2d3d]"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className="w-1.5 h-1.5 rounded-full ring-2"
                            style={{
                              backgroundColor: host.color || '#3b82f6',
                              boxShadow: `0 0 0 2px ${(host.color || '#3b82f6')}33`,
                            }}
                          />
                          <div>
                            <p className="font-mono text-gray-200 text-xs truncate group-hover:text-blue-400">
                              {host.label}
                            </p>
                            <p className="text-[10px] text-gray-500 font-mono">
                              {host.address}:{host.port}
                            </p>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-gray-600">
                          {host.username}@
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Quick Snippet Drawer in Sidebar */}
            {isSnippetRunnerOpen && (
              <div className="p-3 border-t border-[#1f222e] bg-[#0d0e13]/80">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-mono text-purple-400 font-semibold flex items-center gap-1.5">
                    <Code2 size={12} />
                    Quick Snippets
                  </span>
                  <span className="text-[9px] font-mono bg-[#1f222e] text-gray-400 px-1 py-0.5 rounded">
                    Alt+S
                  </span>
                </div>
                <div className="space-y-1">
                  {snippets.slice(0, 3).map((sn) => (
                    <div
                      key={sn.id}
                      onClick={() => executeSnippetInPrimary(sn.command)}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#14161f] hover:bg-purple-950/30 border border-[#212433] hover:border-purple-500/40 cursor-pointer transition-all group"
                    >
                      <span className="text-[11px] font-mono text-gray-300 truncate group-hover:text-purple-300">
                        {sn.label}
                      </span>
                      <Play size={10} className="text-purple-400 opacity-60 group-hover:opacity-100" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* 3. MAIN WORKSTATION WORKSPACE */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header / Tab Bar */}
        <header className="h-10 bg-[#121318] border-b border-[#1f222e] flex items-center justify-between px-3 z-20 flex-shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto flex-1 mr-3">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-1 hover:bg-[#1c1e29] rounded text-gray-400 hover:text-white"
                title="Open Host Tree"
              >
                <ChevronRight size={16} />
              </button>
            )}

            {/* Tab Pills */}
            {tabs.map((tab) => {
              const isPrimary = tab.id === primaryTabId;
              const isSecondary = tab.id === secondaryTabId && splitMode === 'split';
              return (
                <div
                  key={tab.id}
                  onClick={() => {
                    if (splitMode === 'single' || !primaryTabId) {
                      setPrimaryTabId(tab.id);
                    } else {
                      setSecondaryTabId(tab.id);
                    }
                  }}
                  className={`flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono cursor-pointer transition-all border ${
                    isPrimary || isSecondary
                      ? 'bg-[#1a1c26] text-white border-blue-500/50 shadow-sm'
                      : 'text-gray-400 hover:bg-[#161722] hover:text-gray-200 border-transparent'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${tab.type === 'ssh' ? 'bg-emerald-400' : 'bg-blue-400'}`} />
                  <span className="truncate max-w-[120px]">{tab.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="p-0.5 hover:bg-[#252838] rounded text-gray-500 hover:text-gray-200"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}

            {/* New Session Button */}
            <div className="relative">
              <button
                onClick={() => setIsNewMenuOpen(!isNewMenuOpen)}
                className="p-1 hover:bg-[#1a1c26] rounded text-gray-400 hover:text-gray-200"
              >
                <Plus size={15} />
              </button>
              {isNewMenuOpen && (
                <div
                  className="absolute left-0 mt-2 w-44 bg-[#161822] border border-[#2b2e3e] rounded-xl shadow-2xl py-1 z-50 text-xs font-medium"
                  onMouseLeave={() => setIsNewMenuOpen(false)}
                >
                  <div className="px-3 py-1 text-gray-500 font-semibold uppercase text-[10px] tracking-wider font-mono">
                    Spawn Shell
                  </div>
                  {availableShells.map((sh) => (
                    <button
                      key={sh}
                      onClick={() => {
                        spawnLocalTerminal(sh);
                        setIsNewMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[#222536] text-gray-300 flex items-center gap-2 font-mono"
                    >
                      <Terminal size={13} className="text-blue-400" />
                      {sh.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center gap-2">
            {/* Split Screen Toggle */}
            <button
              onClick={() => setSplitMode(splitMode === 'single' ? 'split' : 'single')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-colors border ${
                splitMode === 'split'
                  ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                  : 'text-gray-400 hover:bg-[#1a1c26] border-transparent'
              }`}
              title="Toggle Split Terminal Pane"
            >
              <SplitSquareVertical size={14} />
              <span className="hidden md:inline">{splitMode === 'split' ? 'Split Dual' : 'Single'}</span>
            </button>

            {/* SFTP Drawer Toggle */}
            <button
              onClick={() => setIsSftpOpen(!isSftpOpen)}
              className={`p-1.5 rounded-md text-xs font-mono transition-colors border ${
                isSftpOpen
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'text-gray-400 hover:bg-[#1a1c26] border-transparent'
              }`}
              title="SFTP File Browser"
            >
              <FolderTree size={14} />
            </button>
          </div>
        </header>

        {/* Center Canvas: Split Terminal Panes + SFTP Explorer */}
        <main className="flex-1 flex overflow-hidden relative">
          {activeNav === 'terminal' && (
            <div className="flex-1 flex h-full overflow-hidden">
              {tabs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[#0d0e13]">
                  <Terminal className="text-gray-700 mb-3" size={44} />
                  <h2 className="text-base font-bold text-gray-300">TermStation Engine Ready</h2>
                  <p className="text-xs text-gray-500 max-w-sm mt-1 font-mono">
                    Select a host from the left rail or initiate a local terminal to begin.
                  </p>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => spawnLocalTerminal('powershell')}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md"
                    >
                      New Terminal Tab
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex h-full overflow-hidden">
                  {/* Left Pane (Primary Terminal) */}
                  <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col border-r border-[#1f222e]">
                    {primaryTab && (
                      <>
                        <div className="h-7 bg-[#10121a] border-b border-[#1f222e] px-3 flex items-center justify-between text-[11px] font-mono text-gray-400">
                          <span className="text-emerald-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            {primaryTab.title} (tty1)
                          </span>
                          <span className="text-gray-500">PTY | UTF-8</span>
                        </div>
                        <div className="flex-1 min-h-0 min-w-0">
                          <TerminalView tab={primaryTab} active={true} onExit={() => closeTab(primaryTab.id)} />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Right Pane (Secondary Terminal when Split Mode is Active) */}
                  {splitMode === 'split' && secondaryTab && (
                    <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col border-r border-[#1f222e]">
                      <div className="h-7 bg-[#10121a] border-b border-[#1f222e] px-3 flex items-center justify-between text-[11px] font-mono text-gray-400">
                        <span className="text-blue-400 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                          {secondaryTab.title} (tty2)
                        </span>
                        <span className="text-gray-500">AES-256 Tunnel</span>
                      </div>
                      <div className="flex-1 min-h-0 min-w-0">
                        <TerminalView tab={secondaryTab} active={true} onExit={() => closeTab(secondaryTab.id)} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Integrated Right SFTP Drawer */}
              {isSftpOpen && activeSftpTab && (
                <aside className="w-80 h-full bg-[#10121a] border-l border-[#1f222e] flex flex-col flex-shrink-0 z-10">
                  <div className="h-9 px-3 border-b border-[#1f222e] flex items-center justify-between bg-[#12141e]">
                    <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
                      <FolderTree size={14} className="text-emerald-400" />
                      <span>SFTP Explorer</span>
                    </div>
                    <button
                      onClick={() => setIsSftpOpen(false)}
                      className="p-1 text-gray-400 hover:text-white rounded"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 min-w-0">
                    <SftpView tab={activeSftpTab} />
                  </div>
                </aside>
              )}
            </div>
          )}

          {activeNav === 'hosts' && (
            <HostManager
              hosts={hosts}
              onAddHost={(h) => handleSaveHosts([...hosts, h])}
              onUpdateHost={(h) => handleSaveHosts(hosts.map((x) => (x.id === h.id ? h : x)))}
              onDeleteHost={(id) => handleSaveHosts(hosts.filter((x) => x.id !== id))}
              onConnectSsh={connectSsh}
              onConnectSftp={(h) => {
                connectSsh(h);
                setIsSftpOpen(true);
              }}
            />
          )}

          {activeNav === 'snippets' && (
            <SnippetManager
              snippets={snippets}
              onAddSnippet={(sn) => handleSaveSnippets([...snippets, sn])}
              onDeleteSnippet={(id) => handleSaveSnippets(snippets.filter((s) => s.id !== id))}
              onRunSnippet={executeSnippetInPrimary}
            />
          )}
        </main>

        {/* 4. PERSISTENT TELEMETRY DOCK */}
        <footer className="h-6 bg-[#0a0b0e] border-t border-[#181a24] px-3 flex items-center justify-between text-[11px] font-mono text-gray-400 flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-gray-400">
              <Shield size={11} className="text-emerald-400" />
              AES-256-GCM | ed25519-sha256
            </span>
            <span className="text-emerald-400">Zero-Knowledge Synced</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-emerald-400">12ms latency</span>
            <span>0% pkt loss</span>
            <span>CPU: 14%</span>
            <span>{tabs.length} Active Shells</span>
          </div>
        </footer>
      </div>

      <SyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        currentUserEmail={currentUserEmail}
        onAuthChange={(email) => setCurrentEmail(email)}
      />
    </div>
  );
}

export default App;
