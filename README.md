# Playtime

Steam-style playtime tracking for CLI agent harnesses: Claude Code, Codex,
OpenCode, Pi, Oh My Pi, Copilot CLI, Gemini CLI, Cline, Qwen Code, Goose and Factory
Droid.

Steam tells you that you have 412 hours in a game and which ones you played this
week. Nothing does that for agent harnesses. Playtime does.

```
PLAYTIME

  [all time]  this year   this month   today        tab / shift-tab · q quits

                     open   agent busy    last used
  Claude Code    386h 04m   141h 22m 36%      today
  Codex           21h 51m     6h 09m 28%  3 days ago
  OpenCode         4h 23m     1h 02m 23%  2 weeks ago

  Hours used
    ~/work/api          88h 12m  ██████████████████
    ~/work/dashboard    63h 40m  █████████████
    ~/work/infra        41h 05m  ████████

  412h 18m open, agent working 148h 33m of it (36%), 9h 12m of that waiting on you
  1.4 sessions open at a time on average, 2,910h of session time in total
  2,481 turns

  open now  Claude Code  ~/work/api  2h 14m · working
```

## Install

```sh
npm install -g agent-playtime
playtime install
playtime doctor
```

Or without installing anything:

```sh
npx agent-playtime install
npx agent-playtime
```

`playtime install` wires up every harness it finds, backing up each settings
file first, and skips any whose config directory does not exist. Restart running sessions to pick the hooks up. Limit it with
`--harness codex`, or preview with `--dry-run`.

Every harness has a manual route, `playtime install --harness <id>`, with `<id>`
one of `claude-code`, `codex`, `opencode`, `pi`, `omp`, `copilot`, `gemini`, `cline`,
`qwen`, `goose` or `droid`. Three can also be installed from inside the harness:

| Harness | From within the harness | Manual |
|---|---|---|
| Claude Code | `/plugin marketplace add fmarcac/agent-playtime` then `/plugin install playtime` | `playtime install --harness claude-code` |
| Codex | `/plugin marketplace add fmarcac/agent-playtime` then `/plugin install playtime@playtime` | `playtime install --harness codex` |
| OpenCode | add `"plugin": ["agent-playtime"]` to `opencode.json` | `playtime install --harness opencode` |
| Pi | | `playtime install --harness pi` |
| Oh My Pi | | `playtime install --harness omp` |
| Copilot CLI | | `playtime install --harness copilot` |
| Gemini CLI | | `playtime install --harness gemini` |
| Cline | | `playtime install --harness cline` |
| Qwen Code | | `playtime install --harness qwen` |
| Goose | | `playtime install --harness goose` |
| Factory Droid | | `playtime install --harness droid` |

Pick one route per harness. Doing both records every event twice. The plugin
route for Claude Code and Codex runs from a git checkout with no build, so it
starts the tracker through the `playtime` command: install the npm package too.

## Harness support

| Harness | Mechanism | Measured |
|---|---|---|
| Claude Code | hooks in `settings.json` | open, busy, blocked |
| Codex | hooks in `hooks.json` | open, busy, blocked |
| OpenCode | in-process plugin | open, busy, blocked |
| Pi | in-process extension, `agent-playtime/pi` | open, busy |
| Oh My Pi | in-process extension, `agent-playtime/omp` | open, busy, blocked |
| Copilot CLI | `hooks/playtime.json` in its config directory | open, busy, blocked |
| Gemini CLI | hooks in `settings.json` | open, busy, blocked |
| Cline | one executable per event in `~/.cline/hooks/` | open, busy |
| Qwen Code | hooks in `settings.json` | open, busy, blocked |
| Goose | a plugin in `~/.agents/plugins/playtime/` | open, busy |
| Factory Droid | hooks in `~/.factory/hooks.json` | open, busy, blocked |

Notes:

- Pi, Goose and Cline have no permission prompt event, so their blocked time is 0.
- Codex only runs hooks you have approved. After installing, approve them in
  Codex's hooks review, and again after any change to them.
- Cline and Goose only report a session ending in some cases, so their
  sessions usually end when the process exits, which Playtime watches anyway.
