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

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

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

        let sid = session_id.clone();
        let event_name = format!("pty-data-{}", session_id);
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(&event_name, data);
                    }
                    Err(_) => break,
                }
            }
            let exit_event = format!("pty-exit-{}", sid);
            let _ = app.emit(&exit_event, true);
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

        // Background reader that streams terminal output directly to xterm.js
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut captured_output = String::new();
            let mut pass_injected = false;
            let mut logged_in = false;
            let mut accumulator = String::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        if captured_output.len() < 8192 {
                            captured_output.push_str(&text);
                        }

                        // Auto-fill configured password when OpenSSH prompts for password
                        if !pass_injected {
                            accumulator.push_str(&text);

                            let lower = accumulator.to_lowercase();
                            let is_pass_prompt = lower.contains("password:")
                                || lower.contains("passphrase")
                                || lower.contains("password for");

                            if is_pass_prompt {
                                if let Some(ref pass) = password_opt {
                                    if !pass.is_empty() {
                                        pass_injected = true;
                                        let pass_to_send = format!("{}\n", pass);
                                        let writer_ref = writer_for_pass.clone();
                                        thread::spawn(move || {
                                            thread::sleep(Duration::from_millis(60));
                                            let mut w = writer_ref.lock();
                                            let _ = w.write_all(pass_to_send.as_bytes());
                                            let _ = w.flush();
                                        });

                                        // Hide raw prompt and show clean authenticating indicator
                                        let _ = app.emit(
                                            &event_data,
                                            "\r\x1b[2K\x1b[38;5;39m➜ Authenticating...\x1b[0m\r\n".to_string(),
                                        );
                                        accumulator.clear();
                                        continue;
                                    }
                                }
                            }

                            // If not a password prompt yet, emit output
                            if accumulator.len() > 120 || !lower.contains("password") {
                                let _ = app.emit(&event_data, accumulator.clone());
                                accumulator.clear();
                            }
                            continue;
                        }

                        // Once pass is injected, the first real response means we are logged in
                        if pass_injected && !logged_in {
                            logged_in = true;
                            had_auth_success_flag.store(true, Ordering::SeqCst);
                            // Clear line of "Authenticating..."
                            let _ = app.emit(&event_data, "\r\x1b[2K".to_string());
                        }

                        let _ = app.emit(&event_data, text);
                    }
                    Err(_) => break,
                }
            }

            // Flush any remaining accumulated text if not yet sent
            if !accumulator.is_empty() {
                let _ = app.emit(&event_data, accumulator);
            }

            // Check process exit status to see if connection failed
            let status = child.wait().ok();
            let exit_code = status.map(|s| s.exit_code()).unwrap_or(0);
            let was_authenticated = had_auth_success.load(Ordering::SeqCst);

            // If user logged in and then exited cleanly (exit command), auto-close tab!
            if was_authenticated && (exit_code == 0 || exit_code == 130) {
                let _ = app.emit(&event_exit, true);
                return;
            }

            if exit_code != 0 {
                let lower = captured_output.to_lowercase();
                let (title, message, suggestions) = if lower.contains("connection refused")
                    || lower.contains("banner exchange")
                {
                    (
                        "Connection Refused",
                        format!("Failed to establish TCP connection to {}:{}: Connection refused", host, port),
                        vec![
                            "Verify that the SSH server (port 22) is enabled on the device. On many home routers (Asus, OpenWrt, DD-WRT), SSH is disabled by default in the web admin settings.".to_string(),
                            "Verify that the port number is correct (some servers use custom ports like 2222).".to_string(),
                            "Check if a firewall on the device or your PC is blocking port 22.".to_string(),
                        ],
                    )
                } else if lower.contains("connection timed out") || lower.contains("timed out") {
                    (
                        "Connection Timed Out",
                        format!("Connection timed out or failed to {}:{}", host, port),
                        vec![
                            "Make sure the target device is powered on and connected to the network.".to_string(),
                            "Verify your PC is on the same local network / Wi-Fi or connected to the appropriate VPN.".to_string(),
                            "Double-check the device's IP address (common router IPs are 192.168.1.1 or 192.168.0.1).".to_string(),
                        ],
                    )
                } else if lower.contains("could not resolve hostname") || lower.contains("name or service not known") {
                    (
                        "Host Resolution Failed",
                        format!("Cannot resolve hostname '{}'", host),
                        vec![
                            "Verify that the hostname or IP address is spelled correctly.".to_string(),
                            "If connecting to a router or local device, use its direct IP (e.g. 192.168.1.1) instead of a domain name.".to_string(),
                            "Check your network connection and DNS settings.".to_string(),
                        ],
                    )
                } else if lower.contains("permission denied") {
                    (
                        "Authentication Failed",
                        "Remote device rejected login credentials.".to_string(),
                        vec![
                            "Double-check your username and password (passwords are case-sensitive).".to_string(),
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
                        "Connection Closed",
                        format!("SSH session closed unexpectedly (code: {})", exit_code),
                        vec![
                            "Verify network connectivity to the target device.".to_string(),
                            "Check the device logs to verify why the SSH session was closed.".to_string(),
                        ],
                    )
                };

                let _ = app.emit(
                    &event_error,
                    SshErrorInfo {
                        title: title.to_string(),
                        message,
                        suggestions,
                    },
                );

                // Exit was due to error, keep tab open
                let _ = app.emit(&event_exit, false);
            } else {
                // Exit code 0
                let _ = app.emit(&event_exit, true);
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
