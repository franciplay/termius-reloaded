import { invoke } from '@tauri-apps/api/core';
import { Host, KeyIdentity, Snippet, PortForward, EncryptedVaultPayload } from '../types';
import { encryptVault, decryptVault } from './crypto';
import { uploadEncryptedVault, fetchRemoteEncryptedVault } from './firebase';

export interface VaultData {
  hosts: Host[];
  keys: KeyIdentity[];
  snippets: Snippet[];
  portForwards: PortForward[];
  version: number;
}

const VAULT_FILE = 'vault.json';
const ENCRYPTED_VAULT_FILE = 'vault.encrypted.json';

export class VaultManager {
  private static cachedData: VaultData | null = null;
  private static currentMasterPassword: string | null = null;

  public static isLocked(): boolean {
    // Check cached state — actual encrypted file check is async
    return Boolean(this._hasEncryptedFile && !this.currentMasterPassword);
  }

  // Track whether encrypted file exists (set during init)
  private static _hasEncryptedFile = false;

  public static hasMasterPassword(): boolean {
    return this._hasEncryptedFile;
  }

  public static setMasterPassword(password: string) {
    this.currentMasterPassword = password;
  }

  public static getMasterPassword(): string | null {
    return this.currentMasterPassword;
  }

  /** Call once at app startup to check if encrypted vault exists on disk */
  public static async init(): Promise<void> {
    const encrypted = await invoke<string | null>('vault_read', { filename: ENCRYPTED_VAULT_FILE });
    this._hasEncryptedFile = Boolean(encrypted);
  }

  public static async unlock(password: string): Promise<boolean> {
    const raw = await invoke<string | null>('vault_read', { filename: ENCRYPTED_VAULT_FILE });
    if (!raw) {
      this.currentMasterPassword = password;
      return true;
    }

    try {
      const payload: EncryptedVaultPayload = JSON.parse(raw);
      const data = await decryptVault<VaultData>(payload, password);
      this.cachedData = data;
      this.currentMasterPassword = password;
      this._hasEncryptedFile = true;
      return true;
    } catch (err) {
      console.error('Failed to unlock vault:', err);
      return false;
    }
  }

  public static lock() {
    this.currentMasterPassword = null;
    this.cachedData = null;
  }

  public static async loadLocal(): Promise<VaultData> {
    if (this.cachedData) {
      return this.cachedData;
    }

    const raw = await invoke<string | null>('vault_read', { filename: VAULT_FILE });
    if (raw) {
      try {
        this.cachedData = JSON.parse(raw);
        return this.cachedData!;
      } catch (err) {
        console.error('Error parsing local vault:', err);
      }
    }

    // Empty starter vault — user adds their own servers and snippets
    this.cachedData = {
      hosts: [],
      keys: [],
      snippets: [],
      portForwards: [],
      version: 1,
    };
    await this.save(this.cachedData);
    return this.cachedData;
  }

  public static async save(data: VaultData): Promise<void> {
    this.cachedData = data;
    await invoke('vault_write', { filename: VAULT_FILE, content: JSON.stringify(data, null, 2) });

    // If master password is set, encrypt it and optionally upload to Firebase
    if (this.currentMasterPassword) {
      const encrypted = await encryptVault(data, this.currentMasterPassword);
      await invoke('vault_write', {
        filename: ENCRYPTED_VAULT_FILE,
        content: JSON.stringify(encrypted),
      });
      this._hasEncryptedFile = true;

      // Sync to Firebase if authenticated
      try {
        await uploadEncryptedVault(encrypted);
      } catch (err) {
        console.warn('Firebase sync failed or not connected:', err);
      }
    }
  }

  public static async syncFromRemote(): Promise<boolean> {
    if (!this.currentMasterPassword) return false;

    const remotePayload = await fetchRemoteEncryptedVault();
    if (!remotePayload) return false;

    try {
      const decrypted = await decryptVault<VaultData>(remotePayload, this.currentMasterPassword);
      this.cachedData = decrypted;
      await invoke('vault_write', { filename: VAULT_FILE, content: JSON.stringify(decrypted, null, 2) });
      await invoke('vault_write', { filename: ENCRYPTED_VAULT_FILE, content: JSON.stringify(remotePayload) });
      this._hasEncryptedFile = true;
      return true;
    } catch (err) {
      console.error('Failed to decrypt remote vault:', err);
      return false;
    }
  }
}
