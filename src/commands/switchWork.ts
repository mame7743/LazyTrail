import * as vscode from 'vscode';
import { WorkInfo } from '../git/types';

export async function switchWork(work: WorkInfo): Promise<void> {
  if (!work.worktreePath) {
    vscode.window.showWarningMessage(`LazyTrail: ${work.branch} にはworktreeがありません。`);
    return;
  }
  const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (currentFolder === work.worktreePath) {
    vscode.window.showInformationMessage(`LazyTrail: 既に ${work.displayName} を開いています。`);
    return;
  }
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(work.worktreePath), { forceNewWindow: false });
}
