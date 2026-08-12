import { GitService } from '../git/gitService';
import { SyncState } from '../git/types';

/**
 * Remote is used purely as a sync layer between machines. Auto Sync never
 * rewrites history: it fetches, fast-forward-pulls when possible, and
 * leaves diverged/conflicted states for the user to resolve explicitly.
 */
export class SyncService {
  constructor(private readonly git: GitService) {}

  async fetch(): Promise<boolean> {
    if (!(await this.git.hasRemote())) return false;
    return this.git.fetch('origin');
  }

  async state(branch: string, cwd?: string): Promise<SyncState> {
    if (!(await this.git.hasRemote())) return 'offline';
    if (!(await this.git.hasUpstream(branch, cwd))) return 'offline';
    const ab = await this.git.aheadBehind(branch, `${branch}@{upstream}`, cwd);
    if (!ab) return 'offline';
    if (ab.ahead === 0 && ab.behind === 0) return 'synced';
    if (ab.ahead > 0 && ab.behind === 0) return 'ahead';
    if (ab.ahead === 0 && ab.behind > 0) return 'behind';
    return 'diverged';
  }

  /** Fetch + fast-forward-only pull. Never touches history on diverge. */
  async autoSync(branch: string, cwd?: string): Promise<SyncState> {
    await this.fetch();
    if (await this.git.hasUpstream(branch, cwd)) {
      await this.git.pullFastForwardOnly(cwd);
    }
    return this.state(branch, cwd);
  }

  async push(branch: string, cwd?: string): Promise<boolean> {
    if (!(await this.git.hasRemote())) return false;
    const hasUpstream = await this.git.hasUpstream(branch, cwd);
    return this.git.push(branch, cwd, !hasUpstream);
  }
}
