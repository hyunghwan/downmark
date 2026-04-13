use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    ffi::OsString,
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use sys_locale::get_locale;
use tauri::{
    menu::{
        CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, MenuItemKind,
        PredefinedMenuItem, Submenu, SubmenuBuilder,
    },
    utils::config::WindowConfig,
    AppHandle, Emitter, Manager, Runtime, State, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window,
};
use tauri_plugin_dialog::DialogExt;

#[cfg(target_os = "macos")]
use objc2::{
    ffi::{class_addMethod, class_respondsToSelector},
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel, MainThreadMarker,
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApp, NSApplication, NSApplicationDelegateReply};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSString};

const MENU_ACTION_EVENT: &str = "downmark://menu-action";
const OPEN_PATHS_EVENT: &str = "downmark://open-paths";
const SETTINGS_FILE_NAME: &str = "settings.json";
const MAX_RECENT_FILES: usize = 12;
const EDITOR_WINDOW_LABEL_PREFIX: &str = "editor-";
const MENU_NEW_DRAFT_ID: &str = "file.new";
const MENU_OPEN_FILE_ID: &str = "file.open";
const MENU_SAVE_FILE_ID: &str = "file.save";
const MENU_SAVE_FILE_AS_ID: &str = "file.save-as";
const MENU_RICH_MODE_ID: &str = "view.mode-rich";
const MENU_RAW_MODE_ID: &str = "view.mode-raw";
const MENU_LANGUAGE_SYSTEM_ID: &str = "view.language.system";
const MENU_LANGUAGE_EN_ID: &str = "view.language.en";
const MENU_LANGUAGE_KO_ID: &str = "view.language.ko";
const MENU_LANGUAGE_ES_ID: &str = "view.language.es";

#[cfg(target_os = "macos")]
static MACOS_OPEN_FILES_APP_HANDLE: OnceLock<AppHandle<tauri::Wry>> = OnceLock::new();
#[cfg(target_os = "macos")]
static MACOS_PENDING_OPEN_FILES: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
#[cfg(target_os = "macos")]
static MACOS_OPEN_FILES_HANDLER_INSTALLED: OnceLock<()> = OnceLock::new();

struct WindowRegistry(Mutex<WindowRegistryState>);

