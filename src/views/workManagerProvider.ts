import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { WorkService, STABLE_BRANCH, DEVELOP_BRANCH } from '../services/workService';
import { SnapshotService } from '../services/snapshotService';
import { SyncService } from '../services/syncService';
import { WorkInfo } from '../git/types';

const SYNC_ICON: Record<string, string> = {
  synced: '$(check)',
  ahead: '$(arrow-up)',
  behind: '$(arrow-down)',
  diverged: '$(warning)',
  offline: '$(cloud-offline)',
};

interface Enrichment {
  description: string;
  tooltip: vscode.MarkdownString;
}

export class WorkManagerProvider implements vscode.TreeDataProvider<WorkInfo> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly enrichmentCache = new Map<string, Enrichment>();

  constructor(
    private readonly git: GitService,
    private readonly workService: WorkService,
    private readonly snapshotService: SnapshotService,
    private readonly syncService: SyncService
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(work: WorkInfo): vscode.TreeItem {
    const item = new vscode.TreeItem(
      work.isCurrent ? `● ${work.displayName}` : work.displayName,
      vscode.TreeItemCollapsibleState.None
    );
    item.iconPath = new vscode.ThemeIcon(this.iconFor(work));
    item.contextValue = work.branch.startsWith('work/') ? 'lazytrailWork' : 'lazytrailRootBranch';
    if (work.worktreePath) {
      item.command = { command: 'lazytrail.switchWork', title: 'Switch Work', arguments: [work] };
    }
    const cached = this.enrichmentCache.get(work.branch);
    if (cached) {
      item.description = cached.description;
      item.tooltip = cached.tooltip;
    } else {
      item.description = work.worktreePath ? work.branch : `${work.branch} (worktree未作成)`;
    }
    return item;
  }

  async getChildren(): Promise<WorkInfo[]> {
    let works: WorkInfo[];
    try {
      works = await this.workService.listWorks();
    } catch {
      return [];
    }
    await Promise.all(works.map((w) => this.computeEnrichment(w)));
    return works;
  }

  private iconFor(work: WorkInfo): string {
    if (work.branch === STABLE_BRANCH) return 'shield';
    if (work.branch === DEVELOP_BRANCH) return 'git-merge';
    return 'git-branch';
  }

  private async computeEnrichment(work: WorkInfo): Promise<void> {
    if (!work.worktreePath) {
      this.enrichmentCache.delete(work.branch);
      return;
    }
    try {
      const [stat, verify, sync] = await Promise.all([
        this.git.diffStat(work.worktreePath),
        this.snapshotService.verifyState(work.worktreePath, work.branch),
        this.syncService.state(work.branch, work.worktreePath),
      ]);
      const diffText = stat.filesChanged > 0 ? `+${stat.insertions} -${stat.deletions} / ${stat.filesChanged}f` : 'clean';
      const verifyIcon = verify === 'Verified' ? '✓' : verify === 'Failed' ? '✗' : '?';
      const description = `${work.branch} · ${diffText} · ${verifyIcon} · ${SYNC_ICON[sync] ?? sync}`;
      const tooltip = new vscode.MarkdownString(
        `**${work.displayName}**\n\nbranch: \`${work.branch}\`\n\nworktree: \`${work.worktreePath}\`\n\ndiff: +${stat.insertions} -${stat.deletions} (${stat.filesChanged} files)\n\nverify: ${verify}\n\nsync: ${sync}`
      );
      this.enrichmentCache.set(work.branch, { description, tooltip });
    } catch {
      this.enrichmentCache.delete(work.branch);
    }
  }
}