- Copilot CLI's `sessionEnd` also fires after every turn in piped mode, so
  sessions run that way are cut into short ones.
- Goose's config directory is a guess (`~/.config/goose` or
  `~/.local/share/goose`); install is skipped if neither exists.
- Pi's and Oh My Pi's extensions are installed as one-line files that re-export
  `agent-playtime/pi` and `agent-playtime/omp`, so updating the package updates them.
- Oh My Pi's extension goes in `~/.omp/agent/extensions/`. A profile
  (`OMP_PROFILE`) or `PI_CODING_AGENT_DIR` points Oh My Pi elsewhere, and it
  will not load it from there; copy `playtime.js` into that `extensions/`.
- Oh My Pi's subagents are not counted separately, since their time is already
  the parent's turn, and approvals a subagent asks for count as busy, not
  blocked. Blocked time comes from tool approvals, and listening for them turns
  off Oh My Pi's speculative file reads.

The status line integration is Claude Code only, through ccstatusline. Codex's
status line takes a fixed set of built-in widgets and has no custom command
slot, so there is nowhere to put it. Run `playtime` in a terminal instead.

## What it measures

**Open time** is wall-clock time a harness was running. It is a union, never a
sum: three windows open at once for an hour is one hour, not three.

**Busy time** is time the agent was working, from prompt submitted until it
stops. Also a union, so fanning out to ten subagents cannot inflate it.

**Blocked time** is the slice of busy time spent waiting on you at a permission
prompt.

**Sessions at once** is raw session hours divided by wall clock. At 1.0 you work
one session at a time; at 2.4 you usually have more than two going.

If you would rather see hours added up than deduplicated, switch counting mode:

```sh
playtime config set count stacked     # or pass --stacked for one run
```

## Commands

```
playtime                     everything, opening on all time
playtime today|month|year    open on one window (week works too)
playtime <project>           drill into one project
playtime harness <name>      drill into one harness, such as claude-code or codex
playtime statusline          one compact line for status bars
playtime config              show and change settings
playtime install             wire up every harness found
playtime doctor              check hooks, daemon and stored history
playtime repair              compact history, dropping unreadable lines
playtime daemon              start the tracker if it is not running
```

Every report opens with a tab strip: **all time**, **this year**, **this month**
and **today**. Tab moves forward, shift-tab moves back, the arrow keys do the
same, and `q` quits leaving the last tab on screen. Today, the month and the
year are calendar periods, so they reset on the boundary rather than trailing a
rolling 30 days. `week` is still available by name and stays a rolling seven
days; ask for it and it joins the strip.

Piped, redirected or in any format but text, a report prints one static block
with no tabs, so scripts and hooks always see plain output.

## Scripting

Every report takes the same options, so `playtime`, `playtime <project>` and
`playtime harness <name>` can all be read by a script.

```sh
playtime --field total.open --units h        # 51.08
playtime --csv --rows days --since 30d       # a daily series
playtime --tsv --rows harnesses --units m    # minutes per harness
playtime --template '{project} {open}' --limit 5
playtime --jsonl --rows projects | jq -r 'select(.open > 3600000) | .project'
```

**Pick one output format.**

| Flag | Prints |
|---|---|
| *(none)* | the human report |
| `--json` | the whole rollup as JSON, or an array of rows with `--rows` |
| `--jsonl` | one JSON object per row |
| `--csv`, `--tsv` | delimited rows with a header |
| `--template <line>` | one line per row, from `{tokens}` |
| `--field <path>` | one value, for example `total.open` or `projects.0.project` |
| `--format <name>` | the same by name: `text`, `json`, `jsonl`, `csv`, `tsv`, `template`, `field` |

**Shape the rows.**

| Flag | Does |
|---|---|
| `--rows <shape>` | `totals`, `harnesses`, `projects` (default) or `days` |
| `--units <unit>` | `human`, `ms` (default), `s`, `m` or `h` |
| `--sort <key>` | `open`, `busy`, `blocked`, `sessionTime`, `sessions`, `turns`, `last`, `name`, `date` |
| `--reverse` | flip the order |
| `--limit <n>` | keep the first n rows |
| `--no-header` | leave the CSV or TSV header row out |

