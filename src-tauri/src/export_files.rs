//! Writing exported models (.glb). The app sends the file as base64 text, which is
//! decoded here and written with the same safe temp-file-then-rename step as projects.

use std::path::Path;

use crate::project_files::write_atomically;

pub const EXPORT_EXTENSIONS: [&str; 1] = ["glb"];
/// Exports larger than this are refused so a runaway scene cannot fill the disk.
pub const MAX_EXPORT_BYTES: usize = 1024 * 1024 * 1024;

fn require_export_path(path: &Path) -> Result<(), String> {
    let allowed = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| EXPORT_EXTENSIONS.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
        .unwrap_or(false);
    if allowed {
        Ok(())
    } else {
        Err(format!("FORGEX 3D exports .glb files only ({}).", path.display()))
    }
}

fn base64_value(byte: u8) -> Option<u32> {
    match byte {
        b'A'..=b'Z' => Some(u32::from(byte - b'A')),
        b'a'..=b'z' => Some(u32::from(byte - b'a') + 26),
        b'0'..=b'9' => Some(u32::from(byte - b'0') + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Decodes standard base64 (with or without `=` padding). Whitespace is not allowed.
pub fn decode_base64(text: &str) -> Result<Vec<u8>, String> {
    let bytes = text.trim_end_matches('=').as_bytes();
    if bytes.len() % 4 == 1 {
        return Err("The export data is not valid base64 (bad length).".into());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3 + 3);
    for chunk in bytes.chunks(4) {
        let mut buffer: u32 = 0;
        for (i, &byte) in chunk.iter().enumerate() {
            let value = base64_value(byte).ok_or_else(|| format!("The export data is not valid base64 (character {}).", byte as char))?;
            buffer |= value << (18 - 6 * i);
        }
        out.push((buffer >> 16) as u8);
        if chunk.len() > 2 {
            out.push((buffer >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(buffer as u8);
        }
    }
    Ok(out)
}

pub fn write_export(path: &Path, base64: &str) -> Result<(), String> {
    require_export_path(path)?;
    if base64.len() / 4 * 3 > MAX_EXPORT_BYTES {
        return Err(format!("The export is larger than the {} MB limit.", MAX_EXPORT_BYTES / (1024 * 1024)));
    }
    let bytes = decode_base64(base64)?;
    write_atomically(path, &bytes).map_err(|e| format!("Could not export {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn decodes_base64_with_and_without_padding() {
        assert_eq!(decode_base64("").unwrap(), b"");
        assert_eq!(decode_base64("Zg==").unwrap(), b"f");
        assert_eq!(decode_base64("Zm8=").unwrap(), b"fo");
        assert_eq!(decode_base64("Zm9v").unwrap(), b"foo");
        assert_eq!(decode_base64("Zm9vYg").unwrap(), b"foob");
        assert_eq!(decode_base64("Z2xURgIAAAA=").unwrap(), b"glTF\x02\x00\x00\x00");
        assert_eq!(decode_base64("/+8=").unwrap(), vec![0xff, 0xef]);
    }

    #[test]
    fn rejects_bad_base64() {
        assert!(decode_base64("Z").is_err());
        assert!(decode_base64("Zm9v!").is_err());
    }

    #[test]
    fn writes_glb_files_only() {
        let dir = std::env::temp_dir().join(format!("forgex-export-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Sword.glb");
        write_export(&path, "Z2xURgIAAAA=").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"glTF\x02\x00\x00\x00");
        assert!(write_export(&dir.join("Sword.exe"), "Zm9v").is_err());
        assert!(write_export(&dir.join("SWORD.GLB"), "Zm9v").is_ok());
        fs::remove_dir_all(dir).unwrap();
    }
}
