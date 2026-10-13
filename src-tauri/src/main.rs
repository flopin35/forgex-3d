// Hide the extra console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_setup;
mod export_files;
mod library_files;
mod mcp_relay;
mod mini_json;
mod project_files;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

/// Reads a .forgex project. Only .forgex files can be read through this command.
#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    project_files::read_project(Path::new(&path))
}

/// Writes a .forgex project safely: the new contents go to a temporary file first and
/// replace the old file only once fully written, so a failed save never leaves a half file.
#[tauri::command]
fn write_project_file(path: String, contents: String) -> Result<(), String> {
    project_files::write_project(Path::new(&path), &contents)
}

/// Writes an exported model (.glb). The bytes arrive as base64 text.
#[tauri::command]
fn write_export_file(path: String, data: String) -> Result<(), String> {
    export_files::write_export(Path::new(&path), &data)
}

// -- Folders -----------------------------------------------------------------------------

/// Documents\FORGEX 3D: the projects folder, also used by the MCP server (it is told so
/// through FORGEX_PROJECTS_DIR when "Connect to Claude" sets it up).
fn projects_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|home| home.join("Documents")))
        .map_err(|e| format!("Could not find the Documents folder: {e}"))?;
    Ok(documents.join("FORGEX 3D"))
}

fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(projects_dir(app)?.join("Library"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgexPaths {
    projects: String,
    library: String,
}

#[tauri::command]
fn forgex_paths(app: tauri::AppHandle) -> Result<ForgexPaths, String> {
    Ok(ForgexPaths {
        projects: projects_dir(&app)?.to_string_lossy().to_string(),
        library: library_dir(&app)?.to_string_lossy().to_string(),
    })
}

// -- My Parts ------------------------------------------------------------------------------

#[tauri::command]
fn library_list(app: tauri::AppHandle) -> Result<Vec<library_files::LibraryFile>, String> {
    library_files::list(&library_dir(&app)?)
}

#[tauri::command]
fn library_read(app: tauri::AppHandle, file: String) -> Result<String, String> {
    library_files::read(&library_dir(&app)?, &file)
}

#[tauri::command]
fn library_write(app: tauri::AppHandle, file: String, contents: String, overwrite: bool) -> Result<(), String> {
    library_files::write(&library_dir(&app)?, &file, &contents, overwrite)
}

#[tauri::command]
fn library_delete(app: tauri::AppHandle, file: String) -> Result<(), String> {
    library_files::delete(&library_dir(&app)?, &file)
}

// -- AI connection ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatus {
    /// This FORGEX 3D.exe: MCP clients run it with --mcp.
    app_path: String,
    claude_configs: Vec<ai_setup::ClaudeConfigFile>,
    projects: String,
}

#[tauri::command]
fn ai_status(app: tauri::AppHandle) -> Result<AiStatus, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Could not find FORGEX 3D.exe: {e}"))?;
    Ok(AiStatus {
        app_path: exe.to_string_lossy().to_string(),
        claude_configs: ai_setup::claude_config_files(),
        projects: projects_dir(&app)?.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn ai_read_claude_config(path: String) -> Result<Option<String>, String> {
    ai_setup::read_config(Path::new(&path))
}

/// Returns the backup file's path when an existing config was replaced.
#[tauri::command]
fn ai_write_claude_config(path: String, contents: String) -> Result<Option<String>, String> {
    ai_setup::write_config(Path::new(&path), &contents)
}

/// True when this window was opened by an AI assistant (through the --mcp relay), so the
/// start screen is skipped and the assistant's work shows straight away.
#[tauri::command]
fn opened_by_ai() -> bool {
    std::env::args().any(|arg| arg == "--opened-by-ai")
}

/// Shows a folder in Explorer. Only FORGEX's own folders and Claude's config folders are allowed.
#[tauri::command]
fn open_in_explorer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let projects = projects_dir(&app)?;
    let config_folders: Vec<PathBuf> = ai_setup::claude_config_files()
        .into_iter()
        .filter_map(|c| Path::new(&c.path).parent().map(Path::to_path_buf))
        .collect();
    if !target.starts_with(&projects) && !config_folders.iter().any(|f| f == &target) {
        return Err(format!("FORGEX 3D does not open {path}."));
    }
    if target.starts_with(&projects) && !target.exists() {
        std::fs::create_dir_all(&target).map_err(|e| format!("Could not create {path}: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer");
    #[cfg(not(target_os = "windows"))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(&target).spawn().map(|_| ()).map_err(|e| format!("Could not open {path}: {e}"))
}

// -- The built-in MCP server (FORGEX 3D.exe --mcp) --------------------------------------------

/// Opens a new FORGEX 3D window for the relay. On Windows it is started outside the AI app's
/// process group, so quitting the AI app never closes FORGEX (and unsaved work with it).
fn open_app_window(exe: &Path) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let command = |extra: u32| {
        let mut command = Command::new(exe);
        command.arg("--opened-by-ai").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const DETACHED_PROCESS: u32 = 0x0000_0008;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
            command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | extra);
        }
        #[cfg(not(target_os = "windows"))]
        let _ = extra;
        command
    };
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    command(CREATE_BREAKAWAY_FROM_JOB)
        .spawn()
        .or_else(|_| command(0).spawn())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn run_mcp_relay() -> i32 {
    let launch: Option<Box<dyn Fn() -> Result<(), String> + Send + Sync>> = std::env::current_exe()
        .ok()
        .map(|exe| Box::new(move || open_app_window(&exe)) as Box<dyn Fn() -> Result<(), String> + Send + Sync>);
    let config = mcp_relay::RelayConfig::standard(env!("CARGO_PKG_VERSION"), launch);
    mcp_relay::serve(std::io::stdin().lock(), Box::new(std::io::stdout()), config)
}

fn main() {
    // `FORGEX 3D.exe --mcp` is the MCP server for AI apps: no window, just stdin and stdout.
    if std::env::args().any(|arg| arg == "--mcp") {
        std::process::exit(run_mcp_relay());
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_project_file,
            write_project_file,
            write_export_file,
            forgex_paths,
            library_list,
            library_read,
            library_write,
            library_delete,
            ai_status,
            ai_read_claude_config,
            ai_write_claude_config,
            opened_by_ai,
            open_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("FORGEX 3D failed to start");
}
