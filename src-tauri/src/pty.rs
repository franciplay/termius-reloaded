use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
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
            let _ = app.emit(&exit_event, ());
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
