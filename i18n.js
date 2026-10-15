// ====== MARK i18n MODULE ======
const translations = {
  en: {
    // App & Navbar
    app_title: "Mark",
    toggle_explorer: "Toggle Explorer",
    title_btn: "Title",
    title_1: "Title 1",
    title_2: "Title 2",
    title_3: "Title 3",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    line: "Horizontal Rule",
    code: "Code Block",
    extra: "Extra Tools",
    link: "Insert Link",
    image: "Insert Image",
    table: "Insert Table",
    bullet_list: "Bullet List",
    numeric_list: "Numbered List",
    quote: "Blockquote",
    collaborate: "Collaborate",
    view_editor: "Editor Only",
    view_split: "Split View",
    view_preview: "Preview Only",
    win_minimize: "Minimize",
    win_maximize: "Maximize",
    win_close: "Close",

    // Search
    search_placeholder: "Search...",
    search_button: "Search",
    search_prev: "Previous",
    search_next: "Next",
    search_close: "Close",

    // Explorer
    explorer_title: "Explorer",
    new_file: "New file",
    open_folder: "Open folder",
    refresh: "Refresh",
    close_explorer: "Close Explorer",

    // Editor & Preview
    editor_placeholder: "Write markdown here...",
    reading_mode_exit: "Press ESC to exit Reading Mode",

    // Footer
    settings: "Settings",
    word_count: "words: {count}",
    status_online: "Online",
    status_offline: "Offline",

    // Settings Modal
    settings_title: "Settings",
    settings_autosave: "Autosave",
    settings_autoscroll: "Autoscroll",
    settings_theme: "Theme",
    theme_light: "Light",
    theme_dark: "Dark",
    settings_language: "Language",
    lang_en: "English",
    lang_it: "Italiano",
    settings_tab_size: "Tab Size",
    settings_font_size: "Font Size (px)",

    // Undo History
    history_title: "Undo History",

    // Collaboration Modal
    collab_title: "Collaborate",
    collab_tab_create: "Create",
    collab_tab_join: "Join",
    collab_session_code: "Session code",
    collab_copy_code: "Copy code",
    collab_new_code: "Generate new code",
    collab_start_session: "Start session",
    collab_enter_code_placeholder: "mark-xxxxxx",
    collab_join_session: "Join session",
    collab_session_active: "Active session",
    collab_participants: "participants connected",
    collab_leave_session: "End session",

    // Notifications
    notif_update_available: "Update available! It will be downloaded in the background.",
    notif_update_downloaded: "Update downloaded! Restart to apply.",
    notif_groq_key_missing: "Groq API key missing.",
    notif_error: "Error: {msg}",
    notif_undo_error: "Unable to undo action: the text was modified too much.",
    notif_save_first_autosave: "You must save the file first to enable autosave.",
    notif_autosave_on: "Autosave enabled.",
    notif_autosave_off: "Autosave disabled.",
    notif_code_copied: "Code copied to clipboard",
    notif_enter_valid_code: "Please enter a valid room code",
    notif_participants_connected: "{count} participants connected",
    notif_session_started: "Session {roomId} started",
    notif_joined_session: "Joined {roomId}",
    notif_start_cancelled_no_save: "Start cancelled: file not saved",
    notif_save_error: "Save error: {msg}",
    notif_connect_cancelled_no_path: "Connection cancelled: path not selected",
    notif_file_create_error: "Error creating file: {msg}",
    notif_session_ended: "Collaboration session ended",
    notif_collab_webrtc_error: "WebRTC connection error: {msg}",

    // Dialogs
    dialog_unsaved_title: "Unsaved changes",
    dialog_unsaved_message: "There are unsaved changes. Do you want to save before proceeding?",
    dialog_save: "Save",
    dialog_dont_save: "Don't Save",
    dialog_cancel: "Cancel",
    dialog_save_required_title: "Save required",
    dialog_save_required_message: "To start a collaboration session, you must first save the current file on your device.",
    dialog_save_file_and_start: "Save file and start",
    dialog_save_collab_title: "Save file for collaboration",
    dialog_save_session_title: "Where do you want to save the session file?",
    dialog_leave_collab_title: "Active collaboration session",
    dialog_leave_collab_message: "A collaboration session is currently active. Are you sure you want to end it to {action}?",
    dialog_leave_session: "End session",
    dialog_stay: "Stay in session",
    dialog_action_start_new: "start a new session",
    dialog_action_join_other: "join another session",
    dialog_action_create_new: "create a new file",
    dialog_action_open_file: 'open "{name}"',
    dialog_paste_img_title: "File not saved",
    dialog_paste_img_message: "To insert an image, you must first save the file.",
    dialog_create_new_file_title: "Create new file",
    dialog_save_pdf_title: "Save PDF",
    dialog_import_error_title: "Conversion error",
    dialog_import_error_message: "Unable to convert file: {msg}",

    // Main Menu
    menu_file: "File",
    menu_new_file: "New file",
    menu_open_file: "Open file",
    menu_import: "Import from PDF/Word/HTML",
    menu_open_folder: "Open folder",
    menu_save: "Save...",
    menu_export_pdf: "Export as PDF",
    menu_export_html: "Export as HTML",
    dialog_save_html_title: "Save HTML",
    notif_html_saved: "HTML file exported successfully",
    notif_html_export_error: "Error exporting HTML: {msg}",
    menu_quit: "Quit",
    menu_edit: "Edit",
    menu_undo: "Undo",
    menu_cut: "Cut",
    menu_copy: "Copy",
    menu_paste: "Paste",
    menu_select_all: "Select All",
    menu_find: "Find",
    menu_insert_image: "Insert Image from File",
    menu_paste_image: "Paste Image from Clipboard",
    menu_view: "View",
    menu_explorer: "Explorer",
    menu_editor: "Editor",
    menu_preview: "Preview",
    menu_dark_mode: "Dark Mode"
  },
  it: {
    // App & Navbar
    app_title: "Mark",
    toggle_explorer: "Mostra/Nascondi Explorer",
    title_btn: "Titolo",
    title_1: "Titolo 1",
    title_2: "Titolo 2",
    title_3: "Titolo 3",
    bold: "Grassetto",
    italic: "Corsivo",
    underline: "Sottolineato",
    line: "Linea orizzontale",
    code: "Blocco codice",
    extra: "Strumenti extra",
    link: "Inserisci link",
    image: "Inserisci immagine",
    table: "Inserisci tabella",
    bullet_list: "Elenco puntato",
    numeric_list: "Elenco numerato",
    quote: "Citazione",
    collaborate: "Collabora",
    view_editor: "Solo Editor",
    view_split: "Vista divisa",
    view_preview: "Solo Anteprima",
    win_minimize: "Riduci a icona",
    win_maximize: "Ingrandisci",
    win_close: "Chiudi",

    // Search
    search_placeholder: "Cerca...",
    search_button: "Cerca",
    search_prev: "Precedente",
    search_next: "Successivo",
    search_close: "Chiudi",

    // Explorer
    explorer_title: "Explorer",
    new_file: "Nuovo file",
    open_folder: "Apri cartella",
    refresh: "Aggiorna",
    close_explorer: "Chiudi explorer",

    // Editor & Preview
    editor_placeholder: "Scrivi markdown qui...",
    reading_mode_exit: "Premi ESC per uscire dalla modalità lettura",

    // Footer
    settings: "Impostazioni",
    word_count: "parole: {count}",
    status_online: "Online",
    status_offline: "Offline",

    // Settings Modal
    settings_title: "Impostazioni",
    settings_autosave: "Salvataggio automatico",
    settings_autoscroll: "Scorrimento automatico",
    settings_theme: "Tema",
    theme_light: "Chiaro",
    theme_dark: "Scuro",
    settings_language: "Lingua",
    lang_en: "English",
    lang_it: "Italiano",
    settings_tab_size: "Dimensione Tab",
    settings_font_size: "Dimensione Carattere (px)",

    // Undo History
    history_title: "Cronologia modifiche",

    // Collaboration Modal
    collab_title: "Collabora",
    collab_tab_create: "Crea",
    collab_tab_join: "Unisciti",
    collab_session_code: "Codice sessione",
    collab_copy_code: "Copia codice",
    collab_new_code: "Genera nuovo codice",
    collab_start_session: "Avvia sessione",
    collab_enter_code_placeholder: "mark-xxxxxx",
    collab_join_session: "Entra nella sessione",
    collab_session_active: "Sessione attiva",
    collab_participants: "partecipanti connessi",
    collab_leave_session: "Termina sessione",

    // Notifications
    notif_update_available: "Aggiornamento disponibile! Verrà scaricato in background.",
    notif_update_downloaded: "Aggiornamento scaricato! Riavvia per applicare.",
    notif_groq_key_missing: "Chiave API Groq mancante.",
    notif_error: "Errore: {msg}",
    notif_undo_error: "Impossibile annullare l'azione: il testo è stato modificato troppo.",
    notif_save_first_autosave: "Devi prima salvare il file per attivare il salvataggio automatico.",
    notif_autosave_on: "Salvataggio automatico attivato.",
    notif_autosave_off: "Salvataggio automatico disattivato.",
    notif_code_copied: "Codice copiato negli appunti",
    notif_enter_valid_code: "Inserisci un codice valido",
    notif_participants_connected: "{count} partecipanti connessi",
    notif_session_started: "Sessione {roomId} avviata",
    notif_joined_session: "Unito a {roomId}",
    notif_start_cancelled_no_save: "Avvio annullato: file non salvato",
    notif_save_error: "Errore salvataggio: {msg}",
    notif_connect_cancelled_no_path: "Connessione annullata: percorso non selezionato",
    notif_file_create_error: "Errore creazione file: {msg}",
    notif_session_ended: "Sessione collaborativa terminata",
    notif_collab_webrtc_error: "Errore di connessione WebRTC: {msg}",

    // Dialogs
    dialog_unsaved_title: "Modifiche non salvate",
    dialog_unsaved_message: "Ci sono modifiche non salvate. Vuoi salvare prima di procedere?",
    dialog_save: "Salva",
    dialog_dont_save: "Non salvare",
    dialog_cancel: "Annulla",
    dialog_save_required_title: "Salvataggio richiesto",
    dialog_save_required_message: "Per avviare una sessione di collaborazione, devi prima salvare il file corrente sul tuo dispositivo.",
    dialog_save_file_and_start: "Salva file e avvia",
    dialog_save_collab_title: "Salva file per la collaborazione",
    dialog_save_session_title: "Dove vuoi salvare il file della sessione?",
    dialog_leave_collab_title: "Sessione collaborativa attiva",
    dialog_leave_collab_message: "È attualmente attiva una sessione di collaborazione. Sei sicuro di voler uscire dalla sessione per {action}?",
    dialog_leave_session: "Esci dalla sessione",
    dialog_stay: "Resta nella sessione",
    dialog_action_start_new: "avviare una nuova sessione",
    dialog_action_join_other: "unirti a un'altra sessione",
    dialog_action_create_new: "creare un nuovo file",
    dialog_action_open_file: 'aprire "{name}"',
    dialog_paste_img_title: "File non salvato",
    dialog_paste_img_message: "Per inserire un'immagine, devi prima salvare il file.",
    dialog_create_new_file_title: "Crea nuovo file",
    dialog_save_pdf_title: "Salva PDF",
    dialog_import_error_title: "Errore di conversione",
    dialog_import_error_message: "Impossibile convertire il file: {msg}",

    // Main Menu
    menu_file: "File",
    menu_new_file: "Nuovo file",
    menu_open_file: "Apri file",
    menu_import: "Importa da PDF/Word/HTML",
    menu_open_folder: "Apri cartella",
    menu_save: "Salva...",
    menu_export_pdf: "Esporta come PDF",
    menu_export_html: "Esporta come HTML",
    dialog_save_html_title: "Salva HTML",
    notif_html_saved: "File HTML esportato con successo",
    notif_html_export_error: "Errore durante l'esportazione HTML: {msg}",
    menu_quit: "Esci",
    menu_edit: "Modifica",
    menu_undo: "Annulla",
    menu_cut: "Taglia",
    menu_copy: "Copia",
    menu_paste: "Incolla",
    menu_select_all: "Seleziona tutto",
    menu_find: "Trova",
    menu_insert_image: "Inserisci immagine da file",
    menu_paste_image: "Incolla immagine dagli appunti",
    menu_view: "Vista",
    menu_explorer: "Explorer",
    menu_editor: "Editor",
    menu_preview: "Anteprima",
    menu_dark_mode: "Modalità scura"
  }
};

let currentLanguage = 'en';

function getLanguage() {
  return currentLanguage;
}

function setLanguage(lang) {
  if (translations[lang]) {
    currentLanguage = lang;
  }
  return currentLanguage;
}

function t(key, params = {}) {
  const dict = translations[currentLanguage] || translations.en;
  let text = dict[key] !== undefined ? dict[key] : (translations.en[key] !== undefined ? translations.en[key] : key);
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return text;
}

module.exports = {
  translations,
  getLanguage,
  setLanguage,
  t
};