**Choose what to report on.**

| Flag | Does |
|---|---|
| `--since <when>`, `--until <when>` | an explicit window, overriding the named one |
| `--project <filter>`, `--harness <name>` | select by flag rather than by position |
| `--stacked`, `--wallclock` | override the counting mode for one run |
| `--width <n>`, `--no-color` | layout of the text report, as does `NO_COLOR=1` |

`--since` and `--until` take `2026-07-01`, a full ISO timestamp, a span like
`7d`, `90m` or `2w`, the words `now`, `today` and `yesterday`, or an epoch in
seconds or milliseconds. A bare date means local midnight.

**Columns.** Every row carries both totals, so machine output never depends on
the counting mode:

| Column | Is |
|---|---|
| `open` `busy` `blocked` | deduplicated: an hour with three sessions open is one hour |
| `sessionTime` | the same open time summed per session instead |
| `busyStacked` `blockedStacked` | the same, for busy and blocked |
| `concurrency` | `sessionTime` divided by `open` |
| `share` | busy as a percentage of open |
| `sessions` `turns` | counts |
| `lastPlayed` `start` `end` | ISO 8601 timestamps, always UTC |
| `project` `harness` `date` | what the row is |

`--rows days` gives one row per local calendar day, including days with nothing
in them, and the days always add up to the window total. Project paths are
absolute in machine output rather than shortened to `~`.

Exit codes: **0** done, **1** nothing matched (an unknown project, or a
`--field` path that is not there), **2** the command line was wrong.

## ccstatusline

```sh
$ playtime statusline
412h18m open · 96h30m busy
```

It reports **all time** by default, the way Steam shows hours in a game. For a
shorter horizon, `playtime config set statusline.window today` or `week`.

Add a **Custom Command** widget in ccstatusline's editor, or append this to a
line in `~/.config/ccstatusline/settings.json`:

```json
{
  "id": "a-unique-id",
  "type": "custom-command",
  "commandPath": "playtime statusline",
  "timeout": 3000,
  "color": "gradient:summer"
}
```

It reads one small file, never session history, so a render costs about 33ms
against ccstatusline's 1000ms timeout. ccstatusline passes the terminal width on
stdin and the layout shortens itself when space is tight. With no data yet it
prints nothing and the widget stays hidden.

Change the layout with `playtime config set statusline.format '{project} {open}'`,
or per-run with `--format`. Tokens: `{open}` `{busy}` `{blocked}` `{sessions}`
`{turns}` `{total}` `{concurrency}` `{project}` `{harness}` `{live}`. For other
status bars, `playtime statusline --json` emits the same numbers structured.

## Settings

`playtime config` in a terminal opens an interactive settings screen. Arrow
keys move, left and right cycle a setting with fixed choices, enter types a
value, `r` resets one, `q` saves and quits. Escape throws the edits away, asking
first if there are any. It redraws its own block rather than taking over the
screen, so it scrolls with your scrollback and works over ssh.

```
  > count              wallclock                 deduplicate sessions open at the same time ←→
    statusline.format  {open} open · {busy} busy  template for the status line
    statusline.window  allTime                   period the status line reports

  ↑↓ move   ←→ change   enter type a value   r reset   q save   esc discard
```

Piped or scripted it prints a plain listing instead, and
`playtime config set <key> <value>` changes one without the screen.

| Setting | Default | Does |
|---|---|---|
| `count` | `wallclock` | deduplicate sessions open at the same time: `wallclock` counts an overlapping hour once, `stacked` counts it per session |
| `statusline.format` | `{open} open · {busy} busy` | status line template |
| `statusline.window` | `allTime` | period the bare tokens report: `allTime`, `today` or `week` |
| `projects.limit` | `12` | project rows under Hours used |
| `daemon.tickMs` | `15000` | how often liveness is sampled |
| `daemon.idleExitMs` | `120000` | how long the daemon lingers when idle |

