import * as vscode from 'vscode';
import { SnapshotService } from '../services/snapshotService';
import { runL2Command } from '../services/verificationService';

export async function verifyNow(repoRoot: string, branch: string, snapshotService: SnapshotService, onDone: () => void): Promise<void> {
  const command = vscode.workspace.getConfiguration('lazytrail').get<string>('verifyCommand', '');
  if (!command || command.trim().length === 0) {
    vscode.window.showWarningMessage('LazyTrail: lazytrail.verifyCommand が設定されていません。');
    return;
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `LazyTrail: 検証中 (${command})…` },
    () => runL2Command(command, repoRoot)
  );

  if (result.success) {
    await snapshotService.markVerified(repoRoot, branch);
    onDone();
    vscode.window.showInformationMessage('LazyTrail: 検証に成功しました。Verified snapshotを作成しました。');
  } else {
    vscode.window.showErrorMessage('LazyTrail: 検証に失敗しました。');
  }
}
