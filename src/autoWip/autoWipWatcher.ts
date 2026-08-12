import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { SnapshotService } from '../services/snapshotService';
import { diagnosticsErrorCount } from '../services/verificationService';

/**
 * Snapshots the current work on every file save. Debounced and serialized
 * (via SnapshotService's internal per-branch queue) so rapid saves collapse
 * into a single snapshot instead of racing.
 */
export class AutoWipWatcher implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onSnapshot = new vscode.EventEmitter<{ commit: string; diagnosticsClean: boolean }>();
  readonly onDidSnapshot = this.onSnapshot.event;

  constructor(private readonly repoRoot: string, private readonly git: GitService, private readonly snapshots: SnapshotService) {
    this.disposable = vscode.workspace.onDidSaveTextDocument((doc) => this.handleSave(doc));
  }

  private handleSave(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== 'file') return;
    if (!doc.uri.fsPath.startsWith(this.repoRoot)) return;

    const debounceMs = vscode.workspace.getConfiguration('lazytrail').get<number>('autoWipDebounceMs', 2000);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.snapshot(), debounceMs);
  }

  private async snapshot(): Promise<void> {
    const branch = await this.git.currentBranch(this.repoRoot);
    if (!branch) return;
    const commit = await this.snapshots.writeWipSnapshot(this.repoRoot, branch);
    if (!commit) return;

    // L1 verification: check VS Code Diagnostics ~300-500ms after the snapshot
    // settles, so language servers have had a chance to catch up.
    setTimeout(() => {
      const errors = diagnosticsErrorCount();
      this.onSnapshot.fire({ commit, diagnosticsClean: errors === 0 });
    }, 400);
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.disposable.dispose();
    this.onSnapshot.dispose();
  }
}