#[derive(Default)]
struct WindowRegistryState {
    next_window_index: usize,
    window_paths: HashMap<String, Option<String>>,
    document_windows: HashMap<String, String>,
    launch_paths: HashMap<String, String>,
    pending_writes: HashMap<String, String>,
}

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
struct PrepareImageAssetRequest {
    document_path: String,
    source_path: Option<String>,
    bytes: Option<Vec<u8>>,
    mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PreparedImageAsset {
    relative_path: String,
    absolute_path: String,
    alt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileStatusResponse {
    kind: String,
    fingerprint: Option<FileFingerprint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAppSettings {
    #[serde(default)]
    recent_files: Vec<RecentFile>,
    #[serde(default)]
    language_preference: LanguagePreference,
    #[serde(default = "default_document_zoom_percent")]
    document_zoom_percent: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    recent_files: Vec<RecentFile>,
    language_preference: LanguagePreference,
    document_zoom_percent: u16,
    locale: SupportedLocale,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecentFile {
    path: String,
    display_name: String,
    last_opened_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuActionPayload {
    action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPathsPayload {
    paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
enum LanguagePreference {
    #[default]
    System,
    En,
    Ko,
    Es,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SupportedLocale {
    En,
    Ko,
    Es,
}

impl Default for StoredAppSettings {
    fn default() -> Self {
        Self {
            recent_files: Vec::new(),
            language_preference: LanguagePreference::default(),
            document_zoom_percent: default_document_zoom_percent(),
        }
    }
}

fn default_document_zoom_percent() -> u16 {
    100
}

fn clamp_document_zoom_percent(value: u16) -> u16 {
    value.clamp(80, 200)
}

#[tauri::command]
fn get_current_window_launch_path(
    window: Window,
    registry: State<'_, WindowRegistry>,
) -> Option<String> {
    take_window_launch_path(window.label(), registry.inner())
}

#[tauri::command]
fn new_draft_window(app: AppHandle, registry: State<'_, WindowRegistry>) -> Result<(), String> {
    create_blank_window(&app, registry.inner())
}

#[tauri::command]
fn open_path_in_new_window(
    app: AppHandle,
    registry: State<'_, WindowRegistry>,
    path: String,
) -> Result<(), String> {
    create_or_focus_document_window(&app, registry.inner(), &path)
}

#[tauri::command]
fn sync_current_window_path(
    window: Window,
    registry: State<'_, WindowRegistry>,
    path: Option<String>,
) -> Result<(), String> {
    sync_window_document_path(&window.app_handle(), window.label(), path, registry.inner())
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
fn save_file(
    window: Window,
    registry: State<'_, WindowRegistry>,
    request: SaveFileRequest,
) -> Result<SaveFileResult, String> {
    let window_label = window.label().to_string();
    let path = resolve_window_document_path(Path::new(&request.path))?;
    let next_document_key = path.to_string_lossy().into_owned();
    reserve_document_key_for_write(
        window.app_handle(),
        &window_label,
        &next_document_key,
        registry.inner(),
    )?;

    if let Some(expected) = &request.expected_fingerprint {
        let current = fingerprint_for_existing_path(&path).map_err(|error| error.to_string())?;
        if current.exists && &current != expected {
            release_document_key_write_reservation(
                &window_label,
                &next_document_key,
                registry.inner(),
            );
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
        release_document_key_write_reservation(&window_label, &next_document_key, registry.inner());
    }
    write_result?;

    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let fingerprint =
        fingerprint_from_bytes(&bytes, true, &path).map_err(|error| error.to_string())?;

    let result = SaveFileResult {
        path: path.to_string_lossy().into_owned(),
        display_name: file_name_for_display(&path),
        newline_style: request.newline_style,
        encoding: "utf-8".to_string(),
        fingerprint,
    };

    if let Err(error) = sync_window_document_path(
        &window.app_handle(),
        &window_label,
        Some(result.path.clone()),
        registry.inner(),
    ) {
        release_document_key_write_reservation(&window_label, &next_document_key, registry.inner());
        return Err(error);
    }

    Ok(result)
}

#[tauri::command]
fn prepare_image_asset(request: PrepareImageAssetRequest) -> Result<PreparedImageAsset, String> {
    let document_path = PathBuf::from(&request.document_path);
    let document_directory = document_path
        .parent()
        .ok_or_else(|| "Document path must include a parent directory".to_string())?;
    let document_stem = document_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("document");

    fs::create_dir_all(document_directory).map_err(|error| error.to_string())?;

    let source_count =
        usize::from(request.source_path.is_some()) + usize::from(request.bytes.is_some());
    if source_count != 1 {
        return Err("Provide exactly one image source.".to_string());
    }

    let extension = if let Some(source_path) = &request.source_path {
        infer_extension_from_path(Path::new(source_path))
            .ok_or_else(|| "Unable to determine image extension from source path.".to_string())?
    } else {
        infer_extension_from_mime(request.mime_type.as_deref())
            .ok_or_else(|| "Unable to determine image extension from clipboard data.".to_string())?
    };

    let target_path = next_image_asset_path(document_directory, document_stem, &extension);

    let alt = if let Some(source_path) = request.source_path {
        let source = PathBuf::from(source_path);
        if !source.exists() {
            return Err("Image source file does not exist.".to_string());
        }

        fs::copy(&source, &target_path).map_err(|error| error.to_string())?;
        file_stem_for_display(&source)
    } else if let Some(bytes) = request.bytes {
        fs::write(&target_path, bytes).map_err(|error| error.to_string())?;
        file_stem_for_display(&target_path)
    } else {
        return Err("No image source provided.".to_string());
    };

    let file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Unable to derive image file name.".to_string())?;

    Ok(PreparedImageAsset {
        relative_path: encode_url_path_component(file_name),
        absolute_path: target_path.to_string_lossy().into_owned(),
        alt,
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
fn set_language_preference(
    app: AppHandle,
    language_preference: LanguagePreference,
) -> Result<AppSettings, String> {
    let mut settings = read_settings(&app)?;
    settings.language_preference = language_preference;
    settings.locale = resolve_locale_from_preference(language_preference, get_locale().as_deref());
    write_settings(&app, &settings)?;

    let menu = build_app_menu(&app).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;

    Ok(settings)
}

#[tauri::command]
fn set_document_zoom_percent(
    app: AppHandle,
    document_zoom_percent: u16,
) -> Result<AppSettings, String> {
    let mut settings = read_settings(&app)?;
    settings.document_zoom_percent = clamp_document_zoom_percent(document_zoom_percent);
    write_settings(&app, &settings)?;
    Ok(settings)
}

fn language_preference_from_menu_id(id: &str) -> Option<LanguagePreference> {
    match id {
        MENU_LANGUAGE_SYSTEM_ID => Some(LanguagePreference::System),
        MENU_LANGUAGE_EN_ID => Some(LanguagePreference::En),
        MENU_LANGUAGE_KO_ID => Some(LanguagePreference::Ko),
        MENU_LANGUAGE_ES_ID => Some(LanguagePreference::Es),
        _ => None,
    }
}

fn sync_language_menu_selection<R: Runtime>(
    app: &AppHandle<R>,
    language_preference: LanguagePreference,
) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };

    set_language_item_checked(
        &menu,
        MENU_LANGUAGE_SYSTEM_ID,
        language_preference == LanguagePreference::System,
    )?;
    set_language_item_checked(
        &menu,
        MENU_LANGUAGE_EN_ID,
        language_preference == LanguagePreference::En,
    )?;
    set_language_item_checked(
        &menu,
        MENU_LANGUAGE_KO_ID,
        language_preference == LanguagePreference::Ko,
    )?;
    set_language_item_checked(
        &menu,
        MENU_LANGUAGE_ES_ID,
        language_preference == LanguagePreference::Es,
    )?;

    Ok(())
}

fn set_language_item_checked<R: Runtime>(
    menu: &Menu<R>,
    id: &str,
    checked: bool,
) -> tauri::Result<()> {
    if let Some(item) = find_check_menu_item_in_menu(menu, id)? {
        item.set_checked(checked)?;
    }

    Ok(())
}

fn find_check_menu_item_in_menu<R: Runtime>(
    menu: &Menu<R>,
    id: &str,
) -> tauri::Result<Option<CheckMenuItem<R>>> {
    find_check_menu_item_in_items(menu.items()?, id)
}

fn find_check_menu_item_in_submenu<R: Runtime>(
    submenu: &Submenu<R>,
    id: &str,
) -> tauri::Result<Option<CheckMenuItem<R>>> {
    find_check_menu_item_in_items(submenu.items()?, id)
}

fn find_check_menu_item_in_items<R: Runtime>(
    items: Vec<MenuItemKind<R>>,
    id: &str,
) -> tauri::Result<Option<CheckMenuItem<R>>> {
    for item in items {
        if item.id() == &id {
            return Ok(item.as_check_menuitem().cloned());
        }

        if let Some(submenu) = item.as_submenu() {
            if let Some(found) = find_check_menu_item_in_submenu(submenu, id)? {
                return Ok(Some(found));
            }
        }
    }

    Ok(None)
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

fn assign_window_launch_path(
    window_label: &str,
    path: &str,
    registry: &WindowRegistry,
) -> Result<(), String> {
    let document_key = resolve_existing_document_key(Path::new(path))?;
    register_window_document(window_label, Some(document_key.clone()), registry);
    let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
    registry_state
        .launch_paths
        .insert(window_label.to_string(), document_key);
    Ok(())
}

fn emit_open_paths_to_window<R: Runtime>(window: &WebviewWindow<R>, paths: Vec<String>) {
    let payload = OpenPathsPayload { paths };
    let _ = window.emit(OPEN_PATHS_EVENT, payload);
}

fn reserve_blank_main_window_launch_path(
    registry: &WindowRegistry,
    first_path: &str,
) -> Result<bool, String> {
    let should_reuse_main = {
        let registry_state = registry.0.lock().expect("window registry lock poisoned");
        matches!(registry_state.window_paths.get("main"), Some(None))
    };

    if !should_reuse_main {
        return Ok(false);
    }

    assign_window_launch_path("main", first_path, registry)?;
    Ok(true)
}

fn try_dispatch_open_paths_to_blank_main_window<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WindowRegistry,
    paths: &[String],
) -> usize {
    let Some(first_path) = paths.first() else {
        return 0;
    };

    let reserved_main = reserve_blank_main_window_launch_path(registry, first_path)
        .unwrap_or(false);
    if !reserved_main {
        return 0;
    }

    if let Some(window) = app.get_webview_window("main") {
        emit_open_paths_to_window(&window, vec![first_path.clone()]);
        focus_window_by_label(app, "main");
    }
    1
}

fn open_paths_for_app<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WindowRegistry,
    paths: Vec<String>,
) {
    let dispatched_count = try_dispatch_open_paths_to_blank_main_window(app, registry, &paths);

    for path in paths.into_iter().skip(dispatched_count) {
        let _ = create_or_focus_document_window(app, registry, &path);
    }
}

#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn application_open_files(
    _this: &AnyObject,
    _cmd: Sel,
    sender: &NSApplication,
    filenames: &NSArray<NSString>,
) {
    let paths = collect_paths_from_nsstrings(filenames);
    dispatch_macos_open_files(paths);
    sender.replyToOpenOrPrint(NSApplicationDelegateReply::Success);
}

#[cfg(target_os = "macos")]
unsafe fn install_macos_open_files_handler_on_main_thread() -> Result<(), String> {
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "macOS open-files handler must be installed on the main thread".to_string())?;
    let app = NSApp(mtm);
    let delegate = app
        .delegate()
        .ok_or_else(|| "Failed to access the macOS application delegate".to_string())?;
    let delegate_object: &AnyObject = delegate.as_ref();
    let delegate_class = delegate_object.class() as *const AnyClass as *mut AnyClass;
    let selector = sel!(application:openFiles:);

    if unsafe { class_respondsToSelector(delegate_class.cast_const(), selector) }.as_bool() {
        return Ok(());
    }

    let added = unsafe {
        class_addMethod(
            delegate_class,
            selector,
            std::mem::transmute::<
                unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSApplication, &NSArray<NSString>),
                Imp,
            >(application_open_files),
            b"v@:@@\0".as_ptr().cast(),
        )
    };

    if added.as_bool() {
        return Ok(());
    }

    Err("Failed to add macOS application:openFiles: handler".to_string())
}

#[cfg(target_os = "macos")]
fn install_macos_open_files_handler(app: &AppHandle<tauri::Wry>) -> Result<(), String> {
    if MACOS_OPEN_FILES_HANDLER_INSTALLED.get().is_some() {
        return Ok(());
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let app_handle = app.clone();
    app_handle
        .run_on_main_thread(move || {
            let result = unsafe { install_macos_open_files_handler_on_main_thread() };
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

    rx.recv()
        .map_err(|error| error.to_string())?
        .map(|_| {
            let _ = MACOS_OPEN_FILES_HANDLER_INSTALLED.set(());
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_paths = collect_path_args(std::env::args_os().skip(1));
    let startup_settings = default_app_settings();

    let app = tauri::Builder::default()
        .enable_macos_default_menu(false)
        .menu(move |app| build_app_menu_with_settings(app, &startup_settings))
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .setup(move |app| {
            let settings = read_settings(app.handle()).unwrap_or_else(|_| default_app_settings());
            let menu = build_app_menu_with_settings(app.handle(), &settings)?;
            app.set_menu(menu)?;

            let app_handle = app.handle().clone();
            #[cfg(target_os = "macos")]
            install_macos_open_files_handler(&app_handle)?;
            #[cfg(target_os = "macos")]
            let _ = MACOS_OPEN_FILES_APP_HANDLE.set(app_handle.clone());

            let registry = app.state::<WindowRegistry>();
            register_window_document("main", None, registry.inner());

            let mut startup_paths = launch_paths.clone();
            #[cfg(target_os = "macos")]
            for path in take_pending_macos_open_files() {
                if !startup_paths.contains(&path) {
                    startup_paths.push(path);
                }
            }

            if let Some(first_path) = startup_paths.first() {
                let _ = assign_window_launch_path("main", first_path, registry.inner());
            }

            for path in startup_paths.iter().skip(1) {
                let _ = create_or_focus_document_window(&app_handle, registry.inner(), path);
            }
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = collect_path_args(args.into_iter().skip(1));
            let registry = app.state::<WindowRegistry>();

            if paths.is_empty() {
                if let Some(window) = focusable_webview_window(app) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    let _ = create_blank_window(app, registry.inner());
                }
                return;
            }

            open_paths_for_app(&app, registry.inner(), paths);
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(WindowRegistry(Mutex::new(WindowRegistryState::default())))
        .invoke_handler(tauri::generate_handler![
            check_file_status,
            get_current_window_launch_path,
            load_settings,
            new_draft_window,
            open_file,
            open_path_in_new_window,
            path_exists,
            prepare_image_asset,
            record_recent_file,
            remove_recent_file,
            save_file,
            set_document_zoom_percent,
            set_language_preference,
            sync_current_window_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        match event {
            tauri::RunEvent::Opened { urls } => {
                let paths = collect_paths_from_urls(urls);
                dispatch_macos_open_files(paths);
            }
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    let registry = app_handle.state::<WindowRegistry>();
                    let _ = create_blank_window(app_handle, registry.inner());
                }
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                let registry = app_handle.state::<WindowRegistry>();
                unregister_window(&label, registry.inner());
            }
            _ => {}
        }
        #[cfg(not(target_os = "macos"))]
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } = event
        {
            let registry = app_handle.state::<WindowRegistry>();
            unregister_window(&label, registry.inner());
        }
    });
}

fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings = read_settings(app).unwrap_or_else(|_| default_app_settings());
    build_app_menu_with_settings(app, &settings)
}

fn build_app_menu_with_settings<R: Runtime>(
    app: &AppHandle<R>,
    settings: &AppSettings,
) -> tauri::Result<Menu<R>> {
    let strings = menu_strings(settings.locale);

    let new_draft = MenuItemBuilder::with_id(MENU_NEW_DRAFT_ID, strings.new_draft)
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_file = MenuItemBuilder::with_id(MENU_OPEN_FILE_ID, strings.open_file)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save_file = MenuItemBuilder::with_id(MENU_SAVE_FILE_ID, strings.save_file)
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_file_as = MenuItemBuilder::with_id(MENU_SAVE_FILE_AS_ID, strings.save_file_as)
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let rich_mode = MenuItemBuilder::with_id(MENU_RICH_MODE_ID, strings.rich_mode)
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let raw_mode = MenuItemBuilder::with_id(MENU_RAW_MODE_ID, strings.raw_mode)
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let language_system =
        CheckMenuItemBuilder::with_id(MENU_LANGUAGE_SYSTEM_ID, strings.system_default)
            .checked(settings.language_preference == LanguagePreference::System)
            .build(app)?;
    let language_en = CheckMenuItemBuilder::with_id(MENU_LANGUAGE_EN_ID, strings.english)
        .checked(settings.language_preference == LanguagePreference::En)
        .build(app)?;
    let language_ko = CheckMenuItemBuilder::with_id(MENU_LANGUAGE_KO_ID, strings.korean)
        .checked(settings.language_preference == LanguagePreference::Ko)
        .build(app)?;
    let language_es = CheckMenuItemBuilder::with_id(MENU_LANGUAGE_ES_ID, strings.spanish)
        .checked(settings.language_preference == LanguagePreference::Es)
        .build(app)?;

    let separator = PredefinedMenuItem::separator(app)?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;
    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let maximize = PredefinedMenuItem::maximize(app, None)?;

    #[cfg(target_os = "macos")]
    let fullscreen = Some(PredefinedMenuItem::fullscreen(app, None)?);
    #[cfg(not(target_os = "macos"))]
    let fullscreen: Option<PredefinedMenuItem<R>> = None;

    #[cfg(target_os = "macos")]
    let app_menu = {
        let about = PredefinedMenuItem::about(app, Some(strings.about), None)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app, None)?;
        let show_all = PredefinedMenuItem::show_all(app, None)?;
        let services = PredefinedMenuItem::services(app, None)?;
        let quit = PredefinedMenuItem::quit(app, None)?;
        Some(
            SubmenuBuilder::new(app, strings.app_name)
                .item(&about)
                .separator()
                .item(&services)
                .separator()
                .item(&hide)
                .item(&hide_others)
                .item(&show_all)
                .separator()
                .item(&quit)
                .build()?,
        )
    };
    #[cfg(not(target_os = "macos"))]
    let app_menu: Option<tauri::menu::Submenu<R>> = None;

    let file_menu = SubmenuBuilder::new(app, strings.file_menu)
        .item(&new_draft)
        .item(&open_file)
        .separator()
        .item(&save_file)
        .item(&save_file_as)
        .separator()
        .item(&close_window)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, strings.edit_menu)
        .item(&undo)
        .item(&redo)
        .item(&separator)
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .item(&select_all)
        .build()?;

    let language_menu = SubmenuBuilder::new(app, strings.language_menu)
        .item(&language_system)
        .item(&language_en)
        .item(&language_ko)
        .item(&language_es)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, strings.view_menu)
        .item(&rich_mode)
        .item(&raw_mode)
        .separator()
        .item(&language_menu)
        .build()?;

    let mut window_builder = SubmenuBuilder::new(app, strings.window_menu)
        .item(&minimize)
        .item(&maximize);
    if let Some(fullscreen) = &fullscreen {
        window_builder = window_builder.item(fullscreen);
    }
    let window_menu = window_builder.build()?;

    let mut menu_builder = MenuBuilder::new(app);
    if let Some(app_menu) = &app_menu {
        menu_builder = menu_builder.item(app_menu);
    }

    menu_builder
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(language_preference) = language_preference_from_menu_id(id) {
        let _ = sync_language_menu_selection(app, language_preference);
    }

    match id {
        MENU_NEW_DRAFT_ID => {
            let registry = app.state::<WindowRegistry>();
            let _ = create_blank_window(app, registry.inner());
        }
        MENU_OPEN_FILE_ID => {
            if let Some(window) = focused_webview_window(app) {
                emit_menu_action_to_window(&window, "open-file");
            } else {
                pick_markdown_file_for_app(app);
            }
        }
        MENU_SAVE_FILE_ID => emit_menu_action_to_focused_window(app, "save-file"),
        MENU_SAVE_FILE_AS_ID => emit_menu_action_to_focused_window(app, "save-file-as"),
        MENU_RICH_MODE_ID => emit_menu_action_to_focused_window(app, "set-rich-mode"),
        MENU_RAW_MODE_ID => emit_menu_action_to_focused_window(app, "set-raw-mode"),
        MENU_LANGUAGE_SYSTEM_ID => emit_menu_action_to_focused_window(app, "set-language-system"),
        MENU_LANGUAGE_EN_ID => emit_menu_action_to_focused_window(app, "set-language-en"),
        MENU_LANGUAGE_KO_ID => emit_menu_action_to_focused_window(app, "set-language-ko"),
        MENU_LANGUAGE_ES_ID => emit_menu_action_to_focused_window(app, "set-language-es"),
        _ => {}
    }
}

fn emit_menu_action_to_focused_window<R: Runtime>(app: &AppHandle<R>, action: &str) {
    if let Some(window) = focused_webview_window(app) {
        emit_menu_action_to_window(&window, action);
    }
}

fn emit_menu_action_to_window<R: Runtime>(window: &WebviewWindow<R>, action: &str) {
    let payload = MenuActionPayload {
        action: action.to_string(),
    };
    let _ = window.emit(MENU_ACTION_EVENT, payload);
}

fn pick_markdown_file_for_app<R: Runtime>(app: &AppHandle<R>) {
    let app_handle = app.clone();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown"])
        .pick_file(move |file_path| {
            let Some(file_path) = file_path else {
                return;
            };

            let Ok(path) = file_path.into_path() else {
                return;
            };
            let registry = app_handle.state::<WindowRegistry>();
            let _ = create_or_focus_document_window(
                &app_handle,
                registry.inner(),
                &path.to_string_lossy(),
            );
        });
}

struct MenuStrings {
    about: &'static str,
    app_name: &'static str,
    edit_menu: &'static str,
    english: &'static str,
    file_menu: &'static str,
    korean: &'static str,
    language_menu: &'static str,
    new_draft: &'static str,
    open_file: &'static str,
    raw_mode: &'static str,
    rich_mode: &'static str,
    save_file: &'static str,
    save_file_as: &'static str,
    spanish: &'static str,
    system_default: &'static str,
    view_menu: &'static str,
    window_menu: &'static str,
}

fn menu_strings(locale: SupportedLocale) -> MenuStrings {
    match locale {
        SupportedLocale::Ko => MenuStrings {
            about: "Downmark 정보",
            app_name: "Downmark",
            edit_menu: "편집",
            english: "English",
            file_menu: "파일",
            korean: "한국어",
            language_menu: "언어",
            new_draft: "새 문서",
            open_file: "열기…",
            raw_mode: "원문 모드",
            rich_mode: "리치 모드",
            save_file: "저장",
            save_file_as: "다른 이름으로 저장…",
            spanish: "Español",
            system_default: "시스템 기본값",
            view_menu: "보기",
            window_menu: "윈도우",
        },
        SupportedLocale::Es => MenuStrings {
            about: "Acerca de Downmark",
            app_name: "Downmark",
            edit_menu: "Editar",
            english: "English",
            file_menu: "Archivo",
            korean: "한국어",
            language_menu: "Idioma",
            new_draft: "Nuevo",
            open_file: "Abrir…",
            raw_mode: "Modo sin formato",
            rich_mode: "Modo enriquecido",
            save_file: "Guardar",
            save_file_as: "Guardar como…",
            spanish: "Español",
            system_default: "Predeterminado del sistema",
            view_menu: "Ver",
            window_menu: "Ventana",
        },
        SupportedLocale::En => MenuStrings {
            about: "About Downmark",
            app_name: "Downmark",
            edit_menu: "Edit",
            english: "English",
            file_menu: "File",
            korean: "한국어",
            language_menu: "Language",
            new_draft: "New",
            open_file: "Open…",
            raw_mode: "Raw Mode",
            rich_mode: "Rich Mode",
            save_file: "Save",
            save_file_as: "Save As…",
            spanish: "Español",
            system_default: "System Default",
            view_menu: "View",
            window_menu: "Window",
        },
    }
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

            normalize_open_arg(raw.as_ref())
        })
        .collect()
}

fn collect_paths_from_urls<I>(urls: I) -> Vec<String>
where
    I: IntoIterator<Item = Url>,
{
    urls.into_iter()
        .filter_map(|url| {
            if url.scheme() != "file" {
                return None;
            }

            normalize_open_path(url.to_file_path().ok()?)
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn collect_paths_from_nsstrings(filenames: &NSArray<NSString>) -> Vec<String> {
    (0..filenames.count())
        .filter_map(|index| {
            let filename = filenames.objectAtIndex(index);
            normalize_open_path(PathBuf::from(filename.to_string()))
        })
        .collect()
}

fn normalize_open_path(path: PathBuf) -> Option<String> {
    if !is_supported_markdown_path(&path) {
        return None;
    }

    Some(path.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
fn pending_macos_open_files() -> &'static Mutex<Vec<String>> {
    MACOS_PENDING_OPEN_FILES.get_or_init(|| Mutex::new(Vec::new()))
}

#[cfg(target_os = "macos")]
fn queue_macos_open_files(paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    let mut pending_paths = pending_macos_open_files()
        .lock()
        .expect("macOS open-files queue lock poisoned");
    pending_paths.extend(paths);
}

#[cfg(target_os = "macos")]
fn take_pending_macos_open_files() -> Vec<String> {
    let mut pending_paths = pending_macos_open_files()
        .lock()
        .expect("macOS open-files queue lock poisoned");
    std::mem::take(&mut *pending_paths)
}

#[cfg(target_os = "macos")]
fn dispatch_macos_open_files(paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Some(app_handle) = MACOS_OPEN_FILES_APP_HANDLE.get() {
        let registry = app_handle.state::<WindowRegistry>();
        open_paths_for_app(app_handle, registry.inner(), paths);
        return;
    }

    queue_macos_open_files(paths);
}

fn normalize_open_arg(raw: &str) -> Option<String> {
    if let Ok(url) = Url::parse(raw) {
        if url.scheme() != "file" {
            return None;
        }

        return normalize_open_path(url.to_file_path().ok()?);
    }

    normalize_open_path(PathBuf::from(raw))
}

fn is_supported_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("md")
                || extension.eq_ignore_ascii_case("markdown")
                || extension.eq_ignore_ascii_case("mdown")
        })
        .unwrap_or(false)
}

fn register_window_document(
    window_label: &str,
    document_key: Option<String>,
    registry: &WindowRegistry,
) {
    let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
    if let Some(previous_document_key) = registry_state
        .window_paths
        .insert(window_label.to_string(), document_key.clone())
        .flatten()
    {
        registry_state
            .document_windows
            .remove(&previous_document_key);
    }

    if let Some(document_key) = document_key {
        if matches!(
            registry_state.pending_writes.get(&document_key),
            Some(existing_label) if existing_label == window_label
        ) {
            registry_state.pending_writes.remove(&document_key);
        }
        registry_state
            .document_windows
            .insert(document_key, window_label.to_string());
    }
}

fn unregister_window(window_label: &str, registry: &WindowRegistry) {
    let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
    if let Some(document_key) = registry_state.window_paths.remove(window_label).flatten() {
        registry_state.document_windows.remove(&document_key);
    }
    registry_state.launch_paths.remove(window_label);
    registry_state
        .pending_writes
        .retain(|_, owner| owner != window_label);
}

fn take_window_launch_path(window_label: &str, registry: &WindowRegistry) -> Option<String> {
    let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
    registry_state.launch_paths.remove(window_label)
}

fn sync_window_document_path(
    app: &AppHandle<impl Runtime>,
    window_label: &str,
    path: Option<String>,
    registry: &WindowRegistry,
) -> Result<(), String> {
    let document_key = match path {
        Some(path) => Some(
            resolve_window_document_path(Path::new(&path))?
                .to_string_lossy()
                .into_owned(),
        ),
        None => None,
    };

    {
        let registry_state = registry.0.lock().expect("window registry lock poisoned");
        if let Some(document_key) = &document_key {
            if let Some(existing_label) = registry_state.document_windows.get(document_key).cloned()
            {
                if existing_label != window_label {
                    drop(registry_state);
                    focus_window_by_label(app, &existing_label);
                    return Err(format!("already-open:{document_key}"));
                }
            }

            if let Some(existing_label) = registry_state.pending_writes.get(document_key).cloned() {
                if existing_label != window_label {
                    drop(registry_state);
                    focus_window_by_label(app, &existing_label);
                    return Err(format!("already-open:{document_key}"));
                }
            }
        }
    }

    register_window_document(window_label, document_key, registry);
    Ok(())
}

fn reserve_document_key_for_write(
    app: &AppHandle<impl Runtime>,
    window_label: &str,
    document_key: &str,
    registry: &WindowRegistry,
) -> Result<(), String> {
    let conflicting_label = {
        let mut registry_state = registry.0.lock().expect("window registry lock poisoned");

        if let Some(existing_label) = registry_state.document_windows.get(document_key).cloned() {
            if existing_label != window_label {
                Some(existing_label)
            } else {
                registry_state
                    .pending_writes
                    .insert(document_key.to_string(), window_label.to_string());
                None
            }
        } else if let Some(existing_label) =
            registry_state.pending_writes.get(document_key).cloned()
        {
            if existing_label != window_label {
                Some(existing_label)
            } else {
                None
            }
        } else {
            registry_state
                .pending_writes
                .insert(document_key.to_string(), window_label.to_string());
            None
        }
    };

    if let Some(existing_label) = conflicting_label {
        focus_window_by_label(app, &existing_label);
        return Err(format!("already-open:{document_key}"));
    }

    Ok(())
}

fn release_document_key_write_reservation(
    window_label: &str,
    document_key: &str,
    registry: &WindowRegistry,
) {
    let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
    if matches!(
        registry_state.pending_writes.get(document_key),
        Some(existing_label) if existing_label == window_label
    ) {
        registry_state.pending_writes.remove(document_key);
    }
}

fn focus_window_by_label<R: Runtime>(app: &AppHandle<R>, window_label: &str) {
    if let Some(window) = app.get_webview_window(window_label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn focused_webview_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
}

fn focusable_webview_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    focused_webview_window(app).or_else(|| app.webview_windows().into_values().next())
}

fn resolve_existing_document_key(path: &Path) -> Result<String, String> {
    if !is_supported_markdown_path(path) {
        return Err("unsupported-file-type".to_string());
    }

    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    Ok(canonical.to_string_lossy().into_owned())
}

fn resolve_window_document_path(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(path)
    };

    Ok(fs::canonicalize(&absolute).unwrap_or_else(|_| normalize_absolute_path(&absolute)))
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    let mut segments: Vec<OsString> = Vec::new();
    let mut has_root = false;

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => {
                normalized.push(component.as_os_str());
                has_root = true;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if let Some(last) = segments.last() {
                    if last != std::ffi::OsStr::new("..") {
                        segments.pop();
                    } else if !has_root {
                        segments.push(component.as_os_str().to_os_string());
                    }
                } else if !has_root {
                    segments.push(component.as_os_str().to_os_string());
                }
            }
            Component::Normal(segment) => segments.push(segment.to_os_string()),
        }
    }

    for segment in segments {
        normalized.push(segment);
    }

    normalized
}

fn next_editor_window_label(registry: &WindowRegistry) -> String {
    let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
    registry_state.next_window_index += 1;
    format!(
        "{EDITOR_WINDOW_LABEL_PREFIX}{}",
        registry_state.next_window_index
    )
}

fn main_window_config<R: Runtime>(app: &AppHandle<R>) -> Result<WindowConfig, String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or_else(|| "Unable to locate the main window configuration.".to_string())
}

fn build_editor_window<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WindowRegistry,
    window_label: &str,
    launch_path: Option<String>,
) -> Result<(), String> {
    {
        let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
        registry_state
            .window_paths
            .entry(window_label.to_string())
            .or_insert_with(|| launch_path.clone());
        if let Some(path) = launch_path.clone() {
            registry_state
                .launch_paths
                .insert(window_label.to_string(), path.clone());
            registry_state
                .document_windows
                .insert(path, window_label.to_string());
        }
    }

    let mut config = main_window_config(app)?;
    config.label = window_label.to_string();
    config.create = false;
    config.url = WebviewUrl::default();

    let build_result = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string());

    match build_result {
        Ok(_window) => {
            #[cfg(not(target_os = "macos"))]
            if let Some(menu) = app.menu() {
                let _ = _window.set_menu(menu);
            }
            Ok(())
        }
        Err(error) => {
            unregister_window(window_label, registry);
            Err(error)
        }
    }
}

