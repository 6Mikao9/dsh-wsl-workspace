#!/usr/bin/env bash
# Rebuild the WSL repro tree exercised by scripts/repro-e2e.mjs (issue #10).
# Runs INSIDE the WSL distro, e.g.:  wsl -d Ubuntu bash /tmp/repro-setup.sh
# (copy it over with:  cp scripts/repro-setup.sh //wsl.localhost/<distro>/tmp/ )
# Idempotent: removes and recreates "$HOME/repro-ws-root".
set -euo pipefail

ROOT="${HOME}/repro-ws-root"
rm -rf "$ROOT"

# md <skill-file> <name> <description> [extra frontmatter line]
md() {
  path="$1" name="$2" description="$3" extra="${4:-}"
  mkdir -p "$(dirname "$path")"
  {
    printf -- '---\nname: %s\ndescription: %s\n' "$name" "$description"
    if [ -n "$extra" ]; then printf '%s\n' "$extra"; fi
    printf -- '---\n\nBody of %s.\n' "$name"
  } > "$path"
}

# proj-a: a real nested project (has .git, .dsh/skills bundles, src/ for
# deep-cwd lookups where the session cwd sits inside the project).
mkdir -p "$ROOT/proj-a/.git" "$ROOT/proj-a/src"
md "$ROOT/proj-a/.dsh/skills/brainstorming/SKILL.md" brainstorming "Structured brainstorming"
md "$ROOT/proj-a/.dsh/skills/systematic-debugging/SKILL.md" systematic-debugging "Systematic debugging walkthrough"

# proj-b: nested project with a flat .agents/skills skill carrying whenToUse.
mkdir -p "$ROOT/proj-b"
md "$ROOT/proj-b/.agents/skills/writing-plans.md" writing-plans "Plan writing" "whenToUse: When a task needs a plan"

# Workspace-root skills: a probe for duplicate publication — the host's own
# skill-filesystem may also serve these when it resolves the workspace root.
md "$ROOT/.dsh/skills/root-skill.md" root-skill "At the workspace root"

# Pruned: skills under node_modules or dot-directories must never surface.
mkdir -p "$ROOT/proj-a/node_modules/pkg"
md "$ROOT/proj-a/node_modules/pkg/.dsh/skills/hidden.md" hidden "Must not appear"
mkdir -p "$ROOT/.hidden-zone"
md "$ROOT/.hidden-zone/.dsh/skills/dot.md" dot "Must not appear either"

# Too deep: the directory carrying .dsh/skills sits at depth 5, beyond the
# MAX_SCAN_DEPTH budget, so its skill must not surface.
mkdir -p "$ROOT/deep/nested/too-far/way/deeper"
md "$ROOT/deep/nested/too-far/way/deeper/.dsh/skills/toodeep.md" toodeep "Beyond depth budget"

echo "repro tree rebuilt at $ROOT:"
find "$ROOT" -name '*.md' | sort
