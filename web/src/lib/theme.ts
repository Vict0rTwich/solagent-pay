export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "solagent-theme";

/** Runs in <head> before first paint so a saved light theme doesn't flash dark. */
export const THEME_INIT_SCRIPT = `try{document.documentElement.dataset.theme=localStorage.getItem("${THEME_STORAGE_KEY}")==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;
