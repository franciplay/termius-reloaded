use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

#[derive(Default, Clone)]
pub struct PtyState {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[allow(dead_code)]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Deserialize, Clone)]
pub struct SshSpawnParams {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String, // "password" | "key"
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_data: Option<String>,
    pub passphrase: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Serialize)]
pub struct SshErrorInfo {
    pub title: String,
    pub message: String,
    pub suggestions: Vec<String>,
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_escape = false;
    for c in s.chars() {
        if c == '\x1b' {
            in_escape = true;
        } else if in_escape {
            if c.is_ascii_alphabetic() {
                in_escape = false;
            }
        } else {
            out.push(c);
        }
    }
    out
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn_shell(
        &self,
        app: AppHandle,
        session_id: String,
        shell_type: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let shell_cmd = match shell_type.as_deref() {
            Some("cmd") => "cmd.exe",
            Some("wsl") => "wsl.exe",
            Some("powershell") => "powershell.exe",
            Some(other) => other,
            None => {
                if cfg!(target_os = "windows") {
                    "powershell.exe"
                } else {
                    "/bin/bash"
                }
            }
        };

        let mut cmd = CommandBuilder::new(shell_cmd);
        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let session = PtySession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
        };

        self.sessions.lock().insert(session_id.clone(), session);

        let event_name = format!("pty-data-{}", session_id);
        let app_reader = app.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_reader.emit(&event_name, data);
                    }
                    Err(_) => break,
                }
            }
        });

        // Watcher thread for local shell process exit
        let sid_watcher = session_id.clone();
        let sessions_watcher = self.sessions.clone();
        let app_watcher = app;
        thread::spawn(move || {
            let _ = child.wait();
            thread::sleep(Duration::from_millis(50));
            sessions_watcher.lock().remove(&sid_watcher);
            let exit_event = format!("pty-exit-{}", sid_watcher);
            let _ = app_watcher.emit(&exit_event, true);
        });

        Ok(())
    }

    /// Spawn a native OpenSSH client process inside a full interactive PTY.
    pub fn spawn_ssh_pty(
        &self,
        app: AppHandle,
        params: SshSpawnParams,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: params.rows,
                cols: params.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let ssh_bin = if cfg!(target_os = "windows") {
            let win_ssh = std::path::Path::new("C:\\Windows\\System32\\OpenSSH\\ssh.exe");
            if win_ssh.exists() {
                "C:\\Windows\\System32\\OpenSSH\\ssh.exe"
            } else {
                "ssh"
            }
        } else {
            "ssh"
        };

        let mut cmd = CommandBuilder::new(ssh_bin);
        cmd.arg("-p");
        cmd.arg(params.port.to_string());
        cmd.arg("-o");
        cmd.arg("StrictHostKeyChecking=accept-new");
        cmd.arg("-o");
        cmd.arg("ConnectTimeout=10");

        if params.auth_type == "key" {
            if let Some(ref path) = params.key_path {
                if !path.trim().is_empty() {
                    cmd.arg("-i");
                    cmd.arg(path);
                }
            }
        }

        let destination = format!("{}@{}", params.username, params.host);
        cmd.arg(destination);

        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn SSH process: {}", e))?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let writer_arc = Arc::new(Mutex::new(writer));

        let session = PtySession {
            master: pair.master,
            writer: writer_arc.clone(),
        };

        self.sessions.lock().insert(params.session_id.clone(), session);

        let sid = params.session_id.clone();
        let host = params.host.clone();
        let port = params.port;
        let event_data = format!("ssh-data-{}", sid);
        let event_exit = format!("ssh-exit-{}", sid);
        let event_error = format!("ssh-error-{}", sid);

        let password_opt = params.password.clone();
        let writer_for_pass = writer_arc.clone();
        let had_auth_success = Arc::new(AtomicBool::new(false));
        let had_auth_success_flag = had_auth_success.clone();
        let captured_output_arc = Arc::new(Mutex::new(String::new()));
        let captured_output_for_reader = captured_output_arc.clone();

        let event_data_reader = event_data.clone();
        let app_reader = app.clone();

        // Background reader that streams terminal output directly to xterm.js
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut pass_attempted = false;
            let mut pending_buffer = String::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        {
                            let mut cap = captured_output_for_reader.lock();
                            if cap.len() < 16384 {
                                cap.push_str(&text);
                            }
                        }

                        // If already authenticated, stream everything directly to terminal
                        if had_auth_success_flag.load(Ordering::SeqCst) {
                            let _ = app_reader.emit(&event_data_reader, text);
                            continue;
                        }

                        // Auto-fill configured password when OpenSSH prompts for password
                        if let Some(ref pass) = password_opt {
                            if !pass.is_empty() && !pass_attempted {
                                pending_buffer.push_str(&text);
                                let clean = strip_ansi(&pending_buffer).to_lowercase();

                                let is_pass_prompt = clean.contains("password:")
                                    || clean.contains("passphrase")
                                    || clean.contains("password for");

                                if is_pass_prompt {
                                    pass_attempted = true;
                                    pending_buffer.clear();

                                    // Replace prompt with clean "➜ Connecting..."
                                    let _ = app_reader.emit(
                                        &event_data_reader,
                                        "\r\x1b[2K\x1b[38;5;39m➜ Connecting...\x1b[0m\r\n".to_string(),
                                    );

                                    let pass_to_send = format!("{}\r\n", pass);
                                    let w_ref = writer_for_pass.clone();
                                    thread::spawn(move || {
                                        thread::sleep(Duration::from_millis(50));
                                        let mut w = w_ref.lock();
                                        let _ = w.write_all(pass_to_send.as_bytes());
                                        let _ = w.flush();
                                    });
                                    continue;
                                }

                                // If not a password prompt yet, only flush if buffer contains newline (banner/MOTD) or is long
                                if pending_buffer.contains('\n') || pending_buffer.len() > 180 {
                                    let _ = app_reader.emit(&event_data_reader, pending_buffer.clone());
                                    pending_buffer.clear();
                                }
                                continue;
                            }
                        }

                        // If password was already attempted, monitor for login success or permission denied
                        if pass_attempted {
                            pending_buffer.push_str(&text);
                            let clean = strip_ansi(&pending_buffer).to_lowercase();

                            if clean.contains("permission denied") || clean.contains("try again") {
                                let _ = app_reader.emit(&event_data_reader, pending_buffer.clone());
                                pending_buffer.clear();
                                continue;
                            }

                            if pending_buffer.contains('\n')
                                || clean.contains("$")
                                || clean.contains("#")
                                || clean.contains(">")
                            {
                                had_auth_success_flag.store(true, Ordering::SeqCst);
                                // Clear "Connecting..." line and emit real shell response
                                let _ = app_reader.emit(&event_data_reader, "\r\x1b[2K".to_string());
                                let _ = app_reader.emit(&event_data_reader, pending_buffer.clone());
                                pending_buffer.clear();
                                continue;
                            }
                            continue;
                        }

                        // No password configured: detect standard login prompt or MOTD
                        let clean = strip_ansi(&text).to_lowercase();
                        if clean.contains("last login:") || clean.contains("$ ") || clean.contains("# ") {
                            had_auth_success_flag.store(true, Ordering::SeqCst);
                        }

                        let _ = app_reader.emit(&event_data_reader, text);
                    }
                    Err(_) => break,
                }
            }

            if !pending_buffer.is_empty() {
                let _ = app_reader.emit(&event_data_reader, pending_buffer);
            }
        });

        // Child watcher thread: detects OpenSSH termination, errors, and clean exits
        let sid_watcher = sid;
        let sessions_watcher = self.sessions.clone();
        let app_watcher = app;
        let event_exit_watcher = event_exit;
        let event_error_watcher = event_error;
        let host_watcher = host;
        let port_watcher = port;
        let username_watcher = params.username;
        let captured_output_watcher = captured_output_arc;
        let had_auth_success_watcher = had_auth_success;

        thread::spawn(move || {
            let status = child.wait().ok();
            let exit_code = status.map(|s| s.exit_code()).unwrap_or(0);

            // Allow the reader thread a moment to read any pending buffers
            thread::sleep(Duration::from_millis(100));

            // Clean up session and drop master Pty to release handles and unblock reader
            {
                let mut sessions = sessions_watcher.lock();
                sessions.remove(&sid_watcher);
            }

            let was_authenticated = had_auth_success_watcher.load(Ordering::SeqCst);
            let captured = captured_output_watcher.lock().clone();
            let lower = captured.to_lowercase();

            let has_connection_error = lower.contains("connection refused")
                || lower.contains("banner exchange")
                || lower.contains("kex_exchange_identification")
                || lower.contains("connection timed out")
                || lower.contains("operation timed out")
                || lower.contains("timed out")
                || lower.contains("could not resolve hostname")
                || lower.contains("name or service not known")
                || lower.contains("no route to host")
                || lower.contains("network is unreachable")
                || lower.contains("host key verification failed")
                || (lower.contains("permission denied") && !was_authenticated);

            if has_connection_error || (exit_code != 0 && !was_authenticated) {
                let (title, message, suggestions) = if lower.contains("connection refused")
                    || lower.contains("banner exchange")
                {
                    (
                        "Connection Refused",
                        format!("Failed to establish TCP connection to {}:{}: Connection refused", host_watcher, port_watcher),
                        vec![
                            format!("Verify that the SSH server (port {}) is enabled on the device. On many home routers (Asus, OpenWrt, DD-WRT), SSH is disabled by default in the web admin settings.", port_watcher),
                            "Verify that the port number is correct (some routers or servers use custom ports like 2222 or 8022).".to_string(),
                            "Check if a firewall on the device or your PC is blocking the port.".to_string(),
                        ],
                    )
                } else if lower.contains("connection timed out") || lower.contains("timed out") || lower.contains("operation timed out") {
                    (
                        "Connection Timed Out",
                        format!("Connection timed out or failed to reach {}:{}", host_watcher, port_watcher),
                        vec![
                            "Make sure the target device is powered on and connected to the network.".to_string(),
                            format!("Verify your PC is on the same local subnet / Wi-Fi as {} or connected to the appropriate VPN.", host_watcher),
                            "Double-check the device IP address (common router IPs are 192.168.1.1 or 192.168.0.1).".to_string(),
                        ],
                    )
                } else if lower.contains("could not resolve hostname") || lower.contains("name or service not known") {
                    (
                        "Host Resolution Failed",
                        format!("Cannot resolve hostname '{}'", host_watcher),
                        vec![
                            "Verify that the hostname or IP address is spelled correctly.".to_string(),
                            "If connecting to a router or local device, use its direct IP (e.g. 192.168.1.1) instead of a domain name.".to_string(),
                            "Check your network connection and DNS settings.".to_string(),
                        ],
                    )
                } else if lower.contains("permission denied") {
                    (
                        "Authentication Failed",
                        format!("Remote host rejected credentials for user '{}' on {}:{}", username_watcher, host_watcher, port_watcher),
                        vec![
                            "Double-check your password in device settings (passwords are case-sensitive).".to_string(),
                            "Verify if key authentication or password authentication is required by the server.".to_string(),
                            "Make sure your public key is added to '~/.ssh/authorized_keys' on the target device.".to_string(),
                        ],
                    )
                } else if lower.contains("host key verification failed") {
                    (
                        "Host Key Verification Failed",
                        "The remote host identification has changed or is invalid.".to_string(),
                        vec![
                            "The server host key might have changed (e.g. after a reinstallation or IP reassignment).".to_string(),
                            "Check your known_hosts file in ~/.ssh/known_hosts.".to_string(),
                        ],
                    )
                } else {
                    (
                        "Connection Failed",
                        format!("SSH process exited with error code: {}", exit_code),
                        vec![
                            "Verify network connectivity to the target device.".to_string(),
                            "Check the device logs to verify why the SSH session failed.".to_string(),
                        ],
                    )
                };

                let _ = app_watcher.emit(
                    &event_error_watcher,
                    SshErrorInfo {
                        title: title.to_string(),
                        message,
                        suggestions,
                    },
                );

                // Exit was due to error, keep tab open so user can inspect error and retry
                let _ = app_watcher.emit(&event_exit_watcher, false);
            } else {
                // Exit was clean (user typed exit or exit_code == 0) -> auto-close tab!
                let _ = app_watcher.emit(&event_exit_watcher, true);
            }
        });

        Ok(())
    }

    pub fn write_data(&self, session_id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(session_id) {
            let mut writer = session.writer.lock();
            writer
                .write_all(data.as_bytes())
                .map_err(|e| format!("Failed to write to PTY: {}", e))?;
            writer.flush().map_err(|e| format!("Failed to flush: {}", e))?;
            Ok(())
        } else {
            Err("Session not found".into())
        }
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(session_id) {
            session
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Failed to resize PTY: {}", e))?;
            Ok(())
        } else {
            Err("Session not found".into())
        }
    }

    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        sessions.remove(session_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi() {
        let sample = "\x1b[38;5;39muser@192.168.1.2's password:\x1b[0m";
        let cleaned = strip_ansi(sample);
        assert_eq!(cleaned, "user@192.168.1.2's password:");
        assert!(cleaned.to_lowercase().contains("password:"));
    }

    #[test]
    fn test_process_exit_and_read() {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(["/c", "echo goodbye & exit 42"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().unwrap();
        let (output_tx, _output_rx) = std::sync::mpsc::channel();

        // Reader thread
        thread::spawn(move || {
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = output_tx.send(text);
                    }
                    Err(_) => break,
                }
            }
        });

        // Child watcher thread
        let status = child.wait().unwrap();
        thread::sleep(Duration::from_millis(50));
        drop(pair.master);
        assert_eq!(status.exit_code(), 42);
    }
}

