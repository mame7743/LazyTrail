import * as vscode from 'vscode';
import { WorkService } from '../services/workService';

export async function newWork(workService: WorkService, onCreated: () => void): Promise<void> {
  const displayName = await vscode.window.showInputBox({
    prompt: 'LazyTrail: 新しいWorkの表示名（日本語可）',
    placeHolder: '例: ログイン画面の改善',
  });
  if (!displayName || displayName.trim().length === 0) return;

  const proposedSlug = await workService.proposeSlug(displayName.trim());
  const slug = await vscode.window.showInputBox({
    prompt: 'LazyTrail: ブランチ名候補（必要に応じて修正してください）',
    value: proposedSlug,
    validateInput: (v) => (/^[a-z0-9][a-z0-9-]*$/.test(v) ? undefined : '半角英小文字・数字・ハイフンのみ使用できます'),
  });
  if (!slug) return;

  try {
    const work = await workService.createWork(displayName.trim(), slug);
    onCreated();
    const open = await vscode.window.showInformationMessage(
      `LazyTrail: Work「${work.displayName}」(work/${slug}) を作成しました。`,
      'Open',
      'Later'
    );
    if (open === 'Open' && work.worktreePath) {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(work.worktreePath), { forceNewWindow: false });
    }
  } catch (e) {
    vscode.window.showErrorMessage(`LazyTrail: Workの作成に失敗しました: ${(e as Error).message}`);
  }
}
