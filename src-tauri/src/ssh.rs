use parking_lot::Mutex;
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(serde::Deserialize, Clone)]
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

#[derive(Clone, serde::Serialize)]
pub struct SshErrorInfo {
    pub title: String,
    pub message: String,
    pub suggestions: Vec<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct SftpFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified: Option<u64>,
}

enum SshCommand {
    Write(Vec<u8>),
    Resize(u32, u32),
    Disconnect,
}

struct SshConnection {
    cmd_sender: Sender<SshCommand>,
}

pub struct SshState {
    connections: Arc<Mutex<HashMap<String, SshConnection>>>,
}

impl SshState {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn connect(&self, app: AppHandle, params: SshConnectParams) -> Result<(), String> {
        let session_id = params.session_id.clone();
        let (cmd_tx, cmd_rx) = channel::<SshCommand>();

        {
            let mut conns = self.connections.lock();
            conns.insert(session_id.clone(), SshConnection { cmd_sender: cmd_tx });
        }

        let event_data = format!("ssh-data-{}", session_id);
        let event_exit = format!("ssh-exit-{}", session_id);
        let event_error = format!("ssh-error-{}", session_id);

        // Run entire SSH session lifecycle in a dedicated thread
        thread::spawn(move || {
            let addr_str = format!("{}:{}", params.host, params.port);

            let emit_info = |msg: &str| {
                let _ = app.emit(&event_data, format!("{}\r\n", msg));
            };

            let emit_failure = |title: &str, reason: &str, suggestions: &[&str]| {
                // 1. Write clean ANSI formatted block to terminal buffer
                let mut term_output = String::new();
                term_output.push_str("\r\n\x1b[31;1m──────────────────────────────────────────────────────────────────────\x1b[0m\r\n");
                term_output.push_str(&format!("\x1b[31;1m  [SSH Connection Failed] {}\x1b[0m\r\n", title));
                term_output.push_str(&format!("\x1b[90m  Reason: \x1b[37m{}\x1b[0m\r\n\r\n", reason));
                term_output.push_str("\x1b[33;1m  Possible Solutions & Troubleshooting:\x1b[0m\r\n");
                for s in suggestions {
                    term_output.push_str(&format!("  \x1b[33m•\x1b[0m {}\r\n", s));
                }
                term_output.push_str("\x1b[31;1m──────────────────────────────────────────────────────────────────────\x1b[0m\r\n\r\n");
                let _ = app.emit(&event_data, term_output);

                // 2. Emit structured event for visual UI error banner
                let err_obj = SshErrorInfo {
                    title: title.to_string(),
                    message: reason.to_string(),
                    suggestions: suggestions.iter().map(|s| s.to_string()).collect(),
                };
                let _ = app.emit(&event_error, err_obj);

                // 3. Emit exit event (marks session disconnected, but tab stays open!)
                let _ = app.emit(&event_exit, ());
            };

            emit_info(&format!("\x1b[36m➜ Connecting to {}:{} as '{}'...\x1b[0m", params.host, params.port, params.username));

            // 1. Resolve address
            let socket_addrs: Vec<_> = match addr_str.to_socket_addrs() {
                Ok(addrs) => addrs.collect(),
                Err(e) => {
                    emit_failure(
                        "Host Resolution Failed",
                        &format!("Cannot resolve hostname '{}' ({})", params.host, e),
                        &[
                            "Verify that the hostname or IP address is spelled correctly.",
                            "If connecting to a router or local device, use its direct IP (e.g. 192.168.1.1) instead of a domain name.",
                            "Check your network connection and DNS settings.",
                        ],
                    );
                    return;
                }
            };

            let target_addr = match socket_addrs.first() {
                Some(a) => *a,
                None => {
                    emit_failure(
                        "Host Not Found",
                        &format!("No IP address found for '{}'", params.host),
                        &[
                            "Check the hostname or IP address.",
                            "Ensure your network connection is active.",
                        ],
                    );
                    return;
                }
            };

            // 2. Connect with 10s timeout
            let tcp = match TcpStream::connect_timeout(&target_addr, Duration::from_secs(10)) {
                Ok(s) => s,
                Err(e) => {
                    let (title, suggestions) = if e.kind() == std::io::ErrorKind::ConnectionRefused {
                        (
                            "Connection Refused",
                            vec![
                                "Verify that the SSH server (port 22) is enabled on the device. On many home routers (Asus, OpenWrt, DD-WRT), SSH is disabled by default in the web admin settings.",
                                "Verify that the port number is correct (some servers use custom ports like 2222).",
                                "Check if a firewall on the device or your PC is blocking port 22.",
                            ],
                        )
                    } else if e.kind() == std::io::ErrorKind::TimedOut {
                        (
                            "Connection Timed Out",
                            vec![
                                "Make sure the target device is powered on and connected to the network.",
                                "Verify your PC is on the same local network / Wi-Fi or connected to the appropriate VPN.",
                                "Double-check the device's IP address (common router IPs are 192.168.1.1 or 192.168.0.1).",
                            ],
                        )
                    } else {
                        (
                            "Network Connection Error",
                            vec![
                                "Verify that the device's IP address is reachable (try pinging it in PowerShell or CMD).",
                                "Ensure your network cable or Wi-Fi is connected.",
                            ],
                        )
                    };

                    emit_failure(
                        title,
                        &format!("Failed to establish TCP connection to {}: {}", addr_str, e),
                        &suggestions,
                    );
                    return;
                }
            };

            // 3. Init SSH Session
            let mut session = match Session::new() {
                Ok(s) => s,
                Err(e) => {
                    emit_failure(
                        "SSH Client Initialization Error",
                        &format!("Failed to create SSH session: {}", e),
                        &["Restart Termius Reloaded and try again."],
                    );
                    return;
                }
            };

            session.set_tcp_stream(tcp);

            // 4. SSH Handshake
            if let Err(e) = session.handshake() {
                emit_failure(
                    "SSH Handshake Failed",
                    &format!("Failed to negotiate SSH parameters with {}: {}", params.host, e),
                    &[
                        "The device may be using legacy SSH ciphers or key exchange algorithms (common on older routers, switches, and embedded hardware).",
                        "The remote device may have dropped the connection due to rate limiting or security rules (fail2ban).",
                        "Try rebooting the device or restarting its SSH service.",
                    ],
                );
                return;
            }

            // 5. Authenticate
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
                let suggestions = if params.auth_type == "password" {
                    vec![
                        "Double-check your username and password (passwords are case-sensitive).",
                        "Many routers (OpenWrt, DD-WRT, Asuswrt) disable password login for 'root' by default or require password authentication to be explicitly enabled in the web interface (Administration -> SSH).",
                        "If the device has a default password (e.g., admin/admin or admin/password), make sure it hasn't been changed.",
                    ]
                } else {
                    vec![
                        "Verify that the private key file path exists and is readable.",
                        "Check if the private key requires a passphrase.",
                        "Make sure your public key is added to '~/.ssh/authorized_keys' on the target device.",
                    ]
                };

                emit_failure(
                    "Authentication Failed",
                    &format!("Remote device rejected login for user '{}'.", params.username),
                    &suggestions,
                );
                return;
            }

            emit_info("\x1b[32m[+] Authentication succeeded. Requesting shell session...\x1b[0m\r\n");

            // 6. Open Channel
            let mut channel = match session.channel_session() {
                Ok(ch) => ch,
                Err(e) => {
                    emit_failure(
                        "SSH Channel Error",
                        &format!("Failed to open session channel: {}", e),
                        &["The server may be overloaded or limiting concurrent sessions."],
                    );
                    return;
                }
            };

            // 7. Request PTY - fallback from xterm-256color to standard xterm / vt100 for router compatibility
            let pty_res = channel.request_pty("xterm-256color", None, Some((params.cols, params.rows, 0, 0)))
                .or_else(|_| channel.request_pty("xterm", None, None))
                .or_else(|_| channel.request_pty("vt100", None, None));

            if let Err(e) = pty_res {
                emit_failure(
                    "PTY Allocation Failed",
                    &format!("Remote server could not allocate pseudo-terminal: {}", e),
                    &["The remote user account may restrict terminal allocations."],
                );
                return;
            }

            if let Err(e) = channel.shell() {
                emit_failure(
                    "Shell Execution Failed",
                    &format!("Failed to start remote shell: {}", e),
                    &[
                        "The user account might have a restricted shell (e.g. /bin/false, /sbin/nologin).",
                        "The router might use a non-standard management CLI instead of a Unix shell.",
                    ],
                );
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
        Ok(Vec::new())
    }

    pub fn sftp_read_file(&self, _session_id: &str, _path: &str) -> Result<String, String> {
        Ok(String::new())
    }

    pub fn sftp_write_file(&self, _session_id: &str, _path: &str, _content: &str) -> Result<(), String> {
        Ok(())
    }
}
