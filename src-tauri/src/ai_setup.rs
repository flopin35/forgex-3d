//! Connecting AI assistants to FORGEX 3D on this computer.
//!
//! The MCP server is built into FORGEX 3D.exe (run with --mcp), so nothing else needs
//! installing. "Set up Claude Desktop" adds a `forgex-3d` entry that runs this exe to
//! Claude Desktop's config file. The JSON merge itself happens in
//! the app (src/core/ai/claudeConfig.ts, unit-tested); this module finds the files, keeps
//! a backup and writes safely. It only ever writes files named claude_desktop_config.json
//! inside Claude's own config folders.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::project_files::write_atomically;

const CONFIG_NAME: &str = "claude_desktop_config.json";
const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeConfigFile {
    pub path: String,
    pub exists: bool,
    /// The Microsoft Store (MSIX) install keeps its config in a package folder.
    pub packaged: bool,
}

/// Every Claude Desktop config this user could have: the normal install
/// (%APPDATA%\Claude) and any Microsoft Store install
/// (%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude). Only folders that
/// exist are returned; when none exists, the normal location is returned so it can be created.
pub fn claude_config_files() -> Vec<ClaudeConfigFile> {
    let mut out = Vec::new();
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);

    if let Some(local) = &local {
        if let Ok(entries) = fs::read_dir(local.join("Packages")) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with("Claude_") {
                    continue;
                }
                let folder = entry.path().join("LocalCache").join("Roaming").join("Claude");
                if folder.is_dir() {
                    let path = folder.join(CONFIG_NAME);
                    out.push(ClaudeConfigFile { exists: path.is_file(), path: path.to_string_lossy().to_string(), packaged: true });
                }
            }
        }
    }
    if let Some(appdata) = &appdata {
        let folder = appdata.join("Claude");
        if folder.is_dir() || out.is_empty() {
            let path = folder.join(CONFIG_NAME);
            out.push(ClaudeConfigFile { exists: path.is_file(), path: path.to_string_lossy().to_string(), packaged: false });
        }
    }
    out
}

/// True when `path` is one of the config files claude_config_files() reports.
fn is_known_config(path: &Path) -> bool {
    claude_config_files().iter().any(|candidate| Path::new(&candidate.path) == path)
}

pub fn read_config(path: &Path) -> Result<Option<String>, String> {
    if !is_known_config(path) {
        return Err(format!("{} is not a Claude Desktop config file.", path.display()));
    }
    if !path.exists() {
        return Ok(None);
    }
    let meta = fs::metadata(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    if meta.len() > MAX_CONFIG_BYTES {
        return Err(format!("{} is unexpectedly large; it was not changed.", path.display()));
    }
    fs::read_to_string(path).map(Some).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Writes the merged config. The previous file is kept as claude_desktop_config.json.forgex-backup.
pub fn write_config(path: &Path, contents: &str) -> Result<Option<String>, String> {
    if !is_known_config(path) {
        return Err(format!("{} is not a Claude Desktop config file.", path.display()));
    }
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
    }
    let mut backup = None;
    if path.exists() {
        let backup_path = path.with_file_name(format!("{CONFIG_NAME}.forgex-backup"));
        fs::copy(path, &backup_path).map_err(|e| format!("Could not back up {}: {e}", path.display()))?;
        backup = Some(backup_path.to_string_lossy().to_string());
    }
    write_atomically(path, contents.as_bytes()).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_config_files_are_written() {
        let elsewhere = std::env::temp_dir().join("claude_desktop_config.json");
        assert!(write_config(&elsewhere, "{}").is_err());
        assert!(read_config(Path::new("C:\\Windows\\win.ini")).is_err());
    }
}
