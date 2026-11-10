# Using Bob

Bob lets you work with AI agents on your own Linux machines from an Android phone. Your machine runs the work; the phone is where you chat, follow progress and manage conversations. Available features depend on your backend configuration, model and Android permissions.

For setup, see [Install Bob](INSTALL.md).

## App navigation

Open **Menu** above the message box to switch between:

- **Chat** — the current conversation and its tools, files and interactive views.
- **Terminal** — an experimental Mosh terminal for the selected main conversation on a Linux workstation. It requires the native arm64 Android client and host Mosh/tmux prerequisites described below.
- **Notes** — a notebook shared across conversations on the selected machine.
- **Workstations** — your paired machines. Each keeps its own conversations and configuration.
- **Agents and Sessions** — opens the compact **Sessions** screen on the selected workstation. Search loaded conversations and helpers above the list; one **Active ▾** selector in the bottom controls opens Active, Archived and Trash choices. Conversation titles come first, with Bob, session IDs and real status below. Tap a row to open its chat, or expand its helper count for view-only helper transcripts, including completed helpers. Each row’s **⋯** menu (also available by long press) provides rename, pin/unpin, archive/unarchive, move to Trash or restore. Plain row ellipses and inline helper counts keep the list compact. A single in-flow bottom toolbar keeps the filter selector, **Schedules**, the **+** New session action and **Menu** available without covering list content; soft, theme-matched fades ease the list into its header and footer.
- **Settings** — a short index with separate **Appearance**, **Conversation settings**, **Notifications**, **Voice**, **Phone & location**, **Connection**, **App & updates** and **Advanced** pages, plus Schedules. Each submenu has Back; opening a category does not toggle its settings.

Switching sections keeps your chat draft and reading position. **Settings → Appearance** offers Light, Dark and System themes. Text follows Android's text-size setting. The light theme uses a warm beige background with deeper beige chat bubbles: a richer shade for assistant replies and a slightly lighter shade for owner messages. The selected Menu destination uses a thin rounded outline and checkmark rather than a filled highlight. Non-chat action buttons share outlined circular icons or matching text pills with a slightly stronger soft shadow, as do existing raised composer and pop-up surfaces; message bubbles and tool rows stay flat. Nunito is bundled offline for chat text, inputs, menus, settings, pickers, editors and app-owned native controls. These surfaces share compact rounded headings, consistent spacing and soft header/footer fades. Search boxes stay directly below page headings; Back/Cancel stays left and primary actions sit before Menu in the bottom controls. Code, raw technical payloads and the terminal retain Nordwand Mono for alignment.

## Conversation controls

Write a message and send it as normal. While Bob is working, **Chat actions → More** offers ways to steer the current work or send a message after the reply.

- **Stop Bob** stops the main agent.
- **Stop Bob and subagents** also stops its helpers and other work included in that conversation's stop-all action.
- Leaving the chat or minimising the app does not cancel work on your machine.
- Stopping cannot undo a file change, calendar edit or other action already completed.

Text-only messages can continue sending in the background. Keep Bob open for attachment uploads. If delivery is unconfirmed, check the existing message before sending a duplicate.

Your messages appear on the right and Bob's replies on the left. New streamed prose has a brief leading-edge fade, without delaying the words; reduced-motion and screen-reader settings disable chat animations. Expand a tool row to see what Bob called, its result or an error. Small link footers show the reply's existing labels and destination domains without fetching web previews. Code blocks have a copy button; wide tables and code can be scrolled sideways.

## Models and conversation settings

Open **Model & thinking** from the chat’s **+** menu. The current model is marked directly in the list; choose a model, swipe the single thinking-effort row sideways, then tap **Apply**. Star models to keep favourites handy. Availability and cost depend on your provider account.

Conversation instructions and the working folder are under **Settings → Conversation settings**. These apply to that conversation, not every paired machine. Unsaved edits survive navigating away while the app stays open; save them before closing the app.

Previously created local-model conversations and uploaded files remain available as read-only history. They cannot send messages, change models, enable tools or become normal Bob conversations. Start a new ordinary conversation to continue with Bob; a separately running model/server is unaffected.

