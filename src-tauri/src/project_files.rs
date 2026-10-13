//! Native file operations for .forgex projects. Uses only the standard library,
//! so it can be tested without starting the app: `cargo test` in src-tauri.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub const PROJECT_EXTENSION: &str = "forgex";
/// Refuse to load anything larger than this, so a wrong file cannot exhaust memory.
pub const MAX_PROJECT_BYTES: u64 = 512 * 1024 * 1024;

fn require_project_path(path: &Path) -> Result<(), String> {
    let is_project = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(PROJECT_EXTENSION))
        .unwrap_or(false);
    if is_project {
        Ok(())
    } else {
        Err(format!(
            "FORGEX 3D only opens and saves .{PROJECT_EXTENSION} files ({}).",
            path.display()
        ))
    }
}

pub fn read_project(path: &Path) -> Result<String, String> {
    require_project_path(path)?;
    let metadata = fs::metadata(path).map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    if metadata.len() > MAX_PROJECT_BYTES {
        return Err(format!(
            "{} is {} MB, larger than the {} MB limit.",
            path.display(),
            metadata.len() / (1024 * 1024),
            MAX_PROJECT_BYTES / (1024 * 1024)
        ));
    }
    fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

pub fn write_project(path: &Path, contents: &str) -> Result<(), String> {
    require_project_path(path)?;
    // AI tools may save into a projects folder that does not exist yet.
    if let Some(folder) = path.parent().filter(|folder| !folder.as_os_str().is_empty()) {
        fs::create_dir_all(folder).map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
    }
    write_atomically(path, contents.as_bytes()).map_err(|e| format!("Could not save {}: {e}", path.display()))
}

/// The temporary file sits next to the target so the final rename stays on one drive.
fn temporary_path(target: &Path) -> io::Result<PathBuf> {
    let name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "the path has no file name"))?;
    let mut temp_name = OsString::from(".");
    temp_name.push(name);
    temp_name.push(".saving");
    Ok(target.with_file_name(temp_name))
}

/// Writes everything to a temporary file, flushes it to disk, then renames it over the
/// target. If anything fails, the original file is untouched and the temporary file is removed.
pub fn write_atomically(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = temporary_path(target)?;
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forgex-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_and_reads_back_a_project() {
        let dir = scratch_dir("roundtrip");
        let path = dir.join("Car.forgex");
        write_project(&path, "{\"format\":\"forgex-project\"}").unwrap();
        assert_eq!(read_project(&path).unwrap(), "{\"format\":\"forgex-project\"}");
        assert!(!dir.join(".Car.forgex.saving").exists(), "temporary file must be gone");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replaces_an_existing_project() {
        let dir = scratch_dir("replace");
        let path = dir.join("Sword.forgex");
        write_project(&path, "first").unwrap();
        write_project(&path, "second").unwrap();
        assert_eq!(read_project(&path).unwrap(), "second");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_failed_save_keeps_the_original() {
        let dir = scratch_dir("failed");
        let path = dir.join("Base.forgex");
        write_project(&path, "original").unwrap();
        // A directory where the temporary file should go makes the write fail.
        fs::create_dir(dir.join(".Base.forgex.saving")).unwrap();
        assert!(write_project(&path, "broken").is_err());
        assert_eq!(read_project(&path).unwrap(), "original");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_other_file_types() {
        let dir = scratch_dir("types");
        assert!(write_project(&dir.join("notes.txt"), "x").is_err());
        assert!(read_project(&dir.join("system.ini")).is_err());
        assert!(write_project(&dir.join("UPPER.FORGEX"), "ok").is_ok());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reports_a_missing_file_clearly() {
        let error = read_project(Path::new("does-not-exist.forgex")).unwrap_err();
        assert!(error.contains("Could not open"));
    }
}
