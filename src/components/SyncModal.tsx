import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Lock,
  CheckCircle2,
  AlertTriangle,
  LogOut,
  X,
  KeyRound,
  ShieldCheck,
  Cpu,
  RefreshCw,
  Database,
  ArrowRight,
  Shield,
  Layers,
  Sparkles,
  Server,
  Fingerprint
} from 'lucide-react';
import {
  loginWithEmail,
  registerWithEmail,
  logoutUser,
  getStoredFirebaseConfig,
  saveFirebaseConfig,
} from '../services/firebase';
import { VaultManager } from '../services/vault';
import { FirebaseSyncSettings } from '../types';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserEmail: string | null;
  onAuthChange: (email: string | null) => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  currentUserEmail,
  onAuthChange,
}) => {
  const [activeTab, setActiveTab] = useState<'auth' | 'security' | 'config'>('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Master Password State
  const [masterPass, setMasterPass] = useState('');
  const [confirmMasterPass, setConfirmMasterPass] = useState('');

  // Firebase Config State
  const [apiKey, setApiKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [authDomain, setAuthDomain] = useState('');
  const [appId, setAppId] = useState('');

  // Telemetry simulation state
  const [lastSyncTime, setLastSyncTime] = useState<string>('Just now');
  const [syncingNow, setSyncingNow] = useState(false);

  useEffect(() => {
    const config = getStoredFirebaseConfig();
    if (config) {
      setApiKey(config.apiKey || '');
      setProjectId(config.projectId || '');
      setAuthDomain(config.authDomain || '');
      setAppId(config.appId || '');
    }
  }, []);

  if (!isOpen) return null;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (isRegister) {
        const u = await registerWithEmail(email, password);
        onAuthChange(u.email);
        setSuccess('Account provisioned and authenticated into cloud enclave.');
      } else {
        const u = await loginWithEmail(email, password);
        onAuthChange(u.email);
        setSuccess('Authentication successful. Enclave synchronization initiated.');
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    onAuthChange(null);
    setSuccess('Signed out of cloud enclave. Local vault remains intact.');
  };

  const handleManualSync = async () => {
    setSyncingNow(true);
    try {
      await VaultManager.syncFromRemote();
      setLastSyncTime('Just now');
      setSuccess('Vault successfully synchronized with E2EE cloud store.');
    } catch (err: any) {
      setError('Sync failed: ' + (err?.message || 'Network timeout'));
    } finally {
      setSyncingNow(false);
    }
  };

  const handleSetMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (masterPass.length < 8) {
      setError('Master passphrase must be at least 8 characters for Argon2id key derivation.');
      return;
    }
    if (masterPass !== confirmMasterPass) {
      setError('Master passphrases do not match.');
      return;
    }

    try {
      VaultManager.setMasterPassword(masterPass);
      const current = await VaultManager.loadLocal();
      await VaultManager.save(current);

      setSuccess('Zero-Knowledge key derived (Argon2id) and local vault re-encrypted with AES-256-GCM.');
      setMasterPass('');
      setConfirmMasterPass('');
    } catch (err: any) {
      setError('Failed to update encryption passphrase: ' + err?.message);
    }
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const config: FirebaseSyncSettings = {
      enabled: true,
      apiKey: apiKey.trim(),
      authDomain: authDomain.trim(),
      projectId: projectId.trim(),
      appId: appId.trim(),
    };
    saveFirebaseConfig(config);
    setSuccess('Custom Firebase cloud backend configuration persisted.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans">
      <div className="bg-[#121318] border border-[#1f222e] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden relative">
        {/* Subtle Top Accent Gradient Border */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400" />

        {/* Modal Header Toolbar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f222e] bg-[#0d0e13]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Cloud size={17} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                  Cloud Vault & E2EE Sync
                </h2>
                <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 rounded">
                  E2EE
                </span>
              </div>
              <p className="text-[11px] font-mono text-gray-500 mt-0.5">
                Zero-knowledge cross-device synchronization enclave
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#1a1c26] rounded-lg text-gray-400 hover:text-white transition-colors"
            title="Close dialog"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tab Navigation Rail */}
        <div className="flex border-b border-[#1f222e] bg-[#0f1016] px-3 pt-2 gap-1">
          <button
            onClick={() => {
              setActiveTab('auth');
              setError(null);
              setSuccess(null);
            }}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-mono font-medium rounded-t-lg border-t border-x transition-all ${
              activeTab === 'auth'
                ? 'bg-[#121318] text-blue-400 border-[#1f222e] border-b-transparent -mb-[1px] shadow-sm'
                : 'text-gray-400 border-transparent hover:text-gray-200 hover:bg-[#151620]'
            }`}
          >
            <Cloud size={13} />
            Account Auth
          </button>
          <button
            onClick={() => {
              setActiveTab('security');
              setError(null);
              setSuccess(null);
            }}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-mono font-medium rounded-t-lg border-t border-x transition-all ${
              activeTab === 'security'
                ? 'bg-[#121318] text-purple-400 border-[#1f222e] border-b-transparent -mb-[1px] shadow-sm'
                : 'text-gray-400 border-transparent hover:text-gray-200 hover:bg-[#151620]'
            }`}
          >
            <Lock size={13} />
            Master Key (E2EE)
          </button>
          <button
            onClick={() => {
              setActiveTab('config');
              setError(null);
              setSuccess(null);
            }}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-mono font-medium rounded-t-lg border-t border-x transition-all ${
              activeTab === 'config'
                ? 'bg-[#121318] text-cyan-400 border-[#1f222e] border-b-transparent -mb-[1px] shadow-sm'
                : 'text-gray-400 border-transparent hover:text-gray-200 hover:bg-[#151620]'
            }`}
          >
            <Database size={13} />
            Backend Config
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto bg-[#121318]">
          {/* Status Banners */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-500/30 rounded-lg text-xs text-red-300 font-mono">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 font-mono">
              <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* TAB 1: Firebase Account Auth */}
          {activeTab === 'auth' && (
            <div>
              {currentUserEmail ? (
                <div className="space-y-4">
                  {/* Active Cloud Profile Card */}
                  <div className="bg-[#0a0b0e] border border-[#1f222e] rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                        <ShieldCheck size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-white truncate max-w-[200px]">
                            {currentUserEmail}
                          </span>
                          <span className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 px-1.5 py-0.2 rounded border border-emerald-500/20">
                            ONLINE
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                          E2EE Realtime Sync Channel Active
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleManualSync}
                      disabled={syncingNow}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#171922] hover:bg-[#202330] border border-[#232736] text-gray-300 hover:text-white rounded-lg text-xs font-mono transition-all"
                      title="Sync Now"
                    >
                      <RefreshCw size={12} className={syncingNow ? 'animate-spin text-emerald-400' : ''} />
                      <span>{syncingNow ? 'Syncing...' : 'Sync Now'}</span>
                    </button>
                  </div>

                  {/* Sync Telemetry Badges */}
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-gray-400">
                    <div className="p-2.5 bg-[#0a0b0e] border border-[#1b1d28] rounded-lg">
                      <span className="text-gray-500 block text-[9px] uppercase">Last Remote Sync</span>
                      <span className="text-gray-200">{lastSyncTime}</span>
                    </div>
                    <div className="p-2.5 bg-[#0a0b0e] border border-[#1b1d28] rounded-lg">
                      <span className="text-gray-500 block text-[9px] uppercase">Enclave Cryptography</span>
                      <span className="text-emerald-400 font-semibold">AES-256-GCM + Argon2id</span>
                    </div>
                  </div>

                  {/* Disconnect Action */}
                  <div className="pt-2 border-t border-[#1f222e]">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-red-950/20 hover:bg-red-900/30 border border-red-500/30 text-red-300 rounded-lg text-xs font-mono font-medium transition-colors"
                    >
                      <LogOut size={13} />
                      Sign Out of Cloud Session
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleAuth} className="space-y-3.5">
                  <div className="p-3 bg-[#0a0b0e] border border-[#1f222e] rounded-xl flex items-start gap-2.5 text-xs text-gray-400 font-mono">
                    <Cloud size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      Authenticate to synchronize your encrypted host inventory and runbook vaults across Linux, macOS, and Windows.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-gray-400 mb-1">
                      Account Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="devsecops@enterprise.internal"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-gray-400 mb-1">
                      Account Password *
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setIsRegister(!isRegister)}
                      className="text-xs text-blue-400 hover:text-blue-300 font-mono underline cursor-pointer"
                    >
                      {isRegister ? 'Already have credentials? Sign In' : 'Provision New Cloud Account'}
                    </button>

                    <button
                      type="submit"
                      disabled={loading}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-mono font-semibold shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all active:scale-[0.98]"
                    >
                      {loading ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span>{isRegister ? 'Create Account' : 'Authenticate'}</span>
                          <ArrowRight size={13} />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 2: Master Password (Zero-Knowledge E2EE) */}
          {activeTab === 'security' && (
            <form onSubmit={handleSetMasterPassword} className="space-y-3.5">
              <div className="p-3.5 bg-purple-950/30 border border-purple-500/30 rounded-xl text-xs text-purple-300 flex items-start gap-2.5 font-mono">
                <Lock size={16} className="text-purple-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-white">Zero-Knowledge Client-Side Key Derivation</p>
                  <p className="text-[11px] text-purple-300/80 leading-relaxed">
                    Your Master Passphrase generates a local <strong>AES-256-GCM</strong> key via <strong>Argon2id</strong>. Firebase servers only store encrypted ciphertext; your keys never leave this workstation.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">
                  New Master Passphrase *
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter strong zero-knowledge master passphrase"
                  value={masterPass}
                  onChange={(e) => setMasterPass(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">
                  Confirm Master Passphrase *
                </label>
                <input
                  type="password"
                  required
                  placeholder="Re-enter master passphrase to confirm"
                  value={confirmMasterPass}
                  onChange={(e) => setConfirmMasterPass(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-mono font-semibold shadow-md shadow-purple-600/20 transition-all active:scale-[0.98]"
                >
                  <KeyRound size={13} />
                  Derive & Re-Encrypt Vault
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: Firebase Config */}
          {activeTab === 'config' && (
            <form onSubmit={handleSaveConfig} className="space-y-3.5">
              <div className="p-3 bg-[#0a0b0e] border border-[#1f222e] rounded-xl flex items-start gap-2.5 text-xs text-gray-400 font-mono">
                <Database size={16} className="text-cyan-400 flex-shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Bring Your Own Backend (BYOB): Connect any free Firebase project (Spark Plan) for completely autonomous, private synchronization.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">API Key</label>
                <input
                  type="text"
                  required
                  placeholder="AIzaSyB..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">Project ID</label>
                  <input
                    type="text"
                    required
                    placeholder="termstation-vault-prod"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">Auth Domain</label>
                  <input
                    type="text"
                    required
                    placeholder="termstation-vault.firebaseapp.com"
                    value={authDomain}
                    onChange={(e) => setAuthDomain(e.target.value)}
                    className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-gray-400 mb-1">App ID</label>
                <input
                  type="text"
                  required
                  placeholder="1:123456789:web:abcdef123"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="w-full bg-[#0a0b0e] border border-[#232736] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-mono font-semibold shadow-md shadow-cyan-600/20 transition-all active:scale-[0.98]"
                >
                  <Database size={13} />
                  Save Backend Settings
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Modal Telemetry Footer Dock */}
        <div className="px-5 py-3 bg-[#0a0b0e] border-t border-[#1f222e] flex items-center justify-between text-[10px] font-mono text-gray-500">
          <div className="flex items-center gap-2">
            <ShieldCheck size={12} className="text-emerald-400" />
            <span className="text-gray-400">Zero-Knowledge Cryptographic Enclave</span>
          </div>

          <div className="flex items-center gap-3">
            <span>Argon2id (64MB)</span>
            <span className="text-gray-600">|</span>
            <span className="text-emerald-400">AES-256-GCM Authenticated</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SyncModal;