## Terminal (Linux / arm64 Android prototype)

Open **Menu → Terminal** to connect directly inside Bob, with the workstation and starting folder in a compact header. There is no separate terminal window or launcher page. The host needs `mosh-server`, `tmux` and Python 3 in `/usr/bin`, with Linux/Python pidfd support for safely stopping only the owned process; the phone needs an arm64 build with the packaged native Mosh client. Unsupported builds show an availability message instead of pretending to connect. New shells use the conversation's configured working folder, not a temporary `cd` inside an agent tool command. This is your own interactive shell under the backend OS account, with access to the same files as the agent—not a sandbox and not the agent's running command.

Terminal keys stay on one row at normal phone text sizes and wrap as whole, equally sized keys with larger text. On very short keyboard-reduced screens, the keys remain available in Terminal controls instead of covering the terminal.

New sessions prefer `/usr/bin/zsh`, with a spaced two-line prompt showing the last two current-folder components (`~` for home), shortened to the terminal width, above a simple prompt. Use `pwd` for the full path. When the distro's `zsh-syntax-highlighting` package is installed, commands are coloured as you type, using the terminal theme's standard ANSI colours. Bob uses a private startup file under its backend terminal directory, not your `~/.zshrc`, and does not change your login shell. User and global zshrc files are skipped; zsh's system `zshenv` is unavoidable. Missing optional dependencies do not disable Terminal: zsh works without the highlighter, or Bob falls back to isolated bash with a current-folder prompt, then plain sh where necessary.

**Existing shells are not upgraded in place.** Reconnect and backend updates preserve their processes and current folder. To get the new prompt and highlighting, finish any running work, explicitly choose **End terminal session**, then connect again to create a new shell. Bob never injects shell setup into a live pane. The redundant tmux status strip is hidden only for the exact Bob-owned session on each connect, including reconnects; other tmux sessions are not restyled.

The terminal uses Mosh over UDP on the workstation's bound Tailscale address (ports **60020–60027**). A successful HTTPS pairing does not prove this UDP range is reachable; host firewall and Tailscale access rules must permit it. Bob does not open firewall rules automatically. Bootstrap uses the existing authenticated Bob connection rather than separate SSH credentials. Terminal text and session keys are not appended to AI chat, although normal host shell/program behaviour can still write files or history.

A dedicated tmux session keeps the shell available after leaving the terminal or after Android closes Bob. **Reconnect** establishes a new Mosh connection to the same tmux shell; it does not restore a killed Mosh client. Reattachment preserves the shell's current directory. Leaving the embedded terminal or backgrounding Bob closes the local client; it does not run an always-on terminal service. Reopening the Terminal menu reattaches; after backgrounding, tap **Reconnect**. The terminal uses Bob’s colours and bundled typeface, with its normal Back/Menu controls. Host reboot, shell exit or **End terminal session** ends the shell. End requires confirmation because it can stop programs inside the session. Revoking the paired device also closes its terminal sessions when the backend's cleanup loop runs.

The compact key row offers Ctrl, Esc, Tab and arrow keys. **Terminal controls** (the three-dot button) contains copy/paste, **History** (tmux copy mode; press `q` to leave), Reconnect and End session. Mosh's screen synchronization alone is not complete scrollback. One device owns a conversation's terminal at a time, with up to eight host sessions. Connection retries are explicit and use a request identity to avoid duplicate launches after an uncertain HTTP result; if a receipt expires, explicitly reconnect. Main conversations only: helper views, Trash and retired read-only chats cannot start terminals.

This prototype requires physical-device acceptance for keyboard behaviour, network changes and app-kill recovery; compilation and component tests alone do not establish those behaviours. Bundled components retain their own licences; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Files and web

Use **+** to attach photos, browse files or make a drawing. The default file limit is 25 MiB; model support varies by format. If a drawing fails to attach, it stays available to retry. Consecutive uploaded photos appear as overlapping image cards in chat. Swipe horizontally, or use Previous/Next, to bring another image forward; tap the front card to open the original. Info follows the current image; no numeric counter is shown beneath the photos. Reduced-motion settings disable the animated transition, and vertical swipes still scroll the conversation. Draft attachments keep their individual removal controls.

