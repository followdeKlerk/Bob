# Using Bob

Bob lets you work with AI agents on your own Linux machines from an Android phone. Your machine runs the work; the phone is where you chat, follow progress and manage conversations. Available features depend on your backend configuration, model and Android permissions.

For setup, see [Install Bob](INSTALL.md).

## App navigation

Open **Menu** above the message box to switch between:

- **Sessions** — your conversations. Search loaded sessions, start a new chat, rename, pin, archive or move a conversation to recoverable Trash.
- **Chat** — the current conversation and its tools, files and interactive views.
- **Notes** — a notebook shared across conversations on the selected machine.
- **Workstations** — your paired machines. Each keeps its own conversations and configuration.
- **Agents** — helpers working on the current task. Use **History** to view inactive helpers.
- **Settings** — conversation preferences, appearance, phone permissions and updates.

Switching sections keeps your chat draft and reading position. **Settings → Appearance** offers Light, Dark and System themes. Text follows Android's text-size setting.

## Conversation controls

Write a message and send it as normal. While Bob is working, **Chat actions → More** offers ways to steer the current work or send a message after the reply.

- **Stop Bob** stops the main agent.
- **Stop Bob and subagents** also stops its helpers and other work included in that conversation's stop-all action.
- Leaving the chat or minimising the app does not cancel work on your machine.
- Stopping cannot undo a file change, calendar edit or other action already completed.

Text-only messages can continue sending in the background. Keep Bob open for attachment uploads. If delivery is unconfirmed, check the existing message before sending a duplicate.

Your messages appear on the right and Bob's replies on the left. Expand a tool row to see what Bob called, its result or an error. Code blocks have a copy button; wide tables and code can be scrolled sideways.

## Models and conversation settings

Open **Model & thinking** from the **+** menu or **Settings → This conversation**. Choose a model and thinking level, then tap **Apply**. Star models to keep favourites handy. Availability and cost depend on your provider account.

Conversation instructions and the working folder are under **Settings → Instructions & folder**. These apply to that conversation, not every paired machine. Unsaved edits survive navigating away while the app stays open; save them before closing the app.

## Files and web

Use **+** to attach photos, browse files or make a drawing. The default file limit is 25 MiB; model support varies by format. If a drawing fails to attach, it stays available to retry.

Bob can read and edit files, run commands, search the web and use a browser on your machine. The browser does not automatically share your personal browser's sign-ins.

**The working folder is not a sandbox.** Tools have the permissions of the backend's OS account, including access outside that folder. Review consequential actions and use a machine/account you trust with that access.

### Sending files to the phone

Ask Bob to send you a file. It appears as a chat attachment with a **Save file** action; Android asks where to save it. Previews depend on the format and installed apps. A file appearing in chat does not mean it has already been downloaded to your phone.

App updates use **Build & install**, not ordinary file attachments.

## Notes

Open **Notes** to create, search, categorise, pin and edit notes. Markdown and checklists are supported. You can also ask Bob to manage notes in chat.

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

Bob can split suitable work between helpers, such as a researcher, an implementation worker and a reviewer. Follow their progress in **Agents**; opening a transcript does not start or stop work.

Use `/delegation` to inspect available routing choices. With configured profiles, `/delegation auto on` allows Bob to choose helpers for suitable tasks; `/delegation auto off` disables that automatic permission. It is off by default. Helpers can incur additional model costs, and simple work should stay with Bob rather than creating unnecessary agents.

## Keep connected

Enable **Settings → Keep connected** for a workstation to maintain a small background connection. Android shows a persistent notification with **Open** and **Turn off** controls. The full chat catches up when you reopen Bob; turning this connection off does not stop backend work.

This can use more battery. Android restrictions, an interrupted Tailscale connection, offline networks and force-stop can still interrupt it. Reopen Bob after a process restart. There is no guarantee of an uninterrupted connection.

Keep connected does not enable phone control or location access.

## Phone tools

Enable **Settings → Phone tools** for the workstation, grant the Android permissions you want, and keep Bob open on the conversation making the request.

You can ask Bob to:

- Read calendars and create, edit or delete supported non-recurring events.
- Look up contacts; contact access is read-only.
- Find and launch apps, set alarms or timers through the clock app, and report basic device/battery information.
- Change music volume, toggle the flashlight or copy text to the clipboard.
- Open the dialer, an SMS composer, a share chooser or an Android settings page.

