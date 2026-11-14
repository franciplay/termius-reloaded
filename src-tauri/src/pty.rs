use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[allow(dead_code)]
pub struct PtySession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub last_size: (u16, u16),
    pub last_resize_at: Arc<Mutex<Option<Instant>>>,
    pub in_alt_screen: Arc<AtomicBool>,
    pub user_has_typed: Arc<AtomicBool>,
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
#[allow(dead_code)]
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

fn update_alt_screen_state(text: &str, in_alt_screen: &AtomicBool) {
    if text.contains("\x1b[?1049h") || text.contains("\x1b[?47h") || text.contains("\x1b[?1047h") {
        in_alt_screen.store(true, Ordering::SeqCst);
    }
    if text.contains("\x1b[?1049l") || text.contains("\x1b[?47l") || text.contains("\x1b[?1047l") {
        in_alt_screen.store(false, Ordering::SeqCst);
    }
}

fn strip_password_lines(raw: &str, strip_all_password_prompts: bool) -> String {
    let mut out = String::with_capacity(raw.len());
    for line in raw.split_inclusive('\n') {
        let clean = strip_ansi(line).to_lowercase();
        let is_ssh_pass = clean.contains("'s password:")
            || clean.contains("enter passphrase for key");
        let is_any_pass = is_ssh_pass
            || clean.contains("password:")
            || clean.contains("passphrase")
            || clean.contains("password for");
        if is_ssh_pass || (strip_all_password_prompts && is_any_pass) {
            continue;
        }
        out.push_str(line);
    }
    out
}

/// Filters out Windows ConPTY (`conhost.exe`) full-viewport repaint frames
/// (`\x1b[?25l\x1b[8;<rows>;<cols>t\x1b[H ... \x1b[?25h`) emitted upon `ResizePseudoConsole`
/// when in the normal screen buffer, preventing scrollback/viewport duplication during zoom.
pub struct ConPtyRedrawFilter {
    in_redraw: bool,
    started_at: Instant,
    carryover: String,
}

impl ConPtyRedrawFilter {
    pub fn new() -> Self {
        Self {
            in_redraw: false,
            started_at: Instant::now(),
            carryover: String::new(),
        }
    }

    pub fn filter(&mut self, chunk: &str, in_alt_screen: bool, recent_resize: bool) -> String {
        if in_alt_screen {
            self.in_redraw = false;
            let mut out = std::mem::take(&mut self.carryover);
            out.push_str(chunk);
            return out;
        }

        if self.in_redraw && self.started_at.elapsed() > Duration::from_millis(300) {
            self.in_redraw = false;
        }

        let combined = if self.carryover.is_empty() {
            chunk.to_string()
        } else {
            let mut s = std::mem::take(&mut self.carryover);
            s.push_str(chunk);
            s
        };

        let mut remaining = combined.as_str();
        let mut output = String::with_capacity(combined.len());

        while !remaining.is_empty() {
            if self.in_redraw {
                if let Some(end_idx) = remaining.find("\x1b[?25h") {
                    remaining = &remaining[end_idx + "\x1b[?25h".len()..];
                    self.in_redraw = false;
                } else {
                    for len in (1.."\x1b[?25h".len()).rev() {
                        if remaining.ends_with(&"\x1b[?25h"[..len]) {
                            self.carryover = remaining[remaining.len() - len..].to_string();
                            break;
                        }
                    }
                    break;
                }
            } else {
                let p1 = remaining.find("\x1b[?25l\x1b[8;");
                let p2 = remaining.find("\x1b[8;");
                let p3 = if recent_resize {
                    remaining.find("\x1b[?25l\x1b[H")
                } else {
                    None
                };

                let start_match = [
                    p1.map(|i| (i, "\x1b[?25l\x1b[8;".len())),
                    p2.map(|i| (i, "\x1b[8;".len())),
                    p3.map(|i| (i, "\x1b[?25l\x1b[H".len())),
                ]
                .into_iter()
                .flatten()
                .min_by_key(|(i, _)| *i);

                if let Some((idx, marker_len)) = start_match {
                    output.push_str(&remaining[..idx]);
                    remaining = &remaining[idx + marker_len..];
                    self.in_redraw = true;
                    self.started_at = Instant::now();
                } else {
                    if recent_resize || remaining.len() >= 512 {
                        let mut held = 0;
                        for pat in ["\x1b[?25l\x1b[8;", "\x1b[8;", "\x1b[?25l\x1b[H"] {
                            for len in (1..pat.len()).rev() {
                                if remaining.ends_with(&pat[..len]) && len > held {
                                    held = len;
                                }
                            }
                        }
                        if held > 0 {
                            let split_at = remaining.len() - held;
                            output.push_str(&remaining[..split_at]);
                            self.carryover = remaining[split_at..].to_string();
                            break;
                        }
                    }
                    output.push_str(remaining);
                    break;
                }
            }
        }

        output
    }
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
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
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

