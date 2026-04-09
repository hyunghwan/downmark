use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const OPEN_REQUEST_EVENT: &str = "downmark://open-paths";
const SETTINGS_FILE_NAME: &str = "settings.json";
const MAX_RECENT_FILES: usize = 12;

struct LaunchPaths(Mutex<Vec<String>>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileFingerprint {
    exists: bool,
    modified_ms: Option<u64>,
    size: u64,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadedFile {
    path: String,
    display_name: String,
    markdown: String,
    newline_style: String,
    encoding: String,
    fingerprint: FileFingerprint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileRequest {
    path: String,
    markdown: String,
    newline_style: String,
    expected_fingerprint: Option<FileFingerprint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileResult {
    path: String,
    display_name: String,
    newline_style: String,
    encoding: String,
    fingerprint: FileFingerprint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileStatusResponse {
    kind: String,
    fingerprint: Option<FileFingerprint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    recent_files: Vec<RecentFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentFile {
    path: String,
    display_name: String,
    last_opened_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPathsPayload {
    paths: Vec<String>,
}

#[tauri::command]
fn get_initial_open_paths(state: State<'_, LaunchPaths>) -> Vec<String> {
    state.0.lock().expect("launch paths lock poisoned").clone()
}

#[tauri::command]
fn open_file(path: String) -> Result<LoadedFile, String> {
    let path_buf = PathBuf::from(&path);
    let bytes = fs::read(&path_buf).map_err(|error| error.to_string())?;
    let text = String::from_utf8(bytes.clone()).map_err(|error| error.to_string())?;
    let newline_style = detect_newline_style(&text).to_string();
    let fingerprint = fingerprint_from_bytes(&bytes, path_buf.exists(), &path_buf)
        .map_err(|error| error.to_string())?;

    Ok(LoadedFile {
        path: path_buf.to_string_lossy().into_owned(),
        display_name: file_name_for_display(&path_buf),
        markdown: canonicalize_markdown(&text),
        newline_style,
        encoding: "utf-8".to_string(),
        fingerprint,
    })
}

#[tauri::command]
fn save_file(request: SaveFileRequest) -> Result<SaveFileResult, String> {
    let path = PathBuf::from(&request.path);

    if let Some(expected) = &request.expected_fingerprint {
        let current = fingerprint_for_existing_path(&path).map_err(|error| error.to_string())?;
        if current.exists && &current != expected {
            return Err("stale-write".to_string());
        }
    }

    let serialized = normalize_newlines(&request.markdown, &request.newline_style);
    let parent = path
        .parent()
        .ok_or_else(|| "File path must include a parent directory".to_string())?;

    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let temp_path = temp_path_for(&path);
    let write_result = (|| -> Result<(), String> {
        let mut temp_file = File::options()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| error.to_string())?;
        temp_file
            .write_all(serialized.as_bytes())
            .map_err(|error| error.to_string())?;
        temp_file.sync_all().map_err(|error| error.to_string())?;
        replace_existing_file(&temp_path, &path).map_err(|error| error.to_string())?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result?;

    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let fingerprint =
        fingerprint_from_bytes(&bytes, true, &path).map_err(|error| error.to_string())?;

    Ok(SaveFileResult {
        path: path.to_string_lossy().into_owned(),
        display_name: file_name_for_display(&path),
        newline_style: request.newline_style,
        encoding: "utf-8".to_string(),
        fingerprint,
    })
}

#[tauri::command]
fn check_file_status(
    path: String,
    expected_fingerprint: Option<FileFingerprint>,
) -> Result<FileStatusResponse, String> {
    let path = PathBuf::from(path);
    let current = fingerprint_for_existing_path(&path).map_err(|error| error.to_string())?;

    if !current.exists {
        return Ok(FileStatusResponse {
            kind: "missing".to_string(),
            fingerprint: Some(current),
        });
    }

    if let Some(expected) = expected_fingerprint {
        if current == expected {
            return Ok(FileStatusResponse {
                kind: "unchanged".to_string(),
                fingerprint: Some(current),
            });
        }
    }

    Ok(FileStatusResponse {
        kind: "modified".to_string(),
        fingerprint: Some(current),
    })
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    read_settings(&app)
}

#[tauri::command]
fn record_recent_file(app: AppHandle, path: String) -> Result<AppSettings, String> {
    let path_buf = PathBuf::from(&path);
    let mut settings = read_settings(&app)?;

    settings.recent_files.retain(|entry| entry.path != path);
    settings.recent_files.insert(
        0,
        RecentFile {
            path,
            display_name: file_name_for_display(&path_buf),
            last_opened_ms: current_timestamp_ms(),
        },
    );
    settings.recent_files.truncate(MAX_RECENT_FILES);

    write_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn remove_recent_file(app: AppHandle, path: String) -> Result<AppSettings, String> {
    let mut settings = read_settings(&app)?;
    settings.recent_files.retain(|entry| entry.path != path);
    write_settings(&app, &settings)?;
    Ok(settings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_paths = collect_path_args(std::env::args_os().skip(1));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = collect_path_args(args.into_iter().skip(1));

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }

            if !paths.is_empty() {
                let _ = app.emit(OPEN_REQUEST_EVENT, OpenPathsPayload { paths });
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(LaunchPaths(Mutex::new(launch_paths)))
        .invoke_handler(tauri::generate_handler![
            check_file_status,
            get_initial_open_paths,
            load_settings,
            open_file,
            path_exists,
            record_recent_file,
            remove_recent_file,
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn collect_path_args<I>(args: I) -> Vec<String>
where
    I: IntoIterator,
    I::Item: Into<OsString>,
{
    args.into_iter()
        .filter_map(|arg| {
            let arg: OsString = arg.into();
            let raw = arg.to_string_lossy();
            if raw.is_empty() || raw.starts_with("-psn_") || raw.starts_with("--") {
                return None;
            }

            let path = PathBuf::from(raw.as_ref());
            let looks_like_markdown = path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| matches!(extension, "md" | "markdown" | "mdown"))
                .unwrap_or(false);

            if path.exists() || looks_like_markdown {
                Some(path.to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect()
}

fn read_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

fn fingerprint_for_existing_path(path: &Path) -> std::io::Result<FileFingerprint> {
    if !path.exists() {
        return Ok(FileFingerprint {
            exists: false,
            modified_ms: None,
            size: 0,
            sha256: String::new(),
        });
    }

    let bytes = fs::read(path)?;
    fingerprint_from_bytes(&bytes, true, path)
}

fn fingerprint_from_bytes(
    bytes: &[u8],
    exists: bool,
    path: &Path,
) -> std::io::Result<FileFingerprint> {
    let metadata = fs::metadata(path)?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(system_time_to_timestamp_ms);

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let sha256 = format!("{:x}", hasher.finalize());

    Ok(FileFingerprint {
        exists,
        modified_ms,
        size: metadata.len(),
        sha256,
    })
}

fn system_time_to_timestamp_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn current_timestamp_ms() -> u64 {
    system_time_to_timestamp_ms(SystemTime::now()).unwrap_or_default()
}

fn canonicalize_markdown(markdown: &str) -> String {
    markdown.replace("\r\n", "\n").replace('\r', "\n")
}

fn normalize_newlines(markdown: &str, newline_style: &str) -> String {
    let canonical = canonicalize_markdown(markdown);
    if newline_style == "crlf" {
        canonical.replace('\n', "\r\n")
    } else {
        canonical
    }
}

fn detect_newline_style(markdown: &str) -> &'static str {
    if markdown.contains("\r\n") {
        "crlf"
    } else {
        "lf"
    }
}

fn file_name_for_display(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn temp_path_for(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md");
    let timestamp = current_timestamp_ms();
    path.with_file_name(format!(".{stem}.downmark.{timestamp}.{extension}.tmp"))
}

#[cfg(target_os = "windows")]
fn replace_existing_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();

    let ok = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn replace_existing_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

#[cfg(test)]
mod tests {
    use super::{canonicalize_markdown, detect_newline_style, normalize_newlines};

    #[test]
    fn canonicalize_markdown_replaces_crlf() {
        assert_eq!(canonicalize_markdown("a\r\nb\r\n"), "a\nb\n");
    }

    #[test]
    fn normalize_newlines_round_trips_crlf() {
        assert_eq!(normalize_newlines("a\nb", "crlf"), "a\r\nb");
    }

    #[test]
    fn detect_newline_style_prefers_crlf() {
        assert_eq!(detect_newline_style("a\r\nb"), "crlf");
        assert_eq!(detect_newline_style("a\nb"), "lf");
    }
}
