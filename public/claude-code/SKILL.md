---
name: aletheia
description: Save Claude's answer to Aletheia, Avvos's outliner, as a new item under Work › today's date with the answer as its note, optionally with a web page (charts, flowcharts) linked from it. Use when the user runs /aletheia or asks to save, send, log or put something in Aletheia.
argument-hint: "[title] [under <section>] [with page]"
allowed-tools: Bash(curl -sS -K ~/.config/aletheia/capture.curlrc *)
---

# Save to Aletheia

Add one item to Aletheia under **Work › today's date** (like "14 Oct"). The
item's title is a short name for what was done; its note is the answer itself,
in Markdown. Aletheia makes "Work" and the date when they are missing.

Arguments: $ARGUMENTS

## What to send

- **Note**: by default, your most recent substantive answer in this
  conversation, copied verbatim as Markdown (headings, lists, tables, code
  blocks). Don't summarize or shorten it, and don't add a preamble. If the
  user names something else ("save the plan", "save the summary of this
  session"), send that instead; write it first if it doesn't exist yet.
- **Title**: the arguments, if they give one. Otherwise write a short title
  (at most 8 words) that says what the note is about, e.g. "Fix login
  redirect loop" or "Meeting notes: Q4 planning".
- **Section**: "Work", unless the arguments say `under <name>` (then send
  that name as `under`).
- **Page** (optional): only when the user asks for a page, a visual report,
  charts, diagrams or a demo ("with page", "make it visual"). See below.

## The page

One self-contained HTML file that shows the work to someone non-technical,
such as a manager in a meeting. The note stays the plain-language summary; the
page adds what text can't: a flowchart of how the pieces connect, before/after
comparisons, a timeline, charts of what changed.

- Plain language, short sentences, no code unless asked. Lead with outcomes.
- Inline CSS. Scripts may load from cdn.jsdelivr.net, e.g. Mermaid
  (`https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js`, then
  `mermaid.initialize({ startOnLoad: true })` and `<pre class="mermaid">`
  blocks) for flowcharts and Chart.js
  (`https://cdn.jsdelivr.net/npm/chart.js@4`) for charts. Hand-written inline
  SVG works too.
- It must work on a phone and a laptop, in light and dark mode.
- It opens in a sandboxed frame: no cookies, localStorage or fetches to
  private servers. Keep it under 1 MB.
- Put only what is safe to keep in personal notes: no secrets, tokens,
  customer data or internal hostnames.

## How to send

Run exactly one command: a heredoc piped to curl. curl reads the address, the
capture key and the user's time zone (which picks today's date) from
`~/.config/aletheia/capture.curlrc`; never print, cat or echo that file.

```bash
curl -sS -K ~/.config/aletheia/capture.curlrc \
  --form-string "title=THE TITLE" \
  -F "note=<-" <<'ALETHEIA_NOTE'
THE NOTE, VERBATIM MARKDOWN
ALETHEIA_NOTE
```

With a page, send it on file descriptor 3 in the same command (both heredocs
are quoted, so nothing in them is expanded):

```bash
curl -sS -K ~/.config/aletheia/capture.curlrc \
  --form-string "title=THE TITLE" \
  -F "note=<-" -F "page=</dev/fd/3" <<'ALETHEIA_NOTE' 3<<'ALETHEIA_PAGE'
THE NOTE, VERBATIM MARKDOWN
ALETHEIA_NOTE
<!doctype html>
THE PAGE
ALETHEIA_PAGE
```

- Add `--form-string "under=NAME"` only when the user asked for another
  section, and `--form-string "date=15 Oct"` only when they named a day.
- Quote the title for the shell (escape `"`, `$` and backticks inside it).
- The heredoc delimiters are quoted, so `$` and backticks are sent as
  written. If the note or page contains a line that is exactly a delimiter,
  pick another one.

## After sending

The reply is JSON. On success it has `url` and `path` (and `page` when a page
was sent); tell the user in one line where it went, like: Saved to Work ›
14 Oct › Fix login redirect loop (link). Their devices pick it up on their
next sync (within about 30 seconds while Aletheia is open). The page opens
from the link at the top of the note, or at `page`, on their devices with sync
on.

If it fails:

- `curl: (26)` or "can't open config file": not set up on this computer. Tell
  the user to open Aletheia → Settings → Sync → Claude Code, press "Set up
  Claude Code" and run the command it shows in a terminal.
- 401 "Unknown capture key": the key was replaced or never made. Same fix.
- Anything else: show the error text from the reply.