fn create_blank_window<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WindowRegistry,
) -> Result<(), String> {
    let window_label = next_editor_window_label(registry);
    register_window_document(&window_label, None, registry);
    build_editor_window(app, registry, &window_label, None)
}

fn create_or_focus_document_window<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WindowRegistry,
    path: &str,
) -> Result<(), String> {
    let document_key = resolve_existing_document_key(Path::new(path))?;

    {
        let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
        if let Some(window_label) = registry_state.document_windows.get(&document_key).cloned() {
            if app.get_webview_window(&window_label).is_some() {
                drop(registry_state);
                focus_window_by_label(app, &window_label);
                return Ok(());
            }

            registry_state.document_windows.remove(&document_key);
            registry_state.window_paths.remove(&window_label);
            registry_state.launch_paths.remove(&window_label);
        }
    }

    let window_label = next_editor_window_label(registry);
    build_editor_window(app, registry, &window_label, Some(document_key))
}

fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(default_app_settings());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let stored_settings: StoredAppSettings =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(hydrate_settings(stored_settings))
}

fn write_settings<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_string_pretty(&StoredAppSettings {
        recent_files: settings.recent_files.clone(),
        language_preference: settings.language_preference,
        document_zoom_percent: settings.document_zoom_percent,
    })
    .map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