        let last_resize_at = Arc::new(Mutex::new(None));
        let in_alt_screen = Arc::new(AtomicBool::new(false));
        let user_has_typed = Arc::new(AtomicBool::new(false));

        let session = PtySession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            last_size: (cols, rows),
            last_resize_at: last_resize_at.clone(),
            in_alt_screen: in_alt_screen.clone(),
            user_has_typed,
        };

        self.sessions.lock().insert(session_id.clone(), session);

        let event_name = format!("pty-data-{}", session_id);
        let app_reader = app.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut redraw_filter = ConPtyRedrawFilter::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let raw = String::from_utf8_lossy(&buf[..n]).to_string();
                        update_alt_screen_state(&raw, &in_alt_screen);
                        let is_alt = in_alt_screen.load(Ordering::SeqCst);
                        let recent_resize = last_resize_at
                            .lock()
                            .map(|t| t.elapsed() < Duration::from_millis(250))
                            .unwrap_or(false);
                        let filtered = redraw_filter.filter(&raw, is_alt, recent_resize);
                        if !filtered.is_empty() {
                            let _ = app_reader.emit(&event_name, filtered);
                        }
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
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
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
        let last_resize_at = Arc::new(Mutex::new(None));
        let in_alt_screen = Arc::new(AtomicBool::new(false));
        let user_has_typed = Arc::new(AtomicBool::new(false));

        let session = PtySession {
            master: pair.master,
            writer: writer_arc.clone(),
            last_size: (params.cols, params.rows),
            last_resize_at: last_resize_at.clone(),
            in_alt_screen: in_alt_screen.clone(),
            user_has_typed: user_has_typed.clone(),
        };

        self.sessions.lock().insert(params.session_id.clone(), session);

        let sid = params.session_id.clone();
        let host = params.host.clone();
        let port = params.port;
        let event_data = format!("ssh-data-{}", sid);
        let event_exit = format!("ssh-exit-{}", sid);
        let event_error = format!("ssh-error-{}", sid);

        let password_opt = params.password.clone();
        let has_configured_password = password_opt.as_ref().map(|p| !p.is_empty()).unwrap_or(false);
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
            let mut redraw_filter = ConPtyRedrawFilter::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let raw_text = String::from_utf8_lossy(&buf[..n]).to_string();
                        {
                            let mut cap = captured_output_for_reader.lock();
                            if cap.len() < 16384 {
                                cap.push_str(&raw_text);
                            }
                        }

                        update_alt_screen_state(&raw_text, &in_alt_screen);
                        let is_alt = in_alt_screen.load(Ordering::SeqCst);
                        let recent_resize = last_resize_at
                            .lock()
                            .map(|t| t.elapsed() < Duration::from_millis(250))
                            .unwrap_or(false);

                        let text = redraw_filter.filter(&raw_text, is_alt, recent_resize);
                        if text.is_empty() {
                            continue;
                        }

                        // If already authenticated, stream to terminal (while stripping any stray OpenSSH password line)
                        if had_auth_success_flag.load(Ordering::SeqCst) {
                            let to_emit = if has_configured_password {
                                let strip_all = !user_has_typed.load(Ordering::SeqCst);
                                strip_password_lines(&text, strip_all)
                            } else {
                                text
                            };
                            if !to_emit.is_empty() {
                                let _ = app_reader.emit(&event_data_reader, to_emit);
                            }
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

                                    let pass_to_send = format!("{}\r\n", pass);
                                    let w_ref = writer_for_pass.clone();
                                    thread::spawn(move || {
                                        thread::sleep(Duration::from_millis(30));
                                        let mut w = w_ref.lock();
                                        let _ = w.write_all(pass_to_send.as_bytes());
                                        let _ = w.flush();
                                    });
                                    continue;
                                }

                                // Only emit before password prompt if there is an explicit connection error
                                let is_early_error = clean.contains("connection refused")
                                    || clean.contains("banner exchange")
                                    || clean.contains("timed out")
                                    || clean.contains("could not resolve")
                                    || clean.contains("verification failed")
                                    || clean.contains("no route to host");

                                if is_early_error && pending_buffer.contains('\n') {
                                    let _ = app_reader.emit(&event_data_reader, pending_buffer.clone());
                                    pending_buffer.clear();
                                }
                                continue;
                            }
                        }

                        // If password was already attempted, monitor for login success or permission denied
                        if pass_attempted {
                            pending_buffer.push_str(&text);
                            let filtered_pending = strip_password_lines(&pending_buffer, true);
                            let clean = strip_ansi(&filtered_pending).to_lowercase();

                            if clean.contains("permission denied") || clean.contains("try again") {
                                if !filtered_pending.is_empty() {
                                    let _ = app_reader.emit(&event_data_reader, filtered_pending);
                                }
                                pending_buffer.clear();
                                continue;
                            }

                            if !clean.trim().is_empty()
                                && (filtered_pending.contains('\n')
                                    || clean.contains('$')
                                    || clean.contains('#')
                                    || clean.contains('>'))
                            {
                                had_auth_success_flag.store(true, Ordering::SeqCst);
                                let trimmed = filtered_pending.trim_start_matches(['\r', '\n']).to_string();
                                if !trimmed.is_empty() {
                                    let _ = app_reader.emit(&event_data_reader, trimmed);
                                }
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
                let final_out = if has_configured_password {
                    strip_password_lines(&pending_buffer, true)
                } else {
                    pending_buffer
                };
                if !final_out.trim().is_empty() {
                    let _ = app_reader.emit(&event_data_reader, final_out);
                }
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
            session.user_has_typed.store(true, Ordering::SeqCst);
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
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.get_mut(session_id) {
            if session.last_size == (cols, rows) {
                return Ok(());
            }
            session.last_size = (cols, rows);
            *session.last_resize_at.lock() = Some(Instant::now());
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
    fn test_strip_ansi_and_password_lines() {
        let sample = "\x1b[38;5;39muser@192.168.1.2's password:\x1b[0m";
        let cleaned = strip_ansi(sample);
        assert_eq!(cleaned, "user@192.168.1.2's password:");
        assert!(cleaned.to_lowercase().contains("password:"));

        let mixed = "\x1b[Hmarco@192.168.1.2's password:\x1b[K\r\nArmbian community\r\nv26.11 rolling\r\n";
        let filtered = strip_password_lines(mixed, true);
        assert_eq!(filtered, "Armbian community\r\nv26.11 rolling\r\n");
    }

    #[test]
    fn test_conpty_redraw_filter() {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: 30, cols: 100, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(["/k", "echo marco@host's password: & echo Armbian community & echo v26.11 rolling"]);
        let _child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 { break; }
                let _ = tx.send(String::from_utf8_lossy(&buf[..n]).to_string());
            }
        });

        thread::sleep(Duration::from_millis(600));
        while rx.try_recv().is_ok() {}

        let mut filter = ConPtyRedrawFilter::new();
        for (c, r) in [(90, 27), (80, 24), (70, 21), (80, 24), (100, 30)] {
            pair.master.resize(PtySize { rows: r, cols: c, pixel_width: 0, pixel_height: 0 }).unwrap();
            thread::sleep(Duration::from_millis(80));
        }

        let mut after_resize_filtered = String::new();
        while let Ok(s) = rx.try_recv() {
            let out = filter.filter(&s, false, true);
            after_resize_filtered.push_str(&out);
        }
        assert_eq!(after_resize_filtered, "");
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