Bob can read and edit files, run commands, search the web and use a browser on your machine. The browser does not automatically share your personal browser's sign-ins.

**The working folder is not a sandbox.** Tools have the permissions of the backend's OS account, including access outside that folder. Review consequential actions and use a machine/account you trust with that access.

### Sending files to the phone

Ask Bob to send you a file. Generated files settle beneath the answer that produced them when Bob has a verified reply association; older or unproven outputs remain in their original place. Your own uploads stay with your message. File-type icons identify documents, packages, audio and video; photos use rounded image previews, and the small info button opens a theme-aware details sheet with the full filename, type and size. Images from the same verified answer can share a stack; unrelated replies and intervening non-image attachments remain separate. For files sent by Bob, the matching small download icon sits beside Info beneath the preview and saves the currently selected image.

PDF previews support pinch-to-zoom, dragging to pan, and double-tapping to zoom or fit the page. Swipe left or right to change pages. When zoomed, pan to a page edge, then start a new outward swipe to turn the page; panning into an edge or lifting a finger after a pinch does not skip pages. A compact bottom toolbar keeps Close, page arrows, the page count and Fit page available, including screen-reader actions. The viewer redraws zoomed detail in bounded background work and preserves the page and zoom when the screen rotates. PDF paper keeps its original colours in either app theme. Previewing does not change the original file or save a copy outside Bob.

Tap **Play** on audio or video to stream through the paired connection, with play/pause and seeking. The player distinguishes connecting, loading, playing, paused, seeking and buffering, with an elapsed-time display and actual received-byte count—not a guessed buffering percentage. Playback uses a small bounded in-memory range cache rather than requiring a complete download first, and stops when hidden or backgrounded. Video also has a **Full view** button; closing it stops playback and keeps a resume position for the next explicit Play. Unsupported media or a disconnected backend produces an error with retry and external-open options. **Save** remains separate; Android asks where to save a copy. A file appearing in chat does not mean it has already been saved on your phone.

App updates use **Build & install**, not ordinary file attachments.

## Notes

Open **Notes** to create, search, categorise, pin and edit notes. Swipe the category filters sideways; Trash and Categories are in the bottom toolbar beside Sync and Create. Edit Markdown directly; the eye-shaped Preview control is in the editor’s bottom toolbar. Markdown and checklists are supported. You can also ask Bob to manage notes in chat.

Notes belong to the selected workstation and are shared across its conversations. They are your documents, not automatic instructions to the agent.

Edits queue locally for syncing. Keep Bob open to finish synchronisation and check any pending/error indicator before assuming a note is saved on the backend. Conflicting edits preserve a separate copy rather than silently discarding your work. Trash is recoverable.

## Information and instructions

Bob keeps different kinds of information separate:

| Kind | What it is for |
| --- | --- |
| Notes | Documents you want to find and manage yourself |
| Skills | Reusable ways of doing a task, including your task-specific preferences |
| User/environment memory | Short facts useful across conversations |
| Hindsight memory | Optional long-term recall and conversation saving |
| Todos | A checklist for the current conversation, not a reminder service |
| Conversation instructions | Guidance for one chat |

Ask Bob to clarify where something should be saved if the distinction matters. Saving a note does not automatically save the same text to long-term memory.

### Your own soul.md

Each backend has a private `soul.md` in its state directory. It controls Bob's identity and standing behaviour. Changes take effect on the next model request without rebuilding; requests already sent are unchanged. Other skills, feature instructions and enforced permissions still apply.

The repository contains only a generic starting template. Keep your personalised file private and back it up separately; do not publish it in Git.

### Skills and automatic learning

Type `/` in an empty chat draft to find available commands and enabled skills. Selecting one inserts an editable draft; you still choose when to send it.

- `/learn` turns a completed workflow or supplied material into a reusable skill.
- `/refine` asks Bob to review the conversation for useful memory and skill improvements.
- `/bro` simplifies the latest reply, if that optional skill is installed. Add text after it to simplify something else.

Automatic review is enabled by default, checking memory about every 10 user turns and skills every 10 tool-calling steps. Ask Bob to inspect or change those settings. Skill changes appear in chat; a review with nothing to save stays quiet. Learning updates memory and skills, not Bob's application code.