Opening another app is a hand-off—not proof that a call was placed, a message sent or an alarm saved. Recurring calendar-series edits, general screen control and private cross-app inbox access are not supported by this feature. A timeout is not a reason to repeat a potentially completed action; ask Bob to check its recorded result first.

Phone data used by Bob reaches the paired backend and configured model and remains in chat history.

## Phone location

Enable **Settings → Automatic location** and grant Android location permission if you want nearby-place or other location-based answers. Bob asks the source phone for a fresh fix when needed, not the backend computer's location.

This is on-demand, not continuous route tracking. Permission, signal, connectivity and Android battery restrictions affect availability and accuracy. Requested locations become part of the conversation and are shared with its model.

## Interactive views

Bob can show interactive cards, diagrams and small workspaces in chat. Ordinary cards grow with their content; wider or denser views can be opened full-screen. Ask Bob to update a saved card's data as the conversation develops.

A card is not an independent live feed: fresh external information or recurring checks need to be requested separately. Reopening restores saved content, but temporary local inputs may reset.

Map and website buttons open their displayed destination only when you tap them. Generated cards cannot silently access your files, credentials, network or backend tools. Optional connected MCP tools and mini-apps need their own backend configuration and granted access.

## Read aloud

Tap the speaker beside a saved reply to read it aloud, then **Stop reading** to stop. Bob uses Android's speech engine and an installed voice reporting offline support; install voice data if needed. Change language, voice and speed through **Settings → Android text-to-speech settings**.

One reply plays at a time. Leaving chat, minimising the app or losing audio focus stops playback. Code blocks are omitted. Pause/seek and audio export are not supported.

## Notifications

Allow Android notifications if you want alerts for replies, questions, schedules and completed or failed builds. General attention alerts share one **Bob needs your attention** notice, without chat previews or Reply actions. Tap it to reopen Bob.

Prompt push alerts require Firebase configuration and Google Play services; otherwise Bob uses background polling, which may be delayed. Network conditions, Android restrictions and force-stop can prevent delivery. An alert is not proof that every pending conversation has been read.

Location, Keep connected and app-update downloads have separate notifications.

## Scheduling

Ask Bob to create a reminder or a recurring read-only check. Give the time, timezone and task; recurring checks also need a run limit and stopping condition. For example: “Remind me tomorrow at 9am to call the dentist.”

Open **Schedules** from the clock in Sessions or **Settings → Schedules** to inspect, pause, resume or cancel saved jobs. Creation and editing happen through chat.

- Reminders save your message without model inference. Checks can use the model and incur costs.
- Checks can read permitted information or search the web; they cannot run shell commands, drive a browser, write files or perform arbitrary external actions.
- Read-only GMX email searches require explicit permission and a defined search window and scope. They do not send mail, change flags or open attachments.
- Unchanged checks stay silent. A match alerts you; a failed check pauses and reports the failure rather than claiming nothing changed.
- Fixed intervals are elapsed time, not calendar recurrence. Daylight-saving changes can shift their local display time.
- The backend must be running. After downtime, one overdue run catches up; missed interval slots are not all replayed.

A saved reminder is not an exact-time Android alarm. Phone delivery is best-effort. Todos do not schedule anything.

## App diagnostics

If something breaks, ask Bob to request a diagnostic report. The phone asks you to **Approve and send** or **Decline** before uploading it. You can also use **Settings → Copy app diagnostics** and share the report yourself.

Reports contain build/device software versions and limited technical events, not chat text, screenshots, location, credentials or raw Android logs. Approved reports are shared with this conversation and its model. Older crash records may still appear; check their app versions when troubleshooting.

## Updates

Ask Bob to update the app, backend or both on a deployment configured for supervised updates. Progress appears in chat. A failed build leaves the running version alone; Bob can inspect the failure without automatically retrying it.

When a signed APK is ready, use **Build & install**. Downloads can continue while Bob is minimised; an **Install** notification appears when the verified update is ready. If notifications are disabled, return to the update card. Android still asks you to approve installation. Older installed versions may require keeping Bob open until you install a release with background downloading.

Backend activation, APK availability and phone installation are separate steps. Keep the existing Android app installed to preserve its data. A compatible code rollback should retain current chat data, not restore an older conversation database.