fn default_app_settings() -> AppSettings {
    hydrate_settings(StoredAppSettings::default())
}

fn hydrate_settings(stored_settings: StoredAppSettings) -> AppSettings {
    AppSettings {
        recent_files: stored_settings.recent_files,
        language_preference: stored_settings.language_preference,
        document_zoom_percent: clamp_document_zoom_percent(stored_settings.document_zoom_percent),
        locale: resolve_locale_from_preference(
            stored_settings.language_preference,
            get_locale().as_deref(),
        ),
    }
}

fn resolve_locale_from_preference(
    preference: LanguagePreference,
    system_locale: Option<&str>,
) -> SupportedLocale {
    match preference {
        LanguagePreference::System => resolve_supported_locale(system_locale),
        LanguagePreference::En => SupportedLocale::En,
        LanguagePreference::Ko => SupportedLocale::Ko,
        LanguagePreference::Es => SupportedLocale::Es,
    }
}

fn resolve_supported_locale(raw_locale: Option<&str>) -> SupportedLocale {
    let normalized = raw_locale.unwrap_or("en").trim().to_lowercase();
    let primary_tag = normalized.split(['-', '_']).next().unwrap_or("en");

    match primary_tag {
        "ko" => SupportedLocale::Ko,
        "es" => SupportedLocale::Es,
        _ => SupportedLocale::En,
    }
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

fn file_stem_for_display(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| file_name_for_display(path))
}

