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
use sys_locale::get_locale;
use tauri::{
    menu::{
        CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder,
        MenuItemKind, PredefinedMenuItem, Submenu, SubmenuBuilder,
    },
    AppHandle, Emitter, Manager, Runtime, State,
};

const OPEN_REQUEST_EVENT: &str = "downmark://open-paths";
const MENU_ACTION_EVENT: &str = "downmark://menu-action";
const SETTINGS_FILE_NAME: &str = "settings.json";
const MAX_RECENT_FILES: usize = 12;
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
struct OpenPathsPayload {
    paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuActionPayload {
    action: String,
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

    let source_count = usize::from(request.source_path.is_some()) + usize::from(request.bytes.is_some());
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

    set_language_item_checked(&menu, MENU_LANGUAGE_SYSTEM_ID, language_preference == LanguagePreference::System)?;
    set_language_item_checked(&menu, MENU_LANGUAGE_EN_ID, language_preference == LanguagePreference::En)?;
    set_language_item_checked(&menu, MENU_LANGUAGE_KO_ID, language_preference == LanguagePreference::Ko)?;
    set_language_item_checked(&menu, MENU_LANGUAGE_ES_ID, language_preference == LanguagePreference::Es)?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_paths = collect_path_args(std::env::args_os().skip(1));
    let startup_settings = default_app_settings();

    tauri::Builder::default()
        .enable_macos_default_menu(false)
        .menu(move |app| build_app_menu_with_settings(app, &startup_settings))
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .setup(|app| {
            let settings = read_settings(app.handle()).unwrap_or_else(|_| default_app_settings());
            let menu = build_app_menu_with_settings(app.handle(), &settings)?;
            app.set_menu(menu)?;
            Ok(())
        })
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
            prepare_image_asset,
            record_recent_file,
            remove_recent_file,
            save_file,
            set_document_zoom_percent,
            set_language_preference
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    let language_system = CheckMenuItemBuilder::with_id(
        MENU_LANGUAGE_SYSTEM_ID,
        strings.system_default,
    )
    .checked(settings.language_preference == LanguagePreference::System)
    .build(app)?;
    let language_en =
        CheckMenuItemBuilder::with_id(MENU_LANGUAGE_EN_ID, strings.english)
            .checked(settings.language_preference == LanguagePreference::En)
            .build(app)?;
    let language_ko =
        CheckMenuItemBuilder::with_id(MENU_LANGUAGE_KO_ID, strings.korean)
            .checked(settings.language_preference == LanguagePreference::Ko)
            .build(app)?;
    let language_es =
        CheckMenuItemBuilder::with_id(MENU_LANGUAGE_ES_ID, strings.spanish)
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

    let action = match id {
        MENU_NEW_DRAFT_ID => Some("new-draft"),
        MENU_OPEN_FILE_ID => Some("open-file"),
        MENU_SAVE_FILE_ID => Some("save-file"),
        MENU_SAVE_FILE_AS_ID => Some("save-file-as"),
        MENU_RICH_MODE_ID => Some("set-rich-mode"),
        MENU_RAW_MODE_ID => Some("set-raw-mode"),
        MENU_LANGUAGE_SYSTEM_ID => Some("set-language-system"),
        MENU_LANGUAGE_EN_ID => Some("set-language-en"),
        MENU_LANGUAGE_KO_ID => Some("set-language-ko"),
        MENU_LANGUAGE_ES_ID => Some("set-language-es"),
        _ => None,
    };

    if let Some(action) = action {
        emit_menu_action(app, action);
    }
}

fn emit_menu_action<R: Runtime>(app: &AppHandle<R>, action: &str) {
    let payload = MenuActionPayload {
        action: action.to_string(),
    };

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(MENU_ACTION_EVENT, payload);
    } else {
        let _ = app.emit(MENU_ACTION_EVENT, payload);
    }
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
            about: "downmark 정보",
            app_name: "downmark",
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
            about: "Acerca de downmark",
            app_name: "downmark",
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
            about: "About downmark",
            app_name: "downmark",
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
    if normalized.is_empty() || !normalized.chars().all(|character| character.is_ascii_alphanumeric())
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
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~' => encoded.push(char::from(*byte)),
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
        canonicalize_markdown, default_app_settings, detect_newline_style, hydrate_settings,
        normalize_newlines, prepare_image_asset, resolve_supported_locale, AppSettings,
        LanguagePreference, PrepareImageAssetRequest, PreparedImageAsset, RecentFile,
        StoredAppSettings, SupportedLocale,
    };
    use std::{fs, path::PathBuf};

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
