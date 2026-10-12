export type SessionType = 'local' | 'ssh' | 'sftp';

export interface Host {
  id: string;
  label: string;
  address: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  keyPath?: string;
  keyData?: string;
  passphrase?: string;
  tags: string[];
  group?: string;
  color?: string;
  os?: 'linux' | 'windows' | 'macos' | 'freebsd' | 'unknown';
  createdAt: number;
}

export interface KeyIdentity {
  id: string;
  label: string;
  keyType: 'ed25519' | 'rsa';
  publicKey?: string;
  privateKey: string;
  passphrase?: string;
  createdAt: number;
}

export interface Snippet {
  id: string;
  label: string;
  command: string;
  description?: string;
  tags: string[];
}

export interface PortForward {
  id: string;
  label: string;
  type: 'local' | 'remote' | 'socks5';
  hostId: string;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
  active: boolean;
}

export interface TerminalTab {
  id: string;
  title: string;
  type: SessionType;
  sessionId: string;
  active: boolean;
  host?: Host;
  shell?: string;
}

export interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: number;
  permissions?: number | string;
}

export interface FirebaseSyncSettings {
  enabled: boolean;
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

export interface EncryptedVaultPayload {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: number;
}
