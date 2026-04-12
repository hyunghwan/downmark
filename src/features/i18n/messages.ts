import {
  getIntlLocale,
  type SupportedLocale,
} from "./locale";

export interface CommandMessages {
  label: string;
  description: string;
  keywords: string[];
}

export interface LocaleMessages {
  intlLocale: string;
  appTitle: string;
  fileDialog: {
    markdownFilterName: string;
    untitledFileName: string;
  };
  busy: {
    opening: string;
    saving: string;
    savingAs: string;
  };
  errors: {
    openFailed: (error: string) => string;
    saveFailed: (error: string) => string;
    staleWrite: string;
    imageAssetFailed: (error: string) => string;
    invalidImageSource: string;
  };
  banners: {
    missing: string;
    staleWrite: string;
    saveFailed: (error: string) => string;
    externallyModified: string;
  };
  workspace: {
    metadataAriaLabel: string;
    saved: string;
    unsaved: string;
    scratchNote: string;
    richEditorStatus: string;
    rawEditorStatus: string;
    recentCount: (count: number) => string;
    openRecentFiles: string;
    closeRecentFiles: string;
    recentFilesAriaLabel: string;
    recentTitle: string;
    recentEmpty: string;
    liveStatus: (parts: { document: string; state: string; editor: string }) => string;
    documentStats: (counts: { characters: number; words: number }) => string;
  };
  prompts: {
    image: string;
    link: string;
    languageChangeRestartBody: string;
    languageChangeRestartTitle: string;
    externalModifiedBody: string;
    externalModifiedTitle: string;
    keepMine: string;
    reloadFromDisk: string;
    saveAs: string;
    unsavedBody: string;
    unsavedTitle: string;
    save: string;
    dontSave: string;
    cancel: string;
  };
  editor: {
    bubbleMenuAriaLabel: string;
    modeToggleAriaLabel: string;
    rawMode: string;
    richMode: string;
    rawEditorAriaLabel: string;
    rawEditorPlaceholder: string;
    richEditorAriaLabel: string;
    richEditorLoading: string;
    richEditorPlaceholder: string;
    slashEmpty: string;
    slashMenuAriaLabel: string;
    tableMenuAriaLabel: string;
    tableColumnHandleLabel: (index: number) => string;
    tableRowHandleLabel: (index: number) => string;
  };
  commands: Record<string, CommandMessages>;
}

function pluralizeEnglish(value: number, singular: string, plural: string) {
  return `${new Intl.NumberFormat("en-US").format(value)} ${
    value === 1 ? singular : plural
  }`;
}

function pluralizeSpanish(value: number, singular: string, plural: string) {
  return `${new Intl.NumberFormat("es-ES").format(value)} ${
    value === 1 ? singular : plural
  }`;
}

function countWithKoreanLabel(value: number, noun: string) {
  return `${noun} ${new Intl.NumberFormat("ko-KR").format(value)}개`;
}