You can inspect, pin, archive and restore skills through chat. Pinning protects a skill from automatic ageing. Optional skill-library consolidation runs only when requested. Proposed background edits/removals to existing memory can be approved or rejected with the specific `/memory approve <id>` or `/memory reject <id>` command Bob provides.

### Memory

Optional Hindsight memory recalls useful historical context and saves ordinary conversation text for future recall. Ask “what do you remember about…”, “check memory status”, or “turn memory off in this conversation”. See [memory setup](packages/memory/README.md) if you run that service.

Saving can take time: **queued** or **saving** is not yet **saved**. Failures remain visible for an explicit retry. Existing Hermes memories can be recalled without Bob writing to that bank.

Add `#nomem` or `#skip` to a message to exclude that turn from automatic recall, retention and learning. This does not remove the message from your chat history or undo information already sent. Memory processing may use an external model even when the memory database runs locally.

## History and connected agents

Ask Bob to find an older conversation or consult an existing agent on another paired machine. A history search can cover only part of the available history; Bob should say when its results are incomplete.

Agents in other conversations are independent. Contacting one does not grant control over it or make it a helper owned by the current task.

## Subagents

Bob can split suitable work between helpers, such as a researcher, an implementation worker and a reviewer. **Agents and Sessions** groups helpers beneath their conversation, with pinned sessions first, then running sessions. Helper groups are collapsed by default; expand the count to see their names, statuses and transcripts. Empty helper groups are omitted. The screen shares the compact Nunito hierarchy used by the other menus; chat prose also uses Nunito while code remains monospaced. Status labels reflect known execution state; it does not invent activity times, previews or failure states. One bottom filter selector switches between Active, Archived and Trash; the choices appear only while selecting. The overview refreshes while visible; **More sessions** loads older groups, and search filters the groups already loaded. A helper opens in a view-only transcript, with **Back to agent list** returning to the tree. Opening it never starts or stops work or changes an unsent message in the main chat. Unknown or failed refreshes are shown explicitly rather than treated as idle. This overview covers the selected workstation, not every paired machine at once.

Use `/delegation` to inspect available routing choices. With configured profiles, `/delegation auto on` allows Bob to choose helpers for suitable tasks; `/delegation auto off` disables that automatic permission. It is off by default. Helpers can incur additional model costs, and simple work should stay with Bob rather than creating unnecessary agents.

## Keep connected

Enable **Settings → Connection → Keep connected** for a workstation to maintain a small background connection. Android shows a persistent notification with **Open** and **Turn off** controls. The full chat catches up when you reopen Bob; turning this connection off does not stop backend work.

This can use more battery. Android restrictions, an interrupted Tailscale connection, offline networks and force-stop can still interrupt it. Reopen Bob after a process restart. There is no guarantee of an uninterrupted connection.

Keep connected does not enable phone control or location access.

## Phone tools

Enable **Settings → Phone & location → Phone tools** for the workstation, grant the Android permissions you want, and keep Bob open on the conversation making the request.

You can ask Bob to:

- Read calendars and create, edit or delete supported non-recurring events.
- Look up contacts; contact access is read-only.
- Find and launch apps, set alarms or timers through the clock app, and report basic device/battery information.
- Change music volume, toggle the flashlight or copy text to the clipboard.
- Open the dialer, an SMS composer, a share chooser or an Android settings page.

Opening another app is a hand-off—not proof that a call was placed, a message sent or an alarm saved. Recurring calendar-series edits, general screen control and private cross-app inbox access are not supported by this feature. A timeout is not a reason to repeat a potentially completed action; ask Bob to check its recorded result first.

Phone data used by Bob reaches the paired backend and configured model and remains in chat history.

## Phone location

Enable **Settings → Phone & location → Automatic location** and grant Android location permission if you want nearby-place or other location-based answers. Bob asks the source phone for a fresh fix when needed, not the backend computer's location.

This is on-demand, not continuous route tracking. Permission, signal, connectivity and Android battery restrictions affect availability and accuracy. Requested locations become part of the conversation and are shared with its model.

