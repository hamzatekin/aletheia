---
name: aletheia
description: Save Claude's answer to Aletheia, Avvos's outliner, as a new item under Work › today's date with the answer as its note. Use when the user runs /aletheia or asks to save, send, log or put something in Aletheia.
argument-hint: "[title] [under <section>]"
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

- Add `--form-string "under=NAME"` only when the user asked for another
  section, and `--form-string "date=15 Oct"` only when they named a day.
- Quote the title for the shell (escape `"`, `$` and backticks inside it).
- The heredoc delimiter is quoted, so `$` and backticks in the note are sent
  as written. If the note contains a line that is exactly `ALETHEIA_NOTE`,
  pick another delimiter.

## After sending

The reply is JSON. On success it has `url` and `path`; tell the user in one
line where it went, like: Saved to Work › 14 Oct › Fix login redirect loop
(link). Their devices pick it up on their next sync (within about 30 seconds
while Aletheia is open).

If it fails:

- `curl: (26)` or "can't open config file": not set up on this computer. Tell
  the user to open Aletheia → Settings → Sync → Claude Code, press "Set up
  Claude Code" and run the command it shows in a terminal.
- 401 "Unknown capture key": the key was replaced or never made. Same fix.
- Anything else: show the error text from the reply.