fn infer_extension_from_path(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .and_then(sanitize_extension)
}

fn infer_extension_from_mime(mime_type: Option<&str>) -> Option<String> {
    let normalized = mime_type?.trim().to_ascii_lowercase();
    let extension = match normalized.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "image/avif" => "avif",
        _ => return None,
    };

    Some(extension.to_string())
}

fn sanitize_extension(raw: &str) -> Option<String> {
    let normalized = raw.trim().trim_start_matches('.').to_ascii_lowercase();
    if normalized.is_empty()
        || !normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return None;
    }

    Some(normalized)
}

fn next_image_asset_path(directory: &Path, document_stem: &str, extension: &str) -> PathBuf {
    let mut index = 1;

    loop {
        let candidate = directory.join(format!("{document_stem}-image-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }

        index += 1;
    }
}

fn encode_url_path_component(value: &str) -> String {
    let mut encoded = String::new();

    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(char::from(*byte))
            }
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }

    encoded
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
    use super::{
        assign_window_launch_path, canonicalize_markdown, collect_path_args,
        collect_paths_from_urls, default_app_settings, detect_newline_style, hydrate_settings,
        normalize_absolute_path, normalize_newlines, prepare_image_asset, register_window_document,
        reserve_blank_main_window_launch_path, resolve_existing_document_key,
        resolve_supported_locale, resolve_window_document_path, unregister_window, AppSettings,
        LanguagePreference, PrepareImageAssetRequest, PreparedImageAsset, RecentFile,
        StoredAppSettings, SupportedLocale, WindowRegistry, WindowRegistryState,
    };
    use std::{
        ffi::OsString,
        fs,
        path::{Path, PathBuf},
        sync::Mutex,
    };
    use tauri::Url;

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

    #[test]
    fn resolves_korean_locale() {
        assert_eq!(resolve_supported_locale(Some("ko-KR")), SupportedLocale::Ko);
    }

    #[test]
    fn resolves_spanish_locale() {
        assert_eq!(resolve_supported_locale(Some("es-MX")), SupportedLocale::Es);
    }

    #[test]
    fn falls_back_to_english_locale() {
        assert_eq!(resolve_supported_locale(Some("fr-FR")), SupportedLocale::En);
    }

    #[test]
    fn stored_settings_default_to_system_language() {
        let settings = default_app_settings();

        assert_eq!(settings.language_preference, LanguagePreference::System);
        assert_eq!(settings.document_zoom_percent, 100);
    }

    #[test]
    fn settings_round_trip_through_storage_format() {
        let stored = StoredAppSettings {
            recent_files: vec![RecentFile {
                path: "/notes/current.md".to_string(),
                display_name: "current.md".to_string(),
                last_opened_ms: 42,
            }],
            language_preference: LanguagePreference::Ko,
            document_zoom_percent: 130,
        };
        let json = serde_json::to_string(&stored).expect("serializes settings");
        let decoded: StoredAppSettings =
            serde_json::from_str(&json).expect("deserializes settings");
        let hydrated = hydrate_settings(decoded);

        assert_eq!(
            hydrated,
            AppSettings {
                recent_files: vec![RecentFile {
                    path: "/notes/current.md".to_string(),
                    display_name: "current.md".to_string(),
                    last_opened_ms: 42,
                }],
                language_preference: LanguagePreference::Ko,
                document_zoom_percent: 130,
                locale: SupportedLocale::Ko,
            }
        );
    }

    #[test]
    fn prepare_image_asset_copies_local_files_next_to_document() {
        let directory = create_test_directory("copy");
        let source_path = directory.join("screenshot source.png");
        let document_path = directory.join("My Note.md");
        fs::write(&source_path, b"png-bytes").expect("writes source image");

        let prepared = prepare_image_asset(PrepareImageAssetRequest {
            document_path: document_path.to_string_lossy().into_owned(),
            source_path: Some(source_path.to_string_lossy().into_owned()),
            bytes: None,
            mime_type: None,
        })
        .expect("copies image");

        assert_eq!(
            prepared,
            PreparedImageAsset {
                relative_path: "My%20Note-image-1.png".to_string(),
                absolute_path: directory
                    .join("My Note-image-1.png")
                    .to_string_lossy()
                    .into_owned(),
                alt: "screenshot source".to_string(),
            }
        );
        assert_eq!(
            fs::read(directory.join("My Note-image-1.png")).expect("reads copied file"),
            b"png-bytes"
        );

        fs::remove_dir_all(directory).expect("cleans up temp directory");
    }

    #[test]
    fn prepare_image_asset_increments_file_names_when_needed() {
        let directory = create_test_directory("increment");
        let source_path = directory.join("clip.png");
        let document_path = directory.join("current.md");
        fs::write(&source_path, b"first").expect("writes source image");
        fs::write(directory.join("current-image-1.png"), b"existing").expect("writes existing");

        let prepared = prepare_image_asset(PrepareImageAssetRequest {
            document_path: document_path.to_string_lossy().into_owned(),
            source_path: Some(source_path.to_string_lossy().into_owned()),
            bytes: None,
            mime_type: None,
        })
        .expect("creates unique file");

        assert_eq!(prepared.relative_path, "current-image-2.png");
        assert!(directory.join("current-image-2.png").exists());

        fs::remove_dir_all(directory).expect("cleans up temp directory");
    }

    #[test]
    fn prepare_image_asset_writes_clipboard_bytes_with_extension_from_mime() {
        let directory = create_test_directory("clipboard");
        let document_path = directory.join("capture.md");

        let prepared = prepare_image_asset(PrepareImageAssetRequest {
            document_path: document_path.to_string_lossy().into_owned(),
            source_path: None,
            bytes: Some(vec![1, 2, 3, 4]),
            mime_type: Some("image/webp".to_string()),
        })
        .expect("writes clipboard image");

        assert_eq!(prepared.relative_path, "capture-image-1.webp");
        assert_eq!(prepared.alt, "capture-image-1");
        assert_eq!(
            fs::read(directory.join("capture-image-1.webp")).expect("reads saved bytes"),
            vec![1, 2, 3, 4]
        );

        fs::remove_dir_all(directory).expect("cleans up temp directory");
    }

    #[test]
    fn collect_path_args_keeps_supported_markdown_files() {
        let paths = collect_path_args([
            OsString::from("Downmark"),
            OsString::from("/notes/current.md"),
            OsString::from("/notes/ignore.txt"),
            OsString::from("/notes/Guide.MARKDOWN"),
        ]);

        assert_eq!(
            paths,
            vec![
                "/notes/current.md".to_string(),
                "/notes/Guide.MARKDOWN".to_string(),
            ]
        );
    }

    #[test]
    fn collect_path_args_accepts_file_url_arguments() {
        let file_url = Url::from_file_path("/Users/byun/notes/current.md")
            .expect("builds file url")
            .to_string();

        assert_eq!(
            collect_path_args([OsString::from(file_url)]),
            vec!["/Users/byun/notes/current.md".to_string()]
        );
    }

    #[test]
    fn collect_paths_from_urls_accepts_supported_file_urls_only() {
        let urls = vec![
            Url::parse("file:///Users/byun/notes/current.md").expect("parses markdown url"),
            Url::parse("file:///Users/byun/notes/ignore.txt").expect("parses text url"),
            Url::parse("https://example.com/remote.md").expect("parses https url"),
            Url::parse("file:///Users/byun/notes/Guide.MDOWN").expect("parses uppercase url"),
        ];

        assert_eq!(
            collect_paths_from_urls(urls),
            vec![
                "/Users/byun/notes/current.md".to_string(),
                "/Users/byun/notes/Guide.MDOWN".to_string(),
            ]
        );
    }

    #[test]
    fn normalize_absolute_path_collapses_dot_segments() {
        let normalized = normalize_absolute_path(Path::new("/notes/./drafts/../current.md"));
        assert_eq!(normalized, PathBuf::from("/notes/current.md"));
    }

    #[test]
    fn resolve_window_document_path_normalizes_nonexistent_targets() {
        let path = resolve_window_document_path(Path::new("/notes/drafts/../current.md"))
            .expect("normalizes target");
        assert_eq!(path, PathBuf::from("/notes/current.md"));
    }

    #[test]
    fn resolve_existing_document_key_returns_canonical_path() {
        let directory = create_test_directory("canonical");
        let document_path = directory.join("current.md");
        fs::write(&document_path, "# Current").expect("writes markdown file");

        let key = resolve_existing_document_key(Path::new(&document_path))
            .expect("resolves canonical path");
        assert_eq!(
            key,
            document_path
                .canonicalize()
                .expect("canonical path")
                .to_string_lossy()
        );

        fs::remove_dir_all(directory).expect("cleans up temp directory");
    }

    #[test]
    fn window_registry_replaces_old_document_mapping_and_cleans_up_on_unregister() {
        let registry = WindowRegistry(Mutex::new(WindowRegistryState::default()));

        register_window_document("editor-1", Some("/notes/first.md".to_string()), &registry);
        register_window_document("editor-1", Some("/notes/second.md".to_string()), &registry);

        {
            let registry_state = registry.0.lock().expect("window registry lock poisoned");
            assert_eq!(
                registry_state.window_paths.get("editor-1"),
                Some(&Some("/notes/second.md".to_string()))
            );
            assert!(!registry_state
                .document_windows
                .contains_key("/notes/first.md"));
            assert_eq!(
                registry_state.document_windows.get("/notes/second.md"),
                Some(&"editor-1".to_string())
            );
        }

        unregister_window("editor-1", &registry);

        let registry_state = registry.0.lock().expect("window registry lock poisoned");
        assert!(!registry_state.window_paths.contains_key("editor-1"));
        assert!(!registry_state
            .document_windows
            .contains_key("/notes/second.md"));
    }

    #[test]
    fn window_registry_clears_write_reservations_on_commit_and_unregister() {
        let registry = WindowRegistry(Mutex::new(WindowRegistryState::default()));

        {
            let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
            registry_state
                .pending_writes
                .insert("/notes/second.md".to_string(), "editor-1".to_string());
        }

        register_window_document("editor-1", Some("/notes/second.md".to_string()), &registry);

        {
            let registry_state = registry.0.lock().expect("window registry lock poisoned");
            assert!(!registry_state
                .pending_writes
                .contains_key("/notes/second.md"));
        }

        {
            let mut registry_state = registry.0.lock().expect("window registry lock poisoned");
            registry_state
                .pending_writes
                .insert("/notes/draft.md".to_string(), "editor-1".to_string());
        }

        unregister_window("editor-1", &registry);

        let registry_state = registry.0.lock().expect("window registry lock poisoned");
        assert!(!registry_state
            .pending_writes
            .values()
            .any(|owner| owner == "editor-1"));
    }

    #[test]
    fn assign_window_launch_path_updates_blank_main_window_registry() {
        let registry = WindowRegistry(Mutex::new(WindowRegistryState::default()));
        let directory = create_test_directory("launch-path");
        let document_path = directory.join("current.md");
        fs::write(&document_path, "# Current").expect("writes markdown file");
        let document_key = document_path
            .canonicalize()
            .expect("canonical document path")
            .to_string_lossy()
            .into_owned();
        register_window_document("main", None, &registry);

        assign_window_launch_path("main", &document_path.to_string_lossy(), &registry)
            .expect("assigns launch path");

        let registry_state = registry.0.lock().expect("window registry lock poisoned");
        assert_eq!(
            registry_state.window_paths.get("main"),
            Some(&Some(document_key.clone()))
        );
        assert_eq!(registry_state.launch_paths.get("main"), Some(&document_key));
        assert_eq!(
            registry_state.document_windows.get(&document_key),
            Some(&"main".to_string())
        );

        fs::remove_dir_all(directory).expect("cleans up temp directory");
    }

    #[test]
    fn reserve_blank_main_window_launch_path_works_before_main_window_is_ready() {
        let registry = WindowRegistry(Mutex::new(WindowRegistryState::default()));
        let directory = create_test_directory("launch-path-reserved");
        let document_path = directory.join("current.md");
        fs::write(&document_path, "# Current").expect("writes markdown file");
        let document_key = document_path
            .canonicalize()
            .expect("canonical document path")
            .to_string_lossy()
            .into_owned();
        register_window_document("main", None, &registry);

        let reserved =
            reserve_blank_main_window_launch_path(&registry, &document_path.to_string_lossy())
                .expect("reserves launch path");

        assert!(reserved);

        let registry_state = registry.0.lock().expect("window registry lock poisoned");
        assert_eq!(
            registry_state.window_paths.get("main"),
            Some(&Some(document_key.clone()))
        );
        assert_eq!(registry_state.launch_paths.get("main"), Some(&document_key));
        assert_eq!(
            registry_state.document_windows.get(&document_key),
            Some(&"main".to_string())
        );

        fs::remove_dir_all(directory).expect("cleans up temp directory");
    }

    fn create_test_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "downmark-tests-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("timestamp")
                .as_nanos()
        ));
        fs::create_dir_all(&path).expect("creates temp directory");
        path
    }
}