const EN_MESSAGES: LocaleMessages = {
  intlLocale: getIntlLocale("en"),
  appTitle: "Downmark",
  fileDialog: {
    markdownFilterName: "Markdown",
    untitledFileName: "Untitled.md",
  },
  busy: {
    opening: "Opening",
    saving: "Saving",
    savingAs: "Saving as",
  },
  errors: {
    openFailed: (error) => `Unable to open file.\n\n${error}`,
    saveFailed: (error) => `Save failed.\n\n${error}`,
    staleWrite:
      "The file changed on disk before save completed. Review the on-disk version or use Save As.",
    imageAssetFailed: (error) => `Unable to add image.\n\n${error}`,
    invalidImageSource: "Enter an image URL or an absolute file path.",
  },
  banners: {
    missing:
      "File missing on disk. Keep editing here, then use Save As to keep your changes.",
    staleWrite:
      "Disk version changed before save finished. Reload from disk or use Save As.",
    saveFailed: (error) => `Save failed: ${error}`,
    externallyModified: "Disk version changed while you still have unsaved edits.",
  },
  workspace: {
    metadataAriaLabel: "Document metadata",
    saved: "Saved",
    unsaved: "Unsaved",
    scratchNote: "Scratch note",
    richEditorStatus: "Rich editor",
    rawEditorStatus: "Raw editor",
    recentCount: (count) =>
      `${new Intl.NumberFormat("en-US").format(count)} recent ${
        count === 1 ? "file" : "files"
      }`,
    openRecentFiles: "Open recent files",
    closeRecentFiles: "Close recent files",
    recentFilesAriaLabel: "Recent files",
    recentTitle: "Recent",
    recentEmpty: "Recent files will appear here.",
    liveStatus: ({ document, state, editor }) => [document, state, editor].join(". "),
    documentStats: ({ characters, words }) =>
      `${pluralizeEnglish(words, "word", "words")} · ${pluralizeEnglish(
        characters,
        "char",
        "chars",
      )}`,
  },
  prompts: {
    image: "Enter an image URL or absolute file path",
    link: "Enter a URL",
    languageChangeRestartBody:
      "The language preference was saved. Relaunch Downmark to finish applying it.",
    languageChangeRestartTitle: "Restart to apply language change",
    externalModifiedBody:
      "The document changed on disk while you still have unsaved edits in Downmark.",
    externalModifiedTitle: "File changed on disk",
    keepMine: "Keep Mine",
    reloadFromDisk: "Reload from Disk",
    saveAs: "Save As",
    unsavedBody: "You have unsaved changes. Save them before continuing?",
    unsavedTitle: "Unsaved changes",
    save: "Save",
    dontSave: "Don't Save",
    cancel: "Cancel",
  },
  editor: {
    bubbleMenuAriaLabel: "Text formatting",
    modeToggleAriaLabel: "Editor mode",
    rawMode: "Raw",
    richMode: "Rich",
    rawEditorAriaLabel: "Raw markdown editor",
    rawEditorPlaceholder: "Write markdown directly…",
    richEditorAriaLabel: "Rich text editor",
    richEditorLoading: "Preparing editor…",
    richEditorPlaceholder: "Start typing a note, or use / for commands.",
    slashEmpty: "No matching command",
    slashMenuAriaLabel: "Slash commands",
    tableMenuAriaLabel: "Table actions",
    tableColumnHandleLabel: (index) => `Select or move column ${index}`,
    tableRowHandleLabel: (index) => `Select or move row ${index}`,
  },
  commands: {
    paragraph: {
      label: "Paragraph",
      description: "Turn the current block into plain paragraph text.",
      keywords: ["body", "text", "paragraph"],
    },
    "heading-1": {
      label: "Heading 1",
      description: "Large section heading.",
      keywords: ["title", "h1", "section", "heading"],
    },
    "heading-2": {
      label: "Heading 2",
      description: "Medium section heading.",
      keywords: ["subtitle", "h2", "heading"],
    },
    "heading-3": {
      label: "Heading 3",
      description: "Small section heading.",
      keywords: ["h3", "heading"],
    },
    bold: {
      label: "Bold",
      description: "Emphasize selected text strongly.",
      keywords: ["bold", "strong"],
    },
    italic: {
      label: "Italic",
      description: "Add gentle emphasis.",
      keywords: ["italic", "emphasis", "slanted"],
    },
    strike: {
      label: "Strike",
      description: "Cross out selected text.",
      keywords: ["strike", "strikethrough"],
    },
    "inline-code": {
      label: "Inline Code",
      description: "Format selected text as inline code.",
      keywords: ["code", "snippet", "inline"],
    },
    link: {
      label: "Link",
      description: "Attach a URL to the current selection.",
      keywords: ["link", "url", "href"],
    },
    image: {
      label: "Image",
      description: "Insert an image from a URL or local file path.",
      keywords: ["image", "picture", "photo", "media"],
    },
    "bullet-list": {
      label: "Bullet List",
      description: "Create an unordered list.",
      keywords: ["list", "unordered", "bullet"],
    },
    "ordered-list": {
      label: "Numbered List",
      description: "Create an ordered list.",
      keywords: ["list", "ordered", "numbered"],
    },
    "task-list": {
      label: "Checklist",
      description: "Create a task list with checkboxes.",
      keywords: ["tasks", "todos", "checklist"],
    },
    blockquote: {
      label: "Quote",
      description: "Wrap the block in a quote.",
      keywords: ["blockquote", "callout", "quote"],
    },
    "code-block": {
      label: "Code Block",
      description: "Create a fenced code block.",
      keywords: ["snippet", "fence", "code"],
    },
    table: {
      label: "Table",
      description: "Insert a markdown table with a header row.",
      keywords: ["table", "grid", "columns", "rows"],
    },
    "table-add-row-after": {
      label: "Add Row Below",
      description: "Insert a row below the current table row.",
      keywords: ["table", "row", "below", "add"],
    },
    "table-add-column-after": {
      label: "Add Column Right",
      description: "Insert a column to the right of the current table column.",
      keywords: ["table", "column", "right", "add"],
    },
    "table-delete-row": {
      label: "Delete Row",
      description: "Remove the current table row.",
      keywords: ["table", "row", "delete", "remove"],
    },
    "table-delete-column": {
      label: "Delete Column",
      description: "Remove the current table column.",
      keywords: ["table", "column", "delete", "remove"],
    },
    "horizontal-rule": {
      label: "Divider",
      description: "Insert a horizontal rule.",
      keywords: ["separator", "rule", "line", "divider"],
    },
  },
};