## Interactive views

Bob can show interactive cards, diagrams and small workspaces in chat. Ordinary cards grow with their content; wider or denser views can be opened full-screen. Ask Bob to update a saved card's data as the conversation develops.

A card is not an independent live feed: fresh external information or recurring checks need to be requested separately. Reopening restores saved content, but temporary local inputs may reset.

Map and website buttons open their displayed destination only when you tap them. Generated cards cannot silently access your files, credentials, network or backend tools. Optional connected MCP tools and mini-apps need their own backend configuration and granted access.

## Read aloud

Tap the speaker beside a saved reply to read it aloud, then **Stop reading** to stop. Bob uses Android's speech engine and an installed voice reporting offline support; install voice data if needed. Change language, voice and speed through **Settings → Voice → Voice & speed**.

One reply plays at a time. Leaving chat, minimising the app or losing audio focus stops playback. Code blocks are omitted. Pause/seek and audio export are not supported.

## Notifications

Allow Android notifications if you want alerts for replies, questions, schedules and completed or failed builds. General attention alerts share one **Bob needs your attention** notice, without chat previews or Reply actions. Tap it to reopen Bob.

Prompt push alerts require Firebase configuration and Google Play services; otherwise Bob uses background polling, which may be delayed. Network conditions, Android restrictions and force-stop can prevent delivery. An alert is not proof that every pending conversation has been read.

Location, Keep connected and app-update downloads have separate notifications.

## Scheduling

Ask Bob to create a reminder or a recurring read-only check. Give the time, timezone and task; recurring checks also need a run limit and stopping condition. For example: “Remind me tomorrow at 9am to call the dentist.”

Open **Schedules** from the clock in **Agents and Sessions** or **Settings → Schedules** to inspect, pause, resume or cancel saved jobs. Creation and editing happen through chat.

- Reminders save your message without model inference. Checks can use the model and incur costs.
- Checks can read permitted information or search the web; they cannot run shell commands, drive a browser, write files or perform arbitrary external actions.
- Read-only GMX email searches require explicit permission and a defined search window and scope. They do not send mail, change flags or open attachments.
- Unchanged checks stay silent. A match alerts you; a failed check pauses and reports the failure rather than claiming nothing changed.
- Fixed intervals are elapsed time, not calendar recurrence. Daylight-saving changes can shift their local display time.
- The backend must be running. After downtime, one overdue run catches up; missed interval slots are not all replayed.

A saved reminder is not an exact-time Android alarm. Phone delivery is best-effort. Todos do not schedule anything.

## App diagnostics

If something breaks, ask Bob to request a diagnostic report. The phone asks you to **Approve and send** or **Decline** before uploading it. You can also use **Settings → App & updates → Copy app diagnostics** and share the report yourself.

Reports contain build/device software versions and limited technical events, not chat text, screenshots, location, credentials or raw Android logs. Approved reports are shared with this conversation and its model. Older crash records may still appear; check their app versions when troubleshooting.

## Updates

Ask Bob to update the app, backend or both on a deployment configured for supervised updates. Progress appears in chat. A failed build leaves the running version alone; Bob can inspect the failure without automatically retrying it.

For app-only updates, Bob can automatically use a **fast UI-only build** when a saved, fully validated source baseline proves that only supported presentation files changed. It still checks mobile TypeScript, runs the mobile tests, and builds and verifies the signed APK, but skips unrelated backend tests and backend packaging. The backend stays running unchanged. Missing baselines, unsupported changes, and backend or combined updates use full validation instead; this is not a general “skip tests” switch. The first build after enabling this feature establishes the baseline. Ask for a combined app-and-backend update when a batch is finished to run full validation again. Android building and owner-approved installation are still required; this is not hot reload.

When a signed APK is ready, use **Build & install**. Downloads can continue while Bob is minimised; an **Install** notification appears when the verified update is ready. If notifications are disabled, return to the update card. Android still asks you to approve installation. Older installed versions may require keeping Bob open until you install a release with background downloading.

Backend activation, APK availability and phone installation are separate steps. Keep the existing Android app installed to preserve its data. A compatible code rollback should retain current chat data, not restore an older conversation database.