Cadence can also be overridden per run with `PLAYTIME_TICK_MS`,
`PLAYTIME_IDLE_EXIT_MS` and `PLAYTIME_CHECKPOINT_MS`. `PLAYTIME_NODE` names the
Node binary the daemon is started with, for when it is not on `PATH`.

Stored at `~/.config/playtime/config.json`, holding only what differs from the
defaults.

## How it works

Hooks alone cannot measure this. A session idle for three hours emits no events,
and `SessionEnd` never fires on a `kill -9` or a closed terminal. So Playtime
samples rather than guesses.

```
 harness events                 daemon                     query
 --------------                 ------                     -----
 Claude Code,  |
 Codex, Gemini|  emit.sh    inbox/         drain + tick     playtime CLI
 Qwen, Droid, |----------->  one file ----------------->  sessions.jsonl --> reports
 Copilot,     |  (~5ms)     per event      every 15s        live.json     --> statusline
 Goose, Cline |   hooks                    kill(pid, 0)
 OpenCode, Pi,|
 Oh My Pi     |
 (in-process plugin or extension)
```

Each hook runs a POSIX `sh` shim that stamps a timestamp and appends the payload
verbatim. It parses nothing and starts no Node process, so it stays out of the
way of your tool calls. The daemon does the interpreting, starts itself when a
session opens, and exits two minutes after the last one closes. Nothing to
manage; if it dies, the next hook brings it back.

Each event lands in the inbox as its own file, renamed into place, so hooks
firing at once can never tear each other's lines.

It stores intervals rather than samples, one line per session, so years of
history stay small enough to parse on every command.

Things it deliberately gets right:

- **A sleeping laptop counts for nothing.** Liveness is interpolated only across
  short gaps. Close the lid for eight hours and that time is excluded.
- **A killed daemon does not lose in-flight sessions.** Open sessions are
  written to durable history every minute, not just when they close, and
  `live.json` is a full checkpoint besides. A successor resumes from the last
  confirmed-alive moment, so the outage itself is never credited.
- **A failed write does not kill the tracker.** Losing a disk write once should
  not cost you the hours the daemon was holding, so failures are logged and the
  loop carries on.
- **A truncated line costs a line, not a history.** Reading skips what it
  cannot parse. `playtime repair` drops those lines and collapses the
  superseded checkpoints, keeping a `.playtime-backup` of the file as it was;
  the daemon does the same for itself when it starts, which is the one moment
  nothing else is appending.
- **A recycled pid does not resurrect a dead session.** Process start times are
  recorded next to pids.
- **Failures undercount, never overcount.** If anything breaks, time stops
  accruing.

## Limitations

**Blocked time is approximate.** No harness emits an event when you approve a
permission prompt, so it is measured from the prompt to the completion of the
tool it gated, or to the end of the turn if the tool never runs. That
overstates the wait for a long-running tool.

**Pid tracking is best on Linux.** The shim walks `/proc` with shell builtins.
macOS and BSD fall back to `ps`, which is slower, and have no cheap process
start time, so pid reuse is not guarded there.

**Per-project rows can exceed the total.** Each row unions only its own
project's sessions, so time on two projects at once counts for both. A project
row answers "how long did I spend on this".

**Counts are per session.** Windowed views clip durations exactly, but a
session's turn count is attributed whole to any window it overlaps.

## Data

Everything is local. Nothing is sent anywhere.

```
${XDG_DATA_HOME:-~/.local/share}/playtime/
  sessions.jsonl    append-only history, one line per session per checkpoint
  live.json         open sessions, cached totals, daemon checkpoint
  inbox/            hook drop box, one file per event, drained every tick
  daemon.lock       single-instance lock
  daemon.log        diagnostics, size capped
```

Set `PLAYTIME_HOME` to move it.

## Development

```sh
npm install       # builds via the prepare step
npm test          # builds, then runs the suite
npm run typecheck
```

The interval engine is pure and property-tested: union is idempotent,
order-independent, and never exceeds either the naive sum or its own span. The
daemon takes an injectable clock and process probe, so its tests are
deterministic and never sleep. One test spawns the real daemon entrypoint,
because an in-process test cannot catch a daemon that fails to keep its own
event loop alive.

## License

MIT
