mod pty;
mod ssh;

use pty::PtyState;
use ssh::{SftpFileEntry, SshConnectParams, SshState};
use tauri::{AppHandle, State};

#[tauri::command]
fn get_system_shells() -> Vec<String> {
    let mut shells = Vec::new();
    if cfg!(target_os = "windows") {
        shells.push("powershell".to_string());
        shells.push("cmd".to_string());
        shells.push("wsl".to_string());
    } else {
        shells.push("bash".to_string());
        shells.push("zsh".to_string());
        shells.push("sh".to_string());
    }
    shells
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
    shell: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.spawn_shell(app, session_id, shell, cols, rows)
}

#[tauri::command]
fn pty_write(state: State<'_, PtyState>, session_id: String, data: String) -> Result<(), String> {
    state.write_data(&session_id, &data)
}

#[tauri::command]
fn pty_resize(state: State<'_, PtyState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(&session_id, cols, rows)
}

#[tauri::command]
fn pty_kill(state: State<'_, PtyState>, session_id: String) -> Result<(), String> {
    state.kill(&session_id)
}

#[tauri::command]
fn ssh_connect(
    app: AppHandle,
    state: State<'_, SshState>,
    params: SshConnectParams,
) -> Result<(), String> {
    state.connect(app, params)
}

#[tauri::command]
fn ssh_write(state: State<'_, SshState>, session_id: String, data: String) -> Result<(), String> {
    state.write_data(&session_id, &data)
}

#[tauri::command]
fn ssh_resize(state: State<'_, SshState>, session_id: String, cols: u32, rows: u32) -> Result<(), String> {
    state.resize(&session_id, cols, rows)
}

#[tauri::command]
fn ssh_disconnect(state: State<'_, SshState>, session_id: String) -> Result<(), String> {
    state.disconnect(&session_id)
}

#[tauri::command]
fn sftp_list(
    state: State<'_, SshState>,
    session_id: String,
    remote_path: String,
) -> Result<Vec<SftpFileEntry>, String> {
    state.sftp_list(&session_id, &remote_path)
}

#[tauri::command]
fn sftp_read_file(
    state: State<'_, SshState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    state.sftp_read_file(&session_id, &path)
}

#[tauri::command]
fn sftp_write_file(
    state: State<'_, SshState>,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    state.sftp_write_file(&session_id, &path, &content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_state = PtyState::new();
    let ssh_state = SshState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty_state)
        .manage(ssh_state)
        .invoke_handler(tauri::generate_handler![
            get_system_shells,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            sftp_list,
            sftp_read_file,
            sftp_write_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
