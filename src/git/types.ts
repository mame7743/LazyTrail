export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface WorkInfo {
  /** Branch name, e.g. work/initial-development */
  branch: string;
  /** Display name shown in UI (Japanese allowed) */
  displayName: string;
  /** Absolute path to the worktree, if one exists */
  worktreePath: string | undefined;
  isCurrent: boolean;
}

export type VerifyState = 'Unknown' | 'Failed' | 'Verified';

export type SyncState = 'synced' | 'ahead' | 'behind' | 'diverged' | 'offline';

export interface SnapshotEntry {
  kind: 'wip' | 'verified';
  work: string;
  commitHash: string;
  timestamp: number;
  message: string;
}
