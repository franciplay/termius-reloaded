# Termius Reloaded 🚀

> An open-source, modern, and completely free alternative to Termius. No paywalls, zero telemetry, local-first with zero-knowledge end-to-end encrypted (E2EE) cloud sync.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20Linux%20%7C%20Android-blue.svg)](#)

---

## ✨ Features (In Development)

- **🖥️ Modern Terminal Emulator**: Built on `xterm.js` with WebGL rendering, 24-bit true color, tabs, split panes, and custom themes.
- **🔐 Host & Identity Management**: Group servers into folders/tags, manage credentials, and generate/store SSH keys (Ed25519 & RSA).
- **📁 Visual SFTP File Manager**: Two-pane remote/local file browser with drag-and-drop transfers and inline text editing.
- **🔄 Zero-Knowledge E2EE Cloud Sync**: Optional sync via Firebase with client-side AES-256-GCM encryption. Your passwords and keys are never seen by the cloud.
- **⚡ Snippets & Quick Scripts**: Save commonly used commands with variable interpolation and broadcast commands across multiple terminals simultaneously.
- **🌐 Port Forwarding**: Effortlessly manage local, remote, and dynamic (SOCKS5) tunnels with auto-reconnect.
- **📱 True Cross-Platform**: Powered by **Tauri v2** for lightweight, blazing fast performance on Windows, Linux, and Android.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, xterm.js
- **Desktop/Mobile Backend**: Tauri v2, Rust (`russh` / `ssh2`, `portable-pty`, `tokio`)
- **Storage & Security**: SQLite / SQLCipher (Argon2id + AES-256-GCM)
- **Sync**: Firebase Auth + Cloud Firestore (E2EE payload only)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://rustup.rs/) (v1.75+)
- Windows C++ Build Tools (for Windows builds)

### Development

```bash
# Install frontend dependencies
npm install

# Run desktop app in development mode
npm run tauri dev
```

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
