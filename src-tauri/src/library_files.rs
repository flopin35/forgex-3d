//! My Parts: reusable parts kept as .forgexpart files in one library folder
//! (Documents\FORGEX 3D\Library), shared by every project and by the MCP server.
//! The app parses the files; this module only lists, reads, writes and deletes them,
//! and never touches anything outside the library folder.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::project_files::write_atomically;

pub const PART_EXTENSION: &str = "forgexpart";
pub const MAX_PART_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize)]
pub struct LibraryFile {
    pub file: String,
    pub contents: String,
}

/// A plain file name ending in .forgexpart: letters, digits, spaces, dots, dashes and underscores only.
pub fn is_part_file_name(file: &str) -> bool {
    let lower = file.to_ascii_lowercase();
    !file.is_empty()
        && file.len() <= 80
        && !file.starts_with('.')
        && lower.ends_with(&format!(".{PART_EXTENSION}"))
        && file
            .chars()
            .all(|c| c.is_alphanumeric() || c == ' ' || c == '.' || c == '-' || c == '_')
}

fn part_path(folder: &Path, file: &str) -> Result<PathBuf, String> {
    if is_part_file_name(file) {
        Ok(folder.join(file))
    } else {
        Err(format!("{file} is not a part file name."))
    }
}

pub fn list(folder: &Path) -> Result<Vec<LibraryFile>, String> {
    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        // No library folder yet: an empty library.
        Err(_) => return Ok(Vec::new()),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_part_file_name(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || meta.len() > MAX_PART_BYTES {
            continue;
        }
        if let Ok(contents) = fs::read_to_string(entry.path()) {
            out.push(LibraryFile { file: name, contents });
        }
    }
    Ok(out)
}

pub fn read(folder: &Path, file: &str) -> Result<String, String> {
    let path = part_path(folder, file)?;
    let meta = fs::metadata(&path).map_err(|_| format!("There is no part called {file} in My Parts."))?;
    if meta.len() > MAX_PART_BYTES {
        return Err(format!("{file} is larger than the 64 MB limit for a part."));
    }
    fs::read_to_string(&path).map_err(|e| format!("Could not read {file}: {e}"))
}

pub fn write(folder: &Path, file: &str, contents: &str, overwrite: bool) -> Result<(), String> {
    let path = part_path(folder, file)?;
    fs::create_dir_all(folder).map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
    if !overwrite && path.exists() {
        return Err(format!("My Parts already has {file}. Choose another name or replace it."));
    }
    write_atomically(&path, contents.as_bytes()).map_err(|e| format!("Could not save {file}: {e}"))
}

pub fn delete(folder: &Path, file: &str) -> Result<(), String> {
    let path = part_path(folder, file)?;
    fs::remove_file(&path).map_err(|e| format!("Could not delete {file}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_plain_part_names() {
        assert!(is_part_file_name("Sport wheel.forgexpart"));
        assert!(is_part_file_name("door_2-left.FORGEXPART"));
        assert!(!is_part_file_name("..\\evil.forgexpart"));
        assert!(!is_part_file_name("../evil.forgexpart"));
        assert!(!is_part_file_name("C:\\x.forgexpart"));
        assert!(!is_part_file_name("wheel.forgex"));
        assert!(!is_part_file_name(".hidden.forgexpart"));
    }

    #[test]
    fn writes_lists_reads_and_deletes() {
        let folder = std::env::temp_dir().join(format!("forgex-library-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        assert!(list(&folder).unwrap().is_empty());
        write(&folder, "Wheel.forgexpart", "{}", false).unwrap();
        assert!(write(&folder, "Wheel.forgexpart", "{}", false).is_err());
        write(&folder, "Wheel.forgexpart", "{\"a\":1}", true).unwrap();
        assert_eq!(read(&folder, "Wheel.forgexpart").unwrap(), "{\"a\":1}");
        assert_eq!(list(&folder).unwrap().len(), 1);
        delete(&folder, "Wheel.forgexpart").unwrap();
        assert!(list(&folder).unwrap().is_empty());
        let _ = fs::remove_dir_all(&folder);
    }
}
