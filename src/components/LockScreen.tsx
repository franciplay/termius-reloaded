import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  ArrowRight,
  Terminal,
  KeyRound,
  Cpu,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Fingerprint
} from 'lucide-react';
import { VaultManager } from '../services/vault';

interface LockScreenProps {
  onUnlocked: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlocked }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(false);

    try {
      const success = await VaultManager.unlock(password);
      setLoading(false);

      if (success) {
        onUnlocked();
      } else {
        setError(true);
        setAttempts((prev) => prev + 1);
        setPassword('');
      }
    } catch (err) {
      setLoading(false);
      setError(true);
      setAttempts((prev) => prev + 1);
      setPassword('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0e13] text-[#c9d1d9] flex flex-col justify-between p-6 select-none font-sans overflow-hidden">
      {/* Background Subtle Grid & Ambient Glow */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 40%, rgba(59, 130, 246, 0.15) 0%, transparent 70%),
                            linear-gradient(to right, #1f222e 1px, transparent 1px),
                            linear-gradient(to bottom, #1f222e 1px, transparent 1px)`,
          backgroundSize: '100% 100%, 32px 32px, 32px 32px'
        }}
      />

      {/* Top Header Rail Bar */}
      <header className="relative z-10 flex items-center justify-between w-full max-w-5xl mx-auto px-4 py-2 border-b border-[#1f222e]/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white font-bold text-xs font-mono tracking-tighter">
            TS
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                TermStation Enterprise
              </span>
              <span className="text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded">
                v3.4.1
              </span>
            </div>
            <p className="text-[10px] text-gray-500 font-mono">
              Obsidian Cryptographic Enclave
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-mono bg-[#121318] border border-[#1f222e] px-2.5 py-1 rounded text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Hardware Security Module Active
          </span>
        </div>
      </header>

      {/* Main Vault Authentication Terminal Box */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md bg-[#121318] border border-[#1f222e] hover:border-[#2d3245] transition-all rounded-2xl p-7 shadow-2xl backdrop-blur-md relative overflow-hidden">
          {/* Subtle Top Accent Border */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400" />

          {/* Enclave Brand Badge */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3">
              <div className="w-14 h-14 rounded-2xl bg-[#0d0e13] border border-[#232736] flex items-center justify-center text-blue-400 shadow-inner group">
                <Lock size={24} className="group-hover:scale-105 transition-transform" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                <KeyRound size={10} />
              </div>
            </div>

            <h1 className="text-base font-bold text-white uppercase tracking-wider font-mono">
              Keyring Vault Locked
            </h1>
            <p className="text-xs text-gray-400 font-mono mt-1 max-w-xs leading-relaxed">
              Decryption key required to unlock SSH identities, bastions, and cloud sync.
            </p>
          </div>

          {/* Cryptographic Spec Badges */}
          <div className="mb-5 grid grid-cols-2 gap-2 text-[10px] font-mono text-gray-400">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#0a0b0e] border border-[#1b1d28] rounded-lg">
              <ShieldCheck size={13} className="text-emerald-400 flex-shrink-0" />
              <div className="truncate">
                <span className="text-gray-500 block text-[9px] uppercase">Cipher</span>
                <span className="text-gray-200">AES-256-GCM</span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#0a0b0e] border border-[#1b1d28] rounded-lg">
              <Cpu size={13} className="text-blue-400 flex-shrink-0" />
              <div className="truncate">
                <span className="text-gray-500 block text-[9px] uppercase">KDF</span>
                <span className="text-gray-200">Argon2id (64MB)</span>
              </div>
            </div>
          </div>

          {/* Unlock Form */}
          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-gray-400 mb-1.5">
                <label htmlFor="master-password" className="flex items-center gap-1.5">
                  <span>Master Password / Passphrase</span>
                </label>
                {attempts > 0 && (
                  <span className="text-[10px] text-amber-400 font-mono">
                    Attempt {attempts}
                  </span>
                )}
              </div>

              <div className="relative">
                <input
                  id="master-password"
                  type="password"
                  autoFocus
                  placeholder="Enter vault passphrase..."
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(false);
                  }}
                  className={`w-full bg-[#0a0b0e] border ${
                    error
                      ? 'border-red-500/80 focus:border-red-400 focus:ring-1 focus:ring-red-500/30'
                      : 'border-[#232736] focus:border-blue-500'
                  } rounded-xl px-3.5 py-2.5 text-xs text-gray-100 placeholder-gray-600 font-mono focus:outline-none transition-all shadow-inner`}
                />
              </div>
            </div>

            {/* Error Message Alert */}
            {error && (
              <div className="flex items-center gap-2 p-2.5 bg-red-950/40 border border-red-500/30 rounded-lg text-xs text-red-300 font-mono animate-shake">
                <ShieldAlert size={14} className="text-red-400 flex-shrink-0" />
                <span className="text-[11px]">Decryption failed. Invalid master password.</span>
              </div>
            )}

            {/* Submit Action Button */}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-mono font-semibold shadow-lg shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Deriving Key & Decrypting...</span>
                </>
              ) : (
                <>
                  <span>Decrypt & Unlock Enclave</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>

          {/* Biometric / Recovery Helper Info */}
          <div className="mt-5 pt-4 border-t border-[#1a1c27] flex items-center justify-between text-[10px] font-mono text-gray-500">
            <span className="flex items-center gap-1 hover:text-gray-400 transition-colors cursor-pointer">
              <Fingerprint size={12} className="text-gray-400" />
              Biometric bypass unavailable
            </span>
            <span className="text-gray-600">
              Zero-Knowledge Architecture
            </span>
          </div>
        </div>
      </main>

      {/* Bottom Telemetry Dock */}
      <footer className="relative z-10 w-full max-w-5xl mx-auto flex items-center justify-between px-4 py-2 border-t border-[#1f222e]/60 text-[10px] font-mono text-gray-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-gray-400">
            <ShieldCheck size={11} className="text-emerald-400" />
            Zero-Knowledge Enclave
          </span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-500">Memory-Hard Salt (Argon2id)</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-emerald-400">Host Memory Protected</span>
          <span className="text-gray-600">|</span>
          <span>Tauri Rust Core 2.0</span>
        </div>
      </footer>
    </div>
  );
};

export default LockScreen;
