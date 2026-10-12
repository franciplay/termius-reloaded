use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use ssh2::Session;
use tauri::{AppHandle, Emitter};

pub enum SshCommand {
    Write(Vec<u8>),
    Resize(u32, u32),
    Disconnect,
}

pub struct SshConnection {
    pub cmd_sender: Sender<SshCommand>,
}

#[derive(Default, Clone)]
pub struct SshState {
    pub connections: Arc<Mutex<HashMap<String, SshConnection>>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SftpFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
    pub permissions: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SshConnectParams {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String, // "password" | "key"
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_data: Option<String>,
    pub passphrase: Option<String>,
    pub cols: u32,
    pub rows: u32,
}

impl SshState {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn connect(&self, app: AppHandle, params: SshConnectParams) -> Result<(), String> {
        let (cmd_tx, cmd_rx) = channel::<SshCommand>();

        self.connections.lock().insert(
            params.session_id.clone(),
            SshConnection {
                cmd_sender: cmd_tx,
            },
        );

        let sid = params.session_id.clone();
        let event_data = format!("ssh-data-{}", sid);
        let event_exit = format!("ssh-exit-{}", sid);

        // Run entire SSH session lifecycle in a dedicated thread
        thread::spawn(move || {
            let addr_str = format!("{}:{}", params.host, params.port);

            let emit_info = |msg: &str| {
                let _ = app.emit(&event_data, format!("{}\r\n", msg));
            };

            let emit_err = |err: &str| {
                let _ = app.emit(&event_data, format!("\r\n\x1b[31;1m[SSH Error]\x1b[0m {}\r\n", err));
            };

            emit_info(&format!("\x1b[36m[*] Connecting to {}:{} as '{}'...\x1b[0m", params.host, params.port, params.username));

            // Resolve address
            let socket_addrs: Vec<_> = match addr_str.to_socket_addrs() {
                Ok(addrs) => addrs.collect(),
                Err(e) => {
                    emit_err(&format!("Cannot resolve hostname '{}': {}", params.host, e));
                    let _ = app.emit(&event_exit, ());
                    return;
                }
            };

            let target_addr = match socket_addrs.first() {
                Some(a) => *a,
                None => {
                    emit_err(&format!("No IP address found for '{}'", params.host));
                    let _ = app.emit(&event_exit, ());
                    return;
                }
            };

            // Connect with 10s timeout
            let tcp = match TcpStream::connect_timeout(&target_addr, Duration::from_secs(10)) {
                Ok(s) => s,
                Err(e) => {
                    emit_err(&format!("Connection timed out or failed to {}: {}", addr_str, e));
                    let _ = app.emit(&event_exit, ());
                    return;
                }
            };

            // Init SSH Session
            let mut session = match Session::new() {
                Ok(s) => s,
                Err(e) => {
                    emit_err(&format!("SSH initialization error: {}", e));
                    let _ = app.emit(&event_exit, ());
                    return;
                }
            };

            session.set_tcp_stream(tcp);

            if let Err(e) = session.handshake() {
                emit_err(&format!("SSH Handshake failed: {}", e));
                let _ = app.emit(&event_exit, ());
                return;
            }

            // Authenticate
            let mut auth_ok = false;
            if params.auth_type == "password" {
                let pass = params.password.as_deref().unwrap_or("");
                
                // Try standard password auth
                if session.userauth_password(&params.username, pass).is_ok() && session.authenticated() {
                    auth_ok = true;
                } else {
                    // Try keyboard-interactive fallback (common on routers / BSD / OpenSSH)
                    struct SimplePrompt(String);
                    impl ssh2::KeyboardInteractivePrompt for SimplePrompt {
                        fn prompt<'a>(&mut self, _name: &str, _instruction: &str, prompts: &[ssh2::Prompt<'a>]) -> Vec<String> {
                            prompts.iter().map(|_| self.0.clone()).collect()
                        }
                    }
                    let mut prompt_handler = SimplePrompt(pass.to_string());
                    let kb_res = session.userauth_keyboard_interactive(&params.username, &mut prompt_handler);
                    if kb_res.is_ok() && session.authenticated() {
                        auth_ok = true;
                    }
                }
            } else if params.auth_type == "key" {
                if let Some(ref path) = params.key_path {
                    if session.userauth_pubkey_file(&params.username, None, Path::new(path), params.passphrase.as_deref()).is_ok() && session.authenticated() {
                        auth_ok = true;
                    }
                } else if let Some(ref data) = params.key_data {
                    let temp_key = std::env::temp_dir().join(format!("tr_key_{}.tmp", uuid::Uuid::new_v4()));
                    if std::fs::write(&temp_key, data).is_ok() {
                        let res = session.userauth_pubkey_file(&params.username, None, &temp_key, params.passphrase.as_deref());
                        let _ = std::fs::remove_file(&temp_key);
                        if res.is_ok() && session.authenticated() {
                            auth_ok = true;
                        }
                    }
                }
            }

