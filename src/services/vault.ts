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

const LOCAL_STORAGE_KEY = 'tr_local_vault';
const ENCRYPTED_LOCAL_KEY = 'tr_vault_encrypted';

export class VaultManager {
  private static cachedData: VaultData | null = null;
  private static currentMasterPassword: string | null = null;

  public static isLocked(): boolean {
    const hasEncrypted = localStorage.getItem(ENCRYPTED_LOCAL_KEY);
    return Boolean(hasEncrypted && !this.currentMasterPassword);
  }

  public static hasMasterPassword(): boolean {
    return Boolean(localStorage.getItem(ENCRYPTED_LOCAL_KEY));
  }

  public static setMasterPassword(password: string) {
    this.currentMasterPassword = password;
  }

  public static getMasterPassword(): string | null {
    return this.currentMasterPassword;
  }

  public static async unlock(password: string): Promise<boolean> {
    const raw = localStorage.getItem(ENCRYPTED_LOCAL_KEY);
    if (!raw) {
      this.currentMasterPassword = password;
      return true;
    }

    try {
      const payload: EncryptedVaultPayload = JSON.parse(raw);
      const data = await decryptVault<VaultData>(payload, password);
      this.cachedData = data;
      this.currentMasterPassword = password;
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

  public static loadLocal(): VaultData {
    if (this.cachedData) {
      return this.cachedData;
    }

    const unencrypted = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (unencrypted) {
      try {
        this.cachedData = JSON.parse(unencrypted);
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
    this.save(this.cachedData);
    return this.cachedData;
  }

  public static async save(data: VaultData): Promise<void> {
    this.cachedData = data;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));

    // If master password is set, encrypt it and optionally upload to Firebase
    if (this.currentMasterPassword) {
      const encrypted = await encryptVault(data, this.currentMasterPassword);
      localStorage.setItem(ENCRYPTED_LOCAL_KEY, JSON.stringify(encrypted));

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
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(decrypted));
      localStorage.setItem(ENCRYPTED_LOCAL_KEY, JSON.stringify(remotePayload));
      return true;
    } catch (err) {
      console.error('Failed to decrypt remote vault:', err);
      return false;
    }
  }
}
