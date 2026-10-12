import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  User,
  Auth,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  Firestore,
} from 'firebase/firestore';
import { EncryptedVaultPayload, FirebaseSyncSettings } from '../types';

let currentApp: FirebaseApp | null = null;
let currentAuth: Auth | null = null;
let currentDb: Firestore | null = null;

const DEFAULT_FIREBASE_STORAGE_KEY = 'tr_firebase_config';

export function getStoredFirebaseConfig(): FirebaseSyncSettings | null {
  const raw = localStorage.getItem(DEFAULT_FIREBASE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveFirebaseConfig(config: FirebaseSyncSettings) {
  localStorage.setItem(DEFAULT_FIREBASE_STORAGE_KEY, JSON.stringify(config));
  initFirebase(config);
}

export function initFirebase(config?: FirebaseSyncSettings | null): boolean {
  const conf = config || getStoredFirebaseConfig();
  if (!conf || !conf.apiKey || !conf.projectId) {
    return false;
  }

  try {
    if (getApps().length > 0) {
      currentApp = getApps()[0];
    } else {
      currentApp = initializeApp({
        apiKey: conf.apiKey,
        authDomain: conf.authDomain,
        projectId: conf.projectId,
        storageBucket: conf.storageBucket,
        messagingSenderId: conf.messagingSenderId,
        appId: conf.appId,
      });
    }

    currentAuth = getAuth(currentApp);
    currentDb = getFirestore(currentApp);
    return true;
  } catch (err) {
    console.error('Firebase initialization error:', err);
    return false;
  }
}

export async function loginWithEmail(email: string, pass: string): Promise<User> {
  if (!currentAuth) {
    throw new Error('Firebase is not configured. Please enter your Firebase settings.');
  }
  const userCredential = await signInWithEmailAndPassword(currentAuth, email, pass);
  return userCredential.user;
}

export async function registerWithEmail(email: string, pass: string): Promise<User> {
  if (!currentAuth) {
    throw new Error('Firebase is not configured. Please enter your Firebase settings.');
  }
  const userCredential = await createUserWithEmailAndPassword(currentAuth, email, pass);
  return userCredential.user;
}

export async function logoutUser(): Promise<void> {
  if (currentAuth) {
    await fbSignOut(currentAuth);
  }
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  if (!currentAuth) {
    initFirebase();
  }
  if (!currentAuth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(currentAuth, callback);
}

/**
 * Pushes the encrypted ciphertext payload to Cloud Firestore
 */
export async function uploadEncryptedVault(payload: EncryptedVaultPayload): Promise<void> {
  if (!currentDb || !currentAuth || !currentAuth.currentUser) {
    return;
  }

  const userId = currentAuth.currentUser.uid;
  const vaultRef = doc(currentDb, 'users', userId, 'vault', 'latest');
  await setDoc(vaultRef, payload);
}

/**
 * Pulls the latest encrypted ciphertext payload from Cloud Firestore
 */
export async function fetchRemoteEncryptedVault(): Promise<EncryptedVaultPayload | null> {
  if (!currentDb || !currentAuth || !currentAuth.currentUser) {
    return null;
  }

  const userId = currentAuth.currentUser.uid;
  const vaultRef = doc(currentDb, 'users', userId, 'vault', 'latest');
  const snap = await getDoc(vaultRef);

  if (snap.exists()) {
    return snap.data() as EncryptedVaultPayload;
  }
  return null;
}

/**
 * Real-time listener for remote vault updates
 */
export function listenToRemoteVault(callback: (payload: EncryptedVaultPayload) => void) {
  if (!currentDb || !currentAuth || !currentAuth.currentUser) {
    return () => {};
  }

  const userId = currentAuth.currentUser.uid;
  const vaultRef = doc(currentDb, 'users', userId, 'vault', 'latest');

  return onSnapshot(vaultRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data() as EncryptedVaultPayload);
    }
  });
}
