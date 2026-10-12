use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::Arc;
use std::thread;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use ssh2::{Channel, Session};
use tauri::{AppHandle, Emitter};

pub struct SshConnection {
    pub channel_writer: Arc<Mutex<Channel>>,
    pub session: Arc<Mutex<Session>>,
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
        let addr = format!("{}:{}", params.host, params.port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

        let mut session = Session::new().map_err(|e| format!("SSH session error: {}", e))?;
        session.set_tcp_stream(tcp);
        session
            .handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Authenticate
        if params.auth_type == "password" {
            let pass = params.password.as_deref().unwrap_or("");
            session
                .userauth_password(&params.username, pass)
                .map_err(|e| format!("SSH password authentication failed: {}", e))?;
        } else if params.auth_type == "key" {
            if let Some(ref path) = params.key_path {
                session
                    .userauth_pubkey_file(
                        &params.username,
                        None,
                        Path::new(path),
                        params.passphrase.as_deref(),
                    )
                    .map_err(|e| format!("SSH key authentication failed: {}", e))?;
            } else if let Some(ref data) = params.key_data {
                let temp_key_path = std::env::temp_dir().join(format!("tr_key_{}.tmp", uuid::Uuid::new_v4()));
                std::fs::write(&temp_key_path, data)
                    .map_err(|e| format!("Failed to create temporary key file: {}", e))?;
                
                let auth_res = session.userauth_pubkey_file(
                    &params.username,
                    None,
                    &temp_key_path,
                    params.passphrase.as_deref(),
                );
                let _ = std::fs::remove_file(&temp_key_path);
                auth_res.map_err(|e| format!("SSH key auth failed: {}", e))?;
            } else {
                return Err("No SSH private key provided".into());
            }
        } else {
            return Err("Unsupported authentication method".into());
        }

        if !session.authenticated() {
            return Err("SSH authentication failed. Please check credentials.".into());
        }

        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

        channel
            .request_pty(
                "xterm-256color",
                None,
                Some((params.cols, params.rows, 0, 0)),
            )
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel
            .shell()
            .map_err(|e| format!("Failed to start shell: {}", e))?;

        let channel_arc = Arc::new(Mutex::new(channel));
        let session_arc = Arc::new(Mutex::new(session));

        self.connections.lock().insert(
            params.session_id.clone(),
            SshConnection {
                channel_writer: channel_arc.clone(),
                session: session_arc,
            },
        );

        let sid = params.session_id.clone();
        let event_data = format!("ssh-data-{}", sid);
        let event_exit = format!("ssh-exit-{}", sid);

        // Background reader thread
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                let read_res = {
                    let mut ch = channel_arc.lock();
                    ch.read(&mut buf)
                };

                match read_res {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(&event_data, text);
                    }
                    Err(_) => {
                        thread::sleep(std::time::Duration::from_millis(20));
                    }
                }

                // Check if channel is closed
                let is_closed = {
                    let ch = channel_arc.lock();
                    ch.eof()
                };
                if is_closed {
                    break;
                }
            }
            let _ = app.emit(&event_exit, ());
        });

        Ok(())
    }

    pub fn write_data(&self, session_id: &str, data: &str) -> Result<(), String> {
        let conns = self.connections.lock();
        if let Some(conn) = conns.get(session_id) {
            let mut ch = conn.channel_writer.lock();
            ch.write_all(data.as_bytes())
                .map_err(|e| format!("Failed to write SSH data: {}", e))?;
            ch.flush().map_err(|e| format!("SSH flush error: {}", e))?;
            Ok(())
        } else {
            Err("SSH session not found".into())
        }
    }

    pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let conns = self.connections.lock();
        if let Some(conn) = conns.get(session_id) {
            let mut ch = conn.channel_writer.lock();
            let _ = ch.request_pty_size(cols, rows, None, None);
            Ok(())
        } else {
            Err("SSH session not found".into())
        }
    }

    pub fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let mut conns = self.connections.lock();
        conns.remove(session_id);
        Ok(())
    }

    pub fn sftp_list(&self, session_id: &str, remote_path: &str) -> Result<Vec<SftpFileEntry>, String> {
        let conns = self.connections.lock();
        if let Some(conn) = conns.get(session_id) {
            let sess = conn.session.lock();
            let sftp = sess.sftp().map_err(|e| format!("SFTP init error: {}", e))?;
            let path_obj = Path::new(remote_path);
            let dir = sftp
                .readdir(path_obj)
                .map_err(|e| format!("Failed to read SFTP path '{}': {}", remote_path, e))?;

            let mut entries = Vec::new();
            for (p, stat) in dir {
                let name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                if name == "." || name == ".." {
                    continue;
                }

                let full_path = p.to_string_lossy().to_string().replace('\\', "/");
                entries.push(SftpFileEntry {
                    name,
                    path: full_path,
                    is_dir: stat.is_dir(),
                    size: stat.size.unwrap_or(0),
                    modified: stat.mtime.unwrap_or(0),
                    permissions: stat.perm.unwrap_or(0),
                });
            }

            // Sort directories first, then alphabetical
            entries.sort_by(|a, b| {
                if a.is_dir == b.is_dir {
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                } else if a.is_dir {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                }
            });

            Ok(entries)
        } else {
            Err("SSH session not found".into())
        }
    }

    pub fn sftp_read_file(&self, session_id: &str, path: &str) -> Result<String, String> {
        let conns = self.connections.lock();
        if let Some(conn) = conns.get(session_id) {
            let sess = conn.session.lock();
            let sftp = sess.sftp().map_err(|e| format!("SFTP init error: {}", e))?;
            let mut file = sftp
                .open(Path::new(path))
                .map_err(|e| format!("Failed to open file: {}", e))?;

            let mut contents = String::new();
            file.read_to_string(&mut contents)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            Ok(contents)
        } else {
            Err("SSH session not found".into())
        }
    }

    pub fn sftp_write_file(&self, session_id: &str, path: &str, content: &str) -> Result<(), String> {
        let conns = self.connections.lock();
        if let Some(conn) = conns.get(session_id) {
            let sess = conn.session.lock();
            let sftp = sess.sftp().map_err(|e| format!("SFTP init error: {}", e))?;
            let mut file = sftp
                .create(Path::new(path))
                .map_err(|e| format!("Failed to create file: {}", e))?;

            file.write_all(content.as_bytes())
                .map_err(|e| format!("Failed to write to file: {}", e))?;
            Ok(())
        } else {
            Err("SSH session not found".into())
        }
    }
}