const KO_MESSAGES: LocaleMessages = {
  intlLocale: getIntlLocale("ko"),
  appTitle: "Downmark",
  fileDialog: {
    markdownFilterName: "마크다운",
    untitledFileName: "제목 없음.md",
  },
  busy: {
    opening: "여는 중",
    saving: "저장 중",
    savingAs: "다른 이름으로 저장 중",
  },
  errors: {
    openFailed: (error) => `파일을 열 수 없습니다.\n\n${error}`,
    saveFailed: (error) => `저장하지 못했습니다.\n\n${error}`,
    staleWrite:
      "저장 중인 사이 디스크의 파일이 바뀌었습니다. 디스크 버전을 검토하거나 다른 이름으로 저장하세요.",
    imageAssetFailed: (error) => `이미지를 추가하지 못했습니다.\n\n${error}`,
    invalidImageSource: "이미지 URL 또는 로컬 절대 경로를 입력하세요.",
  },
  banners: {
    missing:
      "디스크에서 파일을 찾을 수 없습니다. 계속 편집한 뒤 변경사항을 보존하려면 다른 이름으로 저장하세요.",
    staleWrite:
      "저장이 끝나기 전에 디스크 버전이 바뀌었습니다. 디스크에서 다시 불러오거나 다른 이름으로 저장하세요.",
    saveFailed: (error) => `저장 실패: ${error}`,
    externallyModified: "저장하지 않은 변경사항이 있는 동안 디스크 버전이 바뀌었습니다.",
  },
  workspace: {
    metadataAriaLabel: "문서 메타데이터",
    saved: "저장됨",
    unsaved: "미저장",
    scratchNote: "임시 노트",
    richEditorStatus: "리치 에디터",
    rawEditorStatus: "원문 에디터",
    recentCount: (count) =>
      `최근 파일 ${new Intl.NumberFormat("ko-KR").format(count)}개`,
    openRecentFiles: "최근 파일 열기",
    closeRecentFiles: "최근 파일 닫기",
    recentFilesAriaLabel: "최근 파일",
    recentTitle: "최근 파일",
    recentEmpty: "최근 파일이 여기에 표시됩니다.",
    liveStatus: ({ document, state, editor }) => [document, state, editor].join(". "),
    documentStats: ({ characters, words }) =>
      `${countWithKoreanLabel(words, "단어")} · ${countWithKoreanLabel(
        characters,
        "문자",
      )}`,
  },
  prompts: {
    image: "이미지 URL 또는 로컬 절대 경로를 입력하세요",
    link: "URL을 입력하세요",
    languageChangeRestartBody:
      "언어 설정을 저장했습니다. 변경을 완전히 적용하려면 Downmark를 다시 실행하세요.",
    languageChangeRestartTitle: "언어 변경을 적용하려면 다시 실행하세요",
    externalModifiedBody:
      "Downmark에서 저장하지 않은 변경사항이 있는 동안 디스크의 문서가 바뀌었습니다.",
    externalModifiedTitle: "디스크의 파일이 변경됨",
    keepMine: "내 내용 유지",
    reloadFromDisk: "디스크에서 다시 불러오기",
    saveAs: "다른 이름으로 저장",
    unsavedBody: "저장하지 않은 변경사항이 있습니다. 계속하기 전에 저장할까요?",
    unsavedTitle: "저장하지 않은 변경사항",
    save: "저장",
    dontSave: "저장 안 함",
    cancel: "취소",
  },
  editor: {
    bubbleMenuAriaLabel: "텍스트 서식",
    modeToggleAriaLabel: "편집기 모드",
    rawMode: "원문",
    richMode: "리치",
    rawEditorAriaLabel: "원문 마크다운 편집기",
    rawEditorPlaceholder: "마크다운을 직접 입력하세요…",
    richEditorAriaLabel: "리치 텍스트 편집기",
    richEditorLoading: "편집기를 준비하는 중…",
    richEditorPlaceholder: "노트를 입력하거나 / 로 명령을 사용하세요.",
    slashEmpty: "일치하는 명령이 없습니다",
    slashMenuAriaLabel: "슬래시 명령",
    tableMenuAriaLabel: "표 작업",
    tableColumnHandleLabel: (index) => `${index}번 열 선택 또는 이동`,
    tableRowHandleLabel: (index) => `${index}번 행 선택 또는 이동`,
  },
  commands: {
    paragraph: {
      label: "문단",
      description: "현재 블록을 일반 문단 텍스트로 바꿉니다.",
      keywords: ["문단", "본문", "text", "paragraph"],
    },
    "heading-1": {
      label: "제목 1",
      description: "큰 섹션 제목입니다.",
      keywords: ["제목", "헤딩", "h1", "title", "heading"],
    },
    "heading-2": {
      label: "제목 2",
      description: "중간 크기 섹션 제목입니다.",
      keywords: ["부제", "헤딩", "h2", "subtitle", "heading"],
    },
    "heading-3": {
      label: "제목 3",
      description: "작은 섹션 제목입니다.",
      keywords: ["소제목", "헤딩", "h3", "heading"],
    },
    bold: {
      label: "굵게",
      description: "선택한 텍스트를 굵게 강조합니다.",
      keywords: ["굵게", "강조", "bold", "strong"],
    },
    italic: {
      label: "기울임꼴",
      description: "선택한 텍스트에 부드러운 강조를 추가합니다.",
      keywords: ["기울임", "이탤릭", "italic", "emphasis"],
    },
    strike: {
      label: "취소선",
      description: "선택한 텍스트에 취소선을 그립니다.",
      keywords: ["취소선", "strike", "strikethrough"],
    },
    "inline-code": {
      label: "인라인 코드",
      description: "선택한 텍스트를 인라인 코드로 표시합니다.",
      keywords: ["코드", "스니펫", "inline", "code"],
    },
    link: {
      label: "링크",
      description: "현재 선택 영역에 URL을 연결합니다.",
      keywords: ["링크", "url", "href", "link"],
    },
    image: {
      label: "이미지",
      description: "URL 또는 로컬 파일 경로로 이미지를 삽입합니다.",
      keywords: ["이미지", "사진", "그림", "image", "picture"],
    },
    "bullet-list": {
      label: "글머리표 목록",
      description: "순서 없는 목록을 만듭니다.",
      keywords: ["목록", "글머리표", "unordered", "bullet", "list"],
    },
    "ordered-list": {
      label: "번호 목록",
      description: "순서 있는 목록을 만듭니다.",
      keywords: ["목록", "번호", "ordered", "numbered", "list"],
    },
    "task-list": {
      label: "체크리스트",
      description: "체크박스가 있는 작업 목록을 만듭니다.",
      keywords: ["할 일", "체크리스트", "tasks", "todos", "checklist"],
    },
    blockquote: {
      label: "인용문",
      description: "현재 블록을 인용문으로 감쌉니다.",
      keywords: ["인용", "blockquote", "quote", "callout"],
    },
    "code-block": {
      label: "코드 블록",
      description: "펜스 코드 블록을 만듭니다.",
      keywords: ["코드", "블록", "스니펫", "code", "snippet"],
    },
    table: {
      label: "테이블",
      description: "헤더 행이 있는 마크다운 테이블을 삽입합니다.",
      keywords: ["테이블", "표", "grid", "table"],
    },
    "table-add-row-after": {
      label: "아래 행 추가",
      description: "현재 표 행 아래에 새 행을 삽입합니다.",
      keywords: ["테이블", "표", "행", "추가", "row", "table"],
    },
    "table-add-column-after": {
      label: "오른쪽 열 추가",
      description: "현재 표 열 오른쪽에 새 열을 삽입합니다.",
      keywords: ["테이블", "표", "열", "추가", "column", "table"],
    },
    "table-delete-row": {
      label: "행 삭제",
      description: "현재 표 행을 삭제합니다.",
      keywords: ["테이블", "표", "행", "삭제", "remove", "delete"],
    },
    "table-delete-column": {
      label: "열 삭제",
      description: "현재 표 열을 삭제합니다.",
      keywords: ["테이블", "표", "열", "삭제", "remove", "delete"],
    },
    "horizontal-rule": {
      label: "구분선",
      description: "가로 구분선을 삽입합니다.",
      keywords: ["구분선", "separator", "rule", "line", "divider"],
    },
  },
};

