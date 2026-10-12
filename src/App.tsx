import { useState, useEffect } from 'react';
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
  Monitor,
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
  const [activeView, setActiveView] = useState<'hosts' | 'terminal' | 'sftp' | 'snippets'>('hosts');
  const [isLocked, setIsLocked] = useState(VaultManager.isLocked());

  // Vault data
  const [hosts, setHosts] = useState<Host[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);

  // Tabs
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Shells
  const [availableShells, setAvailableShells] = useState<string[]>(['powershell', 'cmd']);

  // Modals & User
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [currentUserEmail, setCurrentEmail] = useState<string | null>(null);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);

  useEffect(() => {
    // Load local vault
    const vault = VaultManager.loadLocal();
    setHosts(vault.hosts);
    setSnippets(vault.snippets);

    // Fetch local available shells from Rust backend
    invoke<string[]>('get_system_shells')
      .then((shells) => setAvailableShells(shells))
      .catch(console.error);

    // Firebase Auth listener
    const unsubscribeAuth = subscribeToAuth((user) => {
      setCurrentEmail(user?.email || null);
      if (user) {
        // Attempt remote sync if master password available
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

  const handleAddHost = (host: Host) => {
    handleSaveHosts([...hosts, host]);
  };

  const handleUpdateHost = (host: Host) => {
    handleSaveHosts(hosts.map((h) => (h.id === host.id ? host : h)));
  };

  const handleDeleteHost = (id: string) => {
    handleSaveHosts(hosts.filter((h) => h.id !== id));
  };

  const handleSaveSnippets = (newSnippets: Snippet[]) => {
    setSnippets(newSnippets);
    const vault = VaultManager.loadLocal();
    vault.snippets = newSnippets;
    VaultManager.save(vault);
  };

  // Launch Local Shell (PowerShell, CMD, WSL)
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
      setActiveTabId(sessionId);
      setActiveView('terminal');
    } catch (err) {
      alert(`Error launching local terminal: ${err}`);
    }
  };

  // Launch SSH Session
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
    setActiveTabId(sessionId);
    setActiveView('terminal');

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
    }).catch((err) => {
      console.error(`Failed to initiate SSH: ${err}`);
    });
  };

  // Launch SFTP Session
  const connectSftp = async (host: Host) => {
    // Check if we already have an active SSH session for this host
    const existing = tabs.find((t) => t.type === 'ssh' && t.host?.id === host.id);
    let sessionId = existing?.sessionId;

    if (!sessionId) {
      sessionId = `sftp_sess_${Date.now()}`;
      try {
        await invoke('ssh_connect', {
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
            cols: 80,
            rows: 24,
          },
        });
      } catch (err) {
        alert(`Failed to start SFTP connection: ${err}`);
        return;
      }
    }

    const sftpTabId = `sftp_${sessionId}`;
    const sftpTab: TerminalTab = {
      id: sftpTabId,
      title: `SFTP: ${host.label}`,
      type: 'sftp',
      sessionId,
      host,
      active: true,
    };

    setTabs((prev) => [...prev, sftpTab]);
    setActiveTabId(sftpTabId);
    setActiveView('sftp');
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
    if (activeTabId === id) {
      if (updated.length > 0) {
        setActiveTabId(updated[updated.length - 1].id);
        setActiveView(updated[updated.length - 1].type === 'sftp' ? 'sftp' : 'terminal');
      } else {
        setActiveTabId(null);
        setActiveView('hosts');
      }
    }
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (isLocked) {
    return <LockScreen onUnlocked={() => setIsLocked(false)} />;
  }

  return (
    <div className="flex h-screen w-screen bg-[#0d1117] text-[#c9d1d9] overflow-hidden select-none">
      {/* 1. Sleek Termius-style Left Sidebar */}
      <aside className="w-16 bg-[#161b22] border-r border-[#30363d] flex flex-col items-center py-4 justify-between z-20 flex-shrink-0">
        <div className="flex flex-col items-center gap-6 w-full">
          {/* Brand Logo */}
          <div
            onClick={() => setActiveView('hosts')}
            className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center cursor-pointer shadow-lg shadow-blue-500/20 hover:scale-105 transition-transform"
            title="Termius Reloaded"
          >
            <Terminal className="text-white" size={22} />
          </div>

          {/* Navigation Items */}
          <nav className="flex flex-col items-center gap-3 w-full">
            <button
              onClick={() => setActiveView('hosts')}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                activeView === 'hosts'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-gray-400 hover:bg-[#21262d] hover:text-gray-200'
              }`}
              title="Hosts & Servers"
            >
              <Server size={20} />
            </button>

            <button
              onClick={() => {
                if (tabs.length > 0) {
                  setActiveView(activeTab?.type === 'sftp' ? 'sftp' : 'terminal');
                } else {
                  spawnLocalTerminal('powershell');
                }
              }}
              className={`w-11 h-11 rounded-xl flex items-center justify-center relative transition-all ${
                activeView === 'terminal' || activeView === 'sftp'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-gray-400 hover:bg-[#21262d] hover:text-gray-200'
              }`}
              title="Active Terminals"
            >
              <Monitor size={20} />
              {tabs.length > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#161b22]" />
              )}
            </button>

            <button
              onClick={() => setActiveView('snippets')}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                activeView === 'snippets'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
                  : 'text-gray-400 hover:bg-[#21262d] hover:text-gray-200'
              }`}
              title="Snippets & Scripts"
            >
              <Code2 size={20} />
            </button>
          </nav>
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-col items-center gap-3 w-full">
          {/* Cloud Sync & Firebase status */}
          <button
            onClick={() => setIsSyncModalOpen(true)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              currentUserEmail
                ? 'text-emerald-400 hover:bg-emerald-500/20'
                : 'text-gray-400 hover:bg-[#21262d] hover:text-gray-200'
            }`}
            title={currentUserEmail ? `Cloud Sync Active (${currentUserEmail})` : 'Cloud Sync & Vault'}
          >
            <Cloud size={20} />
          </button>

          {/* Master Password Lock */}
          <button
            onClick={() => {
              VaultManager.lock();
              setIsLocked(true);
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-[#21262d] hover:text-gray-200 transition-colors"
            title="Lock Vault"
          >
            <Lock size={18} />
          </button>
        </div>
      </aside>

      {/* 2. Main Work Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header / Tab Bar */}
        <header className="h-11 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-3 z-10">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto h-full scrollbar-none flex-1 mr-4">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => {
                  setActiveTabId(tab.id);
                  setActiveView(tab.type === 'sftp' ? 'sftp' : 'terminal');
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all border ${
                  activeTabId === tab.id
                    ? 'bg-[#0d1117] text-white border-[#30363d] shadow-sm'
                    : 'text-gray-400 hover:bg-[#21262d] hover:text-gray-200 border-transparent'
                }`}
              >
                {tab.type === 'sftp' ? (
                  <FolderTree size={14} className="text-yellow-400" />
                ) : (
                  <Terminal size={14} className="text-blue-400" />
                )}
                <span className="truncate max-w-[130px] font-mono">{tab.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="p-0.5 hover:bg-[#30363d] rounded text-gray-500 hover:text-gray-200"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {/* Quick "+" Menu */}
            <div className="relative">
              <button
                onClick={() => setIsNewMenuOpen(!isNewMenuOpen)}
                className="p-1.5 hover:bg-[#21262d] rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
                title="New Session"
              >
                <Plus size={16} />
              </button>

              {isNewMenuOpen && (
                <div
                  className="absolute left-0 mt-2 w-48 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl py-1 z-50 text-xs font-medium"
                  onMouseLeave={() => setIsNewMenuOpen(false)}
                >
                  <div className="px-3 py-1.5 text-gray-500 font-semibold uppercase text-[10px] tracking-wider">
                    Local Terminals
                  </div>
                  {availableShells.map((sh) => (
                    <button
                      key={sh}
                      onClick={() => {
                        spawnLocalTerminal(sh);
                        setIsNewMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#21262d] text-gray-300 flex items-center gap-2"
                    >
                      <Terminal size={14} className="text-blue-400" />
                      {sh.toUpperCase()}
                    </button>
                  ))}
                  <div className="border-t border-[#30363d] my-1" />
                  <button
                    onClick={() => {
                      setActiveView('hosts');
                      setIsNewMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[#21262d] text-gray-300 flex items-center gap-2"
                  >
                    <Server size={14} className="text-purple-400" />
                    Connect SSH Host...
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2">
            {currentUserEmail ? (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-mono text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                E2EE Synced
              </span>
            ) : (
              <span className="px-2 py-1 rounded bg-[#21262d] text-[11px] font-mono text-gray-400">
                Offline Mode
              </span>
            )}
          </div>
        </header>

        {/* 3. Main Stage Content */}
        <main className="flex-1 overflow-hidden relative">
          {activeView === 'hosts' && (
            <HostManager
              hosts={hosts}
              onAddHost={handleAddHost}
              onUpdateHost={handleUpdateHost}
              onDeleteHost={handleDeleteHost}
              onConnectSsh={connectSsh}
              onConnectSftp={connectSftp}
            />
          )}

          {activeView === 'snippets' && (
            <SnippetManager
              snippets={snippets}
              onAddSnippet={(sn) => handleSaveSnippets([...snippets, sn])}
              onDeleteSnippet={(id) => handleSaveSnippets(snippets.filter((s) => s.id !== id))}
              onRunSnippet={(cmd) => {
                if (activeTab && (activeTab.type === 'local' || activeTab.type === 'ssh')) {
                  const cmdWithEnter = cmd.endsWith('\n') ? cmd : cmd + '\n';
                  if (activeTab.type === 'local') {
                    invoke('pty_write', { sessionId: activeTab.sessionId, data: cmdWithEnter });
                  } else {
                    invoke('ssh_write', { sessionId: activeTab.sessionId, data: cmdWithEnter });
                  }
                  setActiveView('terminal');
                } else {
                  alert('Please open or select an active terminal tab first.');
                }
              }}
            />
          )}

          {activeView === 'terminal' && activeTab && activeTab.type !== 'sftp' && (
            <div className="w-full h-full min-h-0 min-w-0 overflow-hidden relative">
              {tabs
                .filter((t) => t.type !== 'sftp')
                .map((tab) => (
                  <div
                    key={tab.id}
                    className={`w-full h-full min-h-0 min-w-0 ${tab.id === activeTabId ? 'flex flex-col' : 'hidden'}`}
                  >
                    <TerminalView
                      tab={tab}
                      active={tab.id === activeTabId}
                      onExit={() => closeTab(tab.id)}
                    />
                  </div>
                ))}
            </div>
          )}

          {activeView === 'sftp' && activeTab && activeTab.type === 'sftp' && (
            <SftpView tab={activeTab} />
          )}

          {/* Empty state if in terminal view with no tabs open */}
          {(activeView === 'terminal' || activeView === 'sftp') && tabs.length === 0 && (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
              <Terminal className="text-gray-600 mb-4" size={48} />
              <h2 className="text-lg font-bold text-gray-300">No Active Terminal Sessions</h2>
              <p className="text-xs text-gray-500 max-w-sm mt-1">
                Open a local terminal or connect to a remote SSH host to begin working.
              </p>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => spawnLocalTerminal('powershell')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md"
                >
                  New PowerShell Tab
                </button>
                <button
                  onClick={() => setActiveView('hosts')}
                  className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-gray-300 rounded-lg text-xs font-semibold"
                >
                  View Saved Hosts
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Cloud Sync & Firebase Modal */}
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
