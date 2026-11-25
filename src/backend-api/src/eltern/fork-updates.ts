// (fork "wishes") The fork's own update channel - kept out of updates.ts (splitti's file) so his updates merge with
// few conflicts. updates.ts asks here for the fork's branch and last tag (the rows of the update page) and for the
// arguments of run.sh when one of them is installed; run.sh itself (in updates.ts) takes "fork <repo> <branch> <label>".

// Fork: this fork's own channel beside the official ones. It installs the fork's branch with the update script's
// branch mode (start_mupibox_update.sh branch <branch> <owner/repo> <label>); the official channels stay as they are -
// "Stabil" is the way back. The label starts with FORK, so the installed version is told apart from the official
// channels (no "update available" from them for a fork, see parseInstalled).
export const FORK = { repo: 'fetredlwl/MuPiBox', branch: 'wishes' } as const

// The fork's branch as it is on GitHub now: its last commit (short id, day) and the official version it is based on
// (the stable one in the fork's version.json). Asked every 10 minutes at most - GitHub answers 60 questions an hour
// from one home network without a login.
export interface ForkRelease {
  repo: string
  branch: string
  sha: string
  date: string
  base: string | null
  label: string
}
let forkCache: { at: number; info: ForkRelease } | null = null

export async function forkRelease(fresh = false): Promise<ForkRelease | null> {
  if (fresh || !forkCache || Date.now() - forkCache.at > 600_000) {
    try {
      const r = await fetch(`https://api.github.com/repos/${FORK.repo}/branches/${FORK.branch}`, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (r.ok) {
        const b = (await r.json()) as { commit?: { sha?: string; commit?: { committer?: { date?: string } } } }
        const full = String(b.commit?.sha ?? '')
        const sha = full.slice(0, 7)
        const date = String(b.commit?.commit?.committer?.date ?? '').slice(0, 10)
        let base: string | null = null
        try {
          const v = await fetch(`https://raw.githubusercontent.com/${FORK.repo}/${full}/version.json`, {
            signal: AbortSignal.timeout(8000),
          })
          if (v.ok) {
            const stable = ((await v.json()) as { release?: { stable?: { version?: string }[] } }).release?.stable ?? []
            const last = String(stable[stable.length - 1]?.version ?? '')
            if (/^\d+(?:\.\d+)+$/.test(last)) base = last
          }
        } catch {
          // without the base the label has no number
        }
        if (/^[0-9a-f]{40}$/.test(full) && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
          const label = ['FORK', base, FORK.branch, sha, date].filter(Boolean).join(' ')
          forkCache = { at: Date.now(), info: { repo: FORK.repo, branch: FORK.branch, sha, date, base, label } }
        }
      }
    } catch {
      // no internet: the last answer, if any
    }
  }
  return forkCache?.info ?? null
}

// The fork's last tag: the named state to go back to while the branch ("wishes") goes on. The tags carry their day in the
// name (fork-2026-11-23-spotify-live-suche) - the newest day is the last one (the tag list of GitHub has no order by
// date). The same cache as the branch: asked every 10 minutes at most.
export interface ForkTag {
  repo: string
  tag: string
  sha: string
  date: string
  base: string | null
  label: string
}
let forkTagCache: { at: number; info: ForkTag } | null = null

/** the newest of the tag names that carry a day (yyyy-mm-dd), none when no tag does */
export function lastForkTag(names: string[]): string | null {
  const dated = names
    .filter((n) => /^[A-Za-z0-9._-]{1,60}$/.test(n))
    .map((n) => ({ n, day: /\d{4}-\d{2}-\d{2}/.exec(n)?.[0] ?? '' }))
    .filter((o) => o.day)
  dated.sort((a, b) => (a.day === b.day ? a.n.localeCompare(b.n) : a.day.localeCompare(b.day)))
  return dated.length ? dated[dated.length - 1].n : null
}

export async function forkLastTag(fresh = false): Promise<ForkTag | null> {
  if (fresh || !forkTagCache || Date.now() - forkTagCache.at > 600_000) {
    try {
      const r = await fetch(`https://api.github.com/repos/${FORK.repo}/tags?per_page=100`, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (r.ok) {
        const list = (await r.json()) as { name?: string; commit?: { sha?: string } }[]
        const tag = lastForkTag(list.map((t) => String(t.name ?? '')))
        const full = String(list.find((t) => t.name === tag)?.commit?.sha ?? '')
        if (tag && /^[0-9a-f]{40}$/.test(full)) {
          let base: string | null = null
          try {
            const v = await fetch(`https://raw.githubusercontent.com/${FORK.repo}/${full}/version.json`, {
              signal: AbortSignal.timeout(8000),
            })
            if (v.ok) {
              const stable =
                ((await v.json()) as { release?: { stable?: { version?: string }[] } }).release?.stable ?? []
              const last = String(stable[stable.length - 1]?.version ?? '')
              if (/^\d+(?:\.\d+)+$/.test(last)) base = last
            }
          } catch {
            // without the base the label has no number
          }
          const sha = full.slice(0, 7)
          const date = /\d{4}-\d{2}-\d{2}/.exec(tag)?.[0] ?? ''
          const label = ['FORK', base, tag, sha].filter(Boolean).join(' ')
          forkTagCache = { at: Date.now(), info: { repo: FORK.repo, tag, sha, date, base, label } }
        }
      }
    } catch {
      // no internet: the last answer, if any
    }
  }
  return forkTagCache?.info ?? null
}

/** the update page's rows of the fork: its branch and its last tag, each whether it is what is installed */
export function forkRows(installed: string, channel: string, fork: ForkRelease | null, forkTag: ForkTag | null) {
  return {
    fork: fork ? { ...fork, installed: channel === 'fork' && installed.includes(` ${fork.sha} `) } : null,
    forkTag: forkTag ? { ...forkTag, installed: channel === 'fork' && installed.includes(` ${forkTag.tag} `) } : null,
  }
}

/**
 * The arguments of run.sh for the fork: [the unit's kind, repository, branch or tag, label]; null: not the fork's kind;
 * "unreachable": GitHub did not answer. The branch asked again now - the label names the commit that is installed;
 * repository and branch are the fixed ones above, never from the request. The last tag goes the same way: the update
 * script takes a tag where it takes a branch, the unit's kind is "fork" for both.
 */
export async function forkStartArgs(kind: string): Promise<[string, string[]] | null | 'unreachable'> {
  if (kind === 'fork') {
    const f = await forkRelease(true)
    if (!f || !/^[A-Za-z0-9 ._-]{1,80}$/.test(f.label)) return 'unreachable'
    return ['fork', [f.repo, f.branch, f.label]]
  }
  if (kind === 'fork-tag') {
    const f = await forkLastTag(true)
    if (!f || !/^[A-Za-z0-9 ._-]{1,80}$/.test(f.label)) return 'unreachable'
    return ['fork', [f.repo, f.tag, f.label]]
  }
  return null
}
