// Hide the extra console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod project_files;

/// Reads a .forgex project. Only .forgex files can be read through this command.
#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    project_files::read_project(std::path::Path::new(&path))
}

/// Writes a .forgex project safely: the new contents go to a temporary file first and
/// replace the old file only once fully written, so a failed save never leaves a half file.
#[tauri::command]
fn write_project_file(path: String, contents: String) -> Result<(), String> {
    project_files::write_project(std::path::Path::new(&path), &contents)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_project_file, write_project_file])
        .run(tauri::generate_context!())
        .expect("FORGEX 3D failed to start");
}
