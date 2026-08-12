import { execFile } from 'child_process';
import * as vscode from 'vscode';

/** L1: lightweight, VS Code Diagnostics based check — no external process spawned. */
export function diagnosticsErrorCount(): number {
  let errors = 0;
  for (const [, diags] of vscode.languages.getDiagnostics()) {
    for (const d of diags) {
      if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
    }
  }
  return errors;
}

/**
 * L2: runs the user-configured project command (npm test, make check, ...)
 * as a plain shell command, scoped to the worktree. Language-specific logic
 * intentionally never lives in the extension itself.
 */
export function runL2Command(command: string, cwd: string, timeoutMs = 5 * 60 * 1000): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ success: !err, output: `${stdout}\n${stderr}`.trim() });
    });
  });
}
