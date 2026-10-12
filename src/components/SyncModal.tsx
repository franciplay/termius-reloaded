import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Lock,
  CheckCircle,
  AlertCircle,
  LogOut,
  X,
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

  useEffect(() => {
    const config = getStoredFirebaseConfig();
    if (config) {
      setApiKey(config.apiKey);
      setProjectId(config.projectId);
      setAuthDomain(config.authDomain);
      setAppId(config.appId);
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
        setSuccess('Account created and logged in!');
      } else {
        const u = await loginWithEmail(email, password);
        onAuthChange(u.email);
        setSuccess('Successfully logged in!');
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    onAuthChange(null);
    setSuccess('Logged out successfully');
  };

  const handleSetMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (masterPass.length < 6) {
      setError('Master Password must be at least 6 characters long');
      return;
    }
    if (masterPass !== confirmMasterPass) {
      setError('Passwords do not match');
      return;
    }

    VaultManager.setMasterPassword(masterPass);
    // Trigger encryption and sync
    const current = VaultManager.loadLocal();
    await VaultManager.save(current);

    setSuccess('Master password configured and vault encrypted!');
    setMasterPass('');
    setConfirmMasterPass('');
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const config: FirebaseSyncSettings = {
      enabled: true,
      apiKey: apiKey.trim(),
      authDomain: authDomain.trim(),
      projectId: projectId.trim(),
      appId: appId.trim(),
    };
    saveFirebaseConfig(config);
    setSuccess('Firebase configuration saved!');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#30363d] bg-[#0d1117]">
          <div className="flex items-center gap-2.5">
            <Cloud className="text-blue-500" size={22} />
            <h2 className="text-base font-bold text-white">Cloud Sync & Security</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#30363d] rounded text-gray-400 hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#30363d] bg-[#161b22]">
          <button
            onClick={() => setActiveTab('auth')}
            className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-all ${
              activeTab === 'auth'
                ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Firebase Account
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-all ${
              activeTab === 'security'
                ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Master Password (E2EE)
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-all ${
              activeTab === 'config'
                ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Firebase Config
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-950/60 border border-red-500/50 rounded-lg text-xs text-red-300">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-950/60 border border-green-500/50 rounded-lg text-xs text-green-300">
              <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* TAB 1: Firebase Auth */}
          {activeTab === 'auth' && (
            <div>
              {currentUserEmail ? (
                <div className="space-y-4 text-center py-4">
                  <div className="w-14 h-14 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto">
                    <Cloud size={28} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">Signed in as</h3>
                    <p className="text-sm font-mono text-gray-300 mt-1">{currentUserEmail}</p>
                    <p className="text-xs text-gray-500 mt-2">
                      Zero-knowledge cloud sync is active across your devices.
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="flex items-center justify-center gap-2 w-full py-2 bg-[#21262d] hover:bg-red-500/20 text-gray-300 hover:text-red-400 rounded-lg text-xs font-semibold transition-colors"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              ) : (
                <form onSubmit={handleAuth} className="space-y-3">
                  <p className="text-xs text-gray-400">
                    Sign in with your Firebase account to sync servers and snippets across Windows, Linux, and Android.
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      placeholder="you@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1">Password</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setIsRegister(!isRegister)}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      {isRegister ? 'Already have an account? Sign In' : 'Need an account? Register'}
                    </button>

                    <button
                      type="submit"
                      disabled={loading}
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md disabled:opacity-50"
                    >
                      {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 2: Master Password */}
          {activeTab === 'security' && (
            <form onSubmit={handleSetMasterPassword} className="space-y-3">
              <div className="p-3 bg-purple-950/30 border border-purple-500/30 rounded-lg text-xs text-purple-300 flex items-start gap-2">
                <Lock size={16} className="flex-shrink-0 mt-0.5" />
                <span>
                  Your Master Password derives the <strong>AES-256-GCM</strong> key. Firebase never receives your password, meaning only you can decrypt your servers.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Master Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter a strong master password"
                  value={masterPass}
                  onChange={(e) => setMasterPass(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Confirm Master Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Re-enter master password"
                  value={confirmMasterPass}
                  onChange={(e) => setConfirmMasterPass(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold shadow-md"
                >
                  Set & Encrypt Vault
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: Firebase Config */}
          {activeTab === 'config' && (
            <form onSubmit={handleSaveConfig} className="space-y-3">
              <p className="text-xs text-gray-400">
                You can connect your own free Firebase project here (Firebase Spark Plan is 100% free).
              </p>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">API Key</label>
                <input
                  type="text"
                  required
                  placeholder="AIzaSy..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Project ID</label>
                  <input
                    type="text"
                    required
                    placeholder="my-termius-vault"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Auth Domain</label>
                  <input
                    type="text"
                    placeholder="my-termius-vault.firebaseapp.com"
                    value={authDomain}
                    onChange={(e) => setAuthDomain(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">App ID</label>
                <input
                  type="text"
                  required
                  placeholder="1:123456789:web:abcdef"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md"
                >
                  Save Configuration
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