            if !auth_ok {
                emit_err("Authentication failed. Please verify username, password, or SSH key.");
                let _ = app.emit(&event_exit, ());
                return;
            }

            emit_info("\x1b[32m[+] Authentication succeeded. Requesting shell session...\x1b[0m\r\n");

            // Open Channel
            let mut channel = match session.channel_session() {
                Ok(ch) => ch,
                Err(e) => {
                    emit_err(&format!("Failed to open SSH channel: {}", e));
                    let _ = app.emit(&event_exit, ());
                    return;
                }
            };

            // Request PTY - fallback from xterm-256color to standard xterm / vt100 for router compatibility
            let pty_res = channel.request_pty("xterm-256color", None, Some((params.cols, params.rows, 0, 0)))
                .or_else(|_| channel.request_pty("xterm", None, None))
                .or_else(|_| channel.request_pty("vt100", None, None));

            if let Err(e) = pty_res {
                emit_err(&format!("Failed to request PTY: {}", e));
                let _ = app.emit(&event_exit, ());
                return;
            }

            if let Err(e) = channel.shell() {
                emit_err(&format!("Failed to start shell: {}", e));
                let _ = app.emit(&event_exit, ());
                return;
            }

            // Set session to non-blocking so reads return WouldBlock immediately when idle
            session.set_blocking(false);

            let mut buf = [0u8; 8192];
            let mut running = true;

            while running {
                // 1. Process outgoing commands from frontend
                while let Ok(cmd) = cmd_rx.try_recv() {
                    match cmd {
                        SshCommand::Write(bytes) => {
                            let mut offset = 0;
                            while offset < bytes.len() {
                                match channel.write(&bytes[offset..]) {
                                    Ok(n) => offset += n,
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                        thread::sleep(Duration::from_millis(5));
                                    }
                                    Err(_) => break,
                                }
                            }
                            let _ = channel.flush();
                        }
                        SshCommand::Resize(cols, rows) => {
                            let _ = channel.request_pty_size(cols, rows, None, None);
                        }
                        SshCommand::Disconnect => {
                            running = false;
                            break;
                        }
                    }
                }

                if !running {
                    break;
                }

                // 2. Read incoming data from remote server
                match channel.read(&mut buf) {
                    Ok(0) => {
                        if channel.eof() {
                            break;
                        }
                        thread::sleep(Duration::from_millis(15));
                    }
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(&event_data, text);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(15));
                    }
                    Err(_) => {
                        break;
                    }
                }
            }

            let _ = channel.close();
            let _ = app.emit(&event_exit, ());
        });

        Ok(())
    }

    pub fn write_data(&self, session_id: &str, data: &str) -> Result<(), String> {
        let conns = self.connections.lock();
        if let Some(conn) = conns.get(session_id) {
            conn.cmd_sender
                .send(SshCommand::Write(data.as_bytes().to_vec()))
                .map_err(|e| format!("Failed to send SSH data: {}", e))
        } else {
            Err("SSH session not found".into())
        }
    }

    pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let conns = self.connections.lock();
        if let Some(conn) = conns.get(session_id) {
            let _ = conn.cmd_sender.send(SshCommand::Resize(cols, rows));
            Ok(())
        } else {
            Err("SSH session not found".into())
        }
    }

    pub fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let mut conns = self.connections.lock();
        if let Some(conn) = conns.remove(session_id) {
            let _ = conn.cmd_sender.send(SshCommand::Disconnect);
        }
        Ok(())
    }

    pub fn sftp_list(&self, _session_id: &str, _remote_path: &str) -> Result<Vec<SftpFileEntry>, String> {
        // SFTP support
        Ok(Vec::new())
    }

    pub fn sftp_read_file(&self, _session_id: &str, _path: &str) -> Result<String, String> {
        Ok(String::new())
    }

    pub fn sftp_write_file(&self, _session_id: &str, _path: &str, _content: &str) -> Result<(), String> {
        Ok(())
    }
}
