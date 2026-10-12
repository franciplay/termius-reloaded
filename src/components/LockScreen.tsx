import React, { useState } from 'react';
import { ShieldCheck, Lock, ArrowRight, AlertCircle } from 'lucide-react';
import { VaultManager } from '../services/vault';

interface LockScreenProps {
  onUnlocked: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlocked }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(false);

    const success = await VaultManager.unlock(password);
    setLoading(false);

    if (success) {
      onUnlocked();
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0d1117] flex flex-col items-center justify-center p-6 select-none">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center shadow-xl shadow-blue-500/10 mb-6">
          <Lock className="text-white" size={32} />
        </div>

        <h1 className="text-2xl font-bold text-white tracking-tight">Termius Reloaded</h1>
        <p className="text-xs text-gray-400 mt-2">
          Your vault is protected with AES-256-GCM encryption. Enter your Master Password to unlock your servers.
        </p>

        <form onSubmit={handleUnlock} className="w-full mt-6 space-y-3">
          <div className="relative">
            <input
              type="password"
              autoFocus
              placeholder="Master Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(false);
              }}
              className={`w-full bg-[#161b22] border ${
                error ? 'border-red-500 ring-1 ring-red-500' : 'border-[#30363d] focus:border-blue-500'
              } rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none transition-all`}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center justify-center gap-1">
              <AlertCircle size={14} /> Incorrect Master Password.
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-600/20 disabled:opacity-50 transition-all active:scale-95"
          >
            {loading ? 'Decrypting...' : 'Unlock Vault'}
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-8">
          <ShieldCheck size={14} className="text-green-500" />
          <span>Zero-Knowledge End-to-End Encryption</span>
        </div>
      </div>
    </div>
  );
};
