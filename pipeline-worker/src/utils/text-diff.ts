// Minimal word-level LCS diff, used only as the redliner's fallback when the
// model's own `changes[].original` values can't be verified as verbatim
// substrings of the source clause (see redliner.ts). No new dependency: the
// inputs are single clauses (at most a few hundred words), so an O(n*m) LCS
// is cheap and needs no library.

interface DiffChange {
  type: string;
  original: string;
  replacement: string;
  rationale: string;
}

function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) || [];
}

export function diffToChanges(originalText: string, revisedText: string): DiffChange[] {
  const a = tokenize(originalText);
  const b = tokenize(revisedText);
  const n = a.length;
  const m = b.length;

  // Standard LCS table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  type Op = { type: 'equal' | 'delete' | 'insert'; value: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', value: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'delete', value: a[i] });
      i++;
    } else {
      ops.push({ type: 'insert', value: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'delete', value: a[i++] });
  }
  while (j < m) {
    ops.push({ type: 'insert', value: b[j++] });
  }

  // Group adjacent delete/insert runs into single replace-style changes,
  // dropping whitespace-only or empty runs (not meaningful edits).
  const changes: DiffChange[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === 'equal') {
      k++;
      continue;
    }
    let deleted = '';
    let inserted = '';
    while (k < ops.length && ops[k].type !== 'equal') {
      if (ops[k].type === 'delete') deleted += ops[k].value;
      else inserted += ops[k].value;
      k++;
    }
    if (deleted.trim() || inserted.trim()) {
      changes.push({
        type: 'diff',
        original: deleted.trim(),
        replacement: inserted.trim(),
        rationale: 'Computed automatically from the diff between the original and revised clause text.',
      });
    }
  }

  return changes;
}
