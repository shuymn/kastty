/**
 * Fixed placeholder written to the temporary file in Phase 1. Phase 2 replaces
 * this with the extracted main-terminal buffer text.
 */
export const EDITOR_OVERLAY_PLACEHOLDER = "hello from kastty overlay\n";

export interface EditorEnv {
  VISUAL?: string;
  EDITOR?: string;
}

/**
 * Resolve the editor command string from `$VISUAL` (preferred) then `$EDITOR`.
 * The returned value may still contain arguments (e.g. `nvim -R`); it is the
 * caller's responsibility to launch it through a shell. Returns `null` when
 * neither variable holds a non-empty value.
 */
export function resolveEditorCommand(env: EditorEnv): string | null {
  const visual = env.VISUAL?.trim();
  if (visual) return visual;
  const editor = env.EDITOR?.trim();
  if (editor) return editor;
  return null;
}

export interface EditorSpawn {
  command: string;
  args: string[];
}

/**
 * Build a controlled shell invocation that runs the resolved editor command
 * against `tmpFile`. The editor value is interpolated into the script so the
 * user's intended arguments/quoting are preserved, while the file path is
 * passed as a positional parameter (`"$@"`) so it can never be re-parsed or
 * injected. This mirrors how git launches `$GIT_EDITOR`.
 */
export function buildEditorSpawn(editor: string, tmpFile: string): EditorSpawn {
  return {
    command: "/bin/sh",
    args: ["-c", `${editor} "$@"`, "kastty-editor", tmpFile],
  };
}
