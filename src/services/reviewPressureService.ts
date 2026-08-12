import * as vscode from 'vscode';
import { DiffStat } from '../git/types';

export type PressureLevel = 'green' | 'yellow' | 'red';

export function computePressure(stat: DiffStat): PressureLevel {
  const cfg = vscode.workspace.getConfiguration('lazytrail');
  const yellowLines = cfg.get<number>('reviewPressure.yellowLines', 150);
  const redLines = cfg.get<number>('reviewPressure.redLines', 400);
  const yellowFiles = cfg.get<number>('reviewPressure.yellowFiles', 8);
  const redFiles = cfg.get<number>('reviewPressure.redFiles', 20);

  const totalLines = stat.insertions + stat.deletions;
  if (totalLines >= redLines || stat.filesChanged >= redFiles) return 'red';
  if (totalLines >= yellowLines || stat.filesChanged >= yellowFiles) return 'yellow';
  return 'green';
}
