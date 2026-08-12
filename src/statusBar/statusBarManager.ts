import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { SnapshotService } from '../services/snapshotService';
import { SyncService } from '../services/syncService';
import { WorkService } from '../services/workService';
import { computePressure } from '../services/reviewPressureService';

const PRESSURE_COLOR: Record<string, vscode.ThemeColor | undefined> = {
  green: undefined,
  yellow: new vscode.ThemeColor('statusBarItem.warningBackground'),
  red: new vscode.ThemeColor('statusBarItem.errorBackground'),
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private lastCommitTime = Date.now();
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly repoRoot: string,
    private readonly git: GitService,
    private readonly workService: WorkService,
    private readonly snapshotService: SnapshotService,
    private readonly syncService: SyncService
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'lazytrail.reviewAndCommit';
    this.item.show();
    this.timer = setInterval(() => void this.refresh(), 15000);
  }

  noteCommit(): void {
    this.lastCommitTime = Date.now();
  }

  async refresh(): Promise<void> {
    try {
      const branch = await this.git.currentBranch(this.repoRoot);
      if (!branch) {
        this.item.text = 'LazyTrail: (no branch)';
        return;
      }
      const displayName = await this.workService.getDisplayName(branch);
      const stat = await this.git.diffStat(this.repoRoot);
      const verify = await this.snapshotService.verifyState(this.repoRoot, branch);
      const sync = await this.syncService.state(branch, this.repoRoot);
      const pressure = computePressure(stat);

      const verifyIcon = verify === 'Verified' ? '$(check)' : verify === 'Failed' ? '$(error)' : '$(question)';
      const syncIcon: Record<string, string> = {
        synced: '$(check)',
        ahead: '$(arrow-up)',
        behind: '$(arrow-down)',
        diverged: '$(warning)',
        offline: '$(cloud-offline)',
      };

      this.item.text = `$(git-branch) ${displayName} │ ${verifyIcon} ${formatElapsed(Date.now() - this.lastCommitTime)} │ +${stat.insertions} -${stat.deletions} / ${stat.filesChanged} files │ ${syncIcon[sync] ?? sync}`;
      this.item.backgroundColor = PRESSURE_COLOR[pressure];
      this.item.tooltip = pressure === 'red'
        ? 'LazyTrail: 差分が大きくなっています。Review & Commitをおすすめします。'
        : pressure === 'yellow'
        ? 'LazyTrail: 差分がやや大きくなってきました。'
        : 'LazyTrail: クリックしてReview & Commit';
    } catch {
      this.item.text = 'LazyTrail';
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item.dispose();
  }
}