const ES_MESSAGES: LocaleMessages = {
  intlLocale: getIntlLocale("es"),
  appTitle: "Downmark",
  fileDialog: {
    markdownFilterName: "Markdown",
    untitledFileName: "Sin título.md",
  },
  busy: {
    opening: "Abriendo",
    saving: "Guardando",
    savingAs: "Guardando como",
  },
  errors: {
    openFailed: (error) => `No se pudo abrir el archivo.\n\n${error}`,
    saveFailed: (error) => `No se pudo guardar.\n\n${error}`,
    staleWrite:
      "El archivo cambió en disco antes de terminar de guardar. Revisa la versión en disco o usa Guardar como.",
    imageAssetFailed: (error) => `No se pudo agregar la imagen.\n\n${error}`,
    invalidImageSource: "Ingresa una URL de imagen o una ruta absoluta local.",
  },
  banners: {
    missing:
      "El archivo ya no existe en disco. Sigue editando aquí y usa Guardar como para conservar los cambios.",
    staleWrite:
      "La versión en disco cambió antes de terminar de guardar. Vuelve a cargar desde el disco o usa Guardar como.",
    saveFailed: (error) => `Error al guardar: ${error}`,
    externallyModified:
      "La versión en disco cambió mientras aún tenías ediciones sin guardar.",
  },
  workspace: {
    metadataAriaLabel: "Metadatos del documento",
    saved: "Guardado",
    unsaved: "Sin guardar",
    scratchNote: "Nota temporal",
    richEditorStatus: "Editor enriquecido",
    rawEditorStatus: "Editor sin formato",
    recentCount: (count) =>
      `${new Intl.NumberFormat("es-ES").format(count)} archivo${
        count === 1 ? "" : "s"
      } reciente${count === 1 ? "" : "s"}`,
    openRecentFiles: "Abrir archivos recientes",
    closeRecentFiles: "Cerrar archivos recientes",
    recentFilesAriaLabel: "Archivos recientes",
    recentTitle: "Recientes",
    recentEmpty: "Los archivos recientes aparecerán aquí.",
    liveStatus: ({ document, state, editor }) => [document, state, editor].join(". "),
    documentStats: ({ characters, words }) =>
      `${pluralizeSpanish(words, "palabra", "palabras")} · ${pluralizeSpanish(
        characters,
        "carácter",
        "caracteres",
      )}`,
  },
  prompts: {
    image: "Ingresa una URL de imagen o una ruta absoluta local",
    link: "Ingresa una URL",
    languageChangeRestartBody:
      "La preferencia de idioma se guardó. Vuelve a abrir Downmark para terminar de aplicarla.",
    languageChangeRestartTitle: "Reinicia para aplicar el cambio de idioma",
    externalModifiedBody:
      "El documento cambió en disco mientras todavía tenías cambios sin guardar en Downmark.",
    externalModifiedTitle: "El archivo cambió en disco",
    keepMine: "Conservar el mío",
    reloadFromDisk: "Recargar desde disco",
    saveAs: "Guardar como",
    unsavedBody: "Tienes cambios sin guardar. ¿Quieres guardarlos antes de continuar?",
    unsavedTitle: "Cambios sin guardar",
    save: "Guardar",
    dontSave: "No guardar",
    cancel: "Cancelar",
  },
  editor: {
    bubbleMenuAriaLabel: "Formato de texto",
    modeToggleAriaLabel: "Modo del editor",
    rawMode: "Plano",
    richMode: "Enriquecido",
    rawEditorAriaLabel: "Editor de markdown plano",
    rawEditorPlaceholder: "Escribe markdown directamente…",
    richEditorAriaLabel: "Editor de texto enriquecido",
    richEditorLoading: "Preparando el editor…",
    richEditorPlaceholder: "Empieza a escribir una nota o usa / para comandos.",
    slashEmpty: "No hay ningún comando coincidente",
    slashMenuAriaLabel: "Comandos con barra",
    tableMenuAriaLabel: "Acciones de tabla",
    tableColumnHandleLabel: (index) => `Seleccionar o mover columna ${index}`,
    tableRowHandleLabel: (index) => `Seleccionar o mover fila ${index}`,
  },
  commands: {
    paragraph: {
      label: "Párrafo",
      description: "Convierte el bloque actual en texto de párrafo simple.",
      keywords: ["párrafo", "texto", "paragraph"],
    },
    "heading-1": {
      label: "Encabezado 1",
      description: "Encabezado grande de sección.",
      keywords: ["título", "encabezado", "h1", "heading"],
    },
    "heading-2": {
      label: "Encabezado 2",
      description: "Encabezado mediano de sección.",
      keywords: ["subtítulo", "encabezado", "h2", "heading"],
    },
    "heading-3": {
      label: "Encabezado 3",
      description: "Encabezado pequeño de sección.",
      keywords: ["encabezado", "h3", "heading"],
    },
    bold: {
      label: "Negrita",
      description: "Resalta con fuerza el texto seleccionado.",
      keywords: ["negrita", "fuerte", "bold", "strong"],
    },
    italic: {
      label: "Cursiva",
      description: "Añade un énfasis suave.",
      keywords: ["cursiva", "énfasis", "italic", "emphasis"],
    },
    strike: {
      label: "Tachado",
      description: "Tacha el texto seleccionado.",
      keywords: ["tachado", "strike", "strikethrough"],
    },
    "inline-code": {
      label: "Código en línea",
      description: "Da formato de código en línea al texto seleccionado.",
      keywords: ["código", "snippet", "inline", "code"],
    },
    link: {
      label: "Enlace",
      description: "Asocia una URL a la selección actual.",
      keywords: ["enlace", "url", "href", "link"],
    },
    image: {
      label: "Imagen",
      description: "Inserta una imagen desde una URL o una ruta local.",
      keywords: ["imagen", "foto", "picture", "image"],
    },
    "bullet-list": {
      label: "Lista con viñetas",
      description: "Crea una lista sin orden.",
      keywords: ["lista", "viñetas", "bullet", "unordered"],
    },
    "ordered-list": {
      label: "Lista numerada",
      description: "Crea una lista ordenada.",
      keywords: ["lista", "ordenada", "numerada", "ordered", "numbered"],
    },
    "task-list": {
      label: "Lista de tareas",
      description: "Crea una lista de tareas con casillas.",
      keywords: ["tareas", "pendientes", "checklist", "todos"],
    },
    blockquote: {
      label: "Cita",
      description: "Envuelve el bloque en una cita.",
      keywords: ["cita", "blockquote", "quote", "callout"],
    },
    "code-block": {
      label: "Bloque de código",
      description: "Crea un bloque de código con cercas.",
      keywords: ["código", "bloque", "snippet", "fence"],
    },
    table: {
      label: "Tabla",
      description: "Inserta una tabla markdown con fila de encabezado.",
      keywords: ["tabla", "grid", "columnas", "filas", "table"],
    },
    "table-add-row-after": {
      label: "Agregar fila abajo",
      description: "Inserta una fila debajo de la fila actual de la tabla.",
      keywords: ["tabla", "fila", "abajo", "agregar", "row"],
    },
    "table-add-column-after": {
      label: "Agregar columna a la derecha",
      description: "Inserta una columna a la derecha de la columna actual.",
      keywords: ["tabla", "columna", "derecha", "agregar", "column"],
    },
    "table-delete-row": {
      label: "Eliminar fila",
      description: "Quita la fila actual de la tabla.",
      keywords: ["tabla", "fila", "eliminar", "quitar", "delete"],
    },
    "table-delete-column": {
      label: "Eliminar columna",
      description: "Quita la columna actual de la tabla.",
      keywords: ["tabla", "columna", "eliminar", "quitar", "delete"],
    },
    "horizontal-rule": {
      label: "Separador",
      description: "Inserta una regla horizontal.",
      keywords: ["separador", "regla", "línea", "divider"],
    },
  },
};

const CATALOG: Record<SupportedLocale, LocaleMessages> = {
  en: EN_MESSAGES,
  ko: KO_MESSAGES,
  es: ES_MESSAGES,
};

export function getLocaleMessages(locale: SupportedLocale) {
  return CATALOG[locale];
}
