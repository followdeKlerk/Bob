# Bob on Android: capability map

A private, sideloaded Bob prototype can do much more than chat. Google Play distribution rules are **not** the limiting factor for this project; Android permissions, application roles, other apps' interfaces and hardware still matter.

“Without APIs” here means **without external service APIs, API keys or a cloud automation subscription**. Android's native APIs, local providers and intents are the right tools. Calendar/contact accounts can still sync through the account apps already installed on the phone. Bob's model processing is not automatically local: returned phone data reaches the paired backend and configured model.

## First implementation: native phone tool

This change adds the `phone` tool, an authenticated source-phone request/result bridge, a native Android module, and a per-workstation **Settings → Phone tools** switch. Grant Android permissions once; routine owner-authorized commands have no extra Bob approval dialog.

For this first release, keep Bob **in the foreground on the conversation that sent the request**. Native phone work is not yet scheduled/background automation. Android may switch to the destination app when a hand-off opens it.

| Action | What it does | What the result actually establishes |
| --- | --- | --- |
| `capabilities` | Inspect implemented actions, support and permissions | Current device availability, not future grants |
| `calendar_list` | List calendars exposed through Android's Calendar Provider | Calendar IDs and access information |
| `calendar_events` | Read a date range, including expanded recurring instances | Bounded, paginated local-provider results |
| `calendar_create` | Insert an event directly | Native provider result, including event ID |
| `calendar_update` | Change an identified, supported event | Native provider update result |
| `calendar_delete` | Delete an identified, supported event | Native provider deletion result |
| `contacts_search` | Find contacts and their exposed phone/email details | Read-only contact results; not an app's private address book |
| `apps_list` | List launcher-visible installed apps | Actual package IDs and app labels, with paging |
| `app_launch` | Launch a specified installed app | Android accepted an app launch, not completion inside that app |
| `alarm_set` | Ask the installed clock to set an alarm | Clock hand-off launched; no universal alarm read-back |
| `timer_set` | Ask the installed clock to start a timer | Clock hand-off launched; receiving app support varies |
| `device_info` | Read basic phone/OS and battery information | A current native snapshot, not private hardware identifiers |
| `volume_set` | Set media/music volume | Native media-volume result; not ringer/DND control |
| `torch_set` | Turn the flashlight on/off, when hardware and permission permit | Native torch request/result; camera contention can prevent it |
| `clipboard_write` | Copy supplied plain text to the phone clipboard | Clipboard was written; not access to other apps' private data |
| `dial` | Open the dialer with a number | A dialer opened; **not** a call placed |
| `sms_compose` | Open a text-message composer | A composer opened; **not** a message sent |
| `share_text` | Open Android's share chooser with supplied text | A chooser opened; recipient/app selection is still interactive |
| `open_settings` | Open a named Android settings page | Settings opened; no silent permission grant |
| `operation_status` | Read a previous operation's backend receipt | Reconciles a result without running the phone action again |

Calendar times use ISO 8601 with an explicit offset and a named time zone. All-day events use midnight UTC boundaries with an **exclusive** end. Initial calendar edits do not provide recurring-series/exception editing. Updates require title/start/end/timeZone and preserve omitted optional allDay, description and location fields; explicit empty description/location strings clear those fields. List and select the right calendar/event IDs before mutations. Account/provider permission and writability can differ.

Requests are scoped to the backend, conversation and authenticated source phone. A durable claim and a native receipt prevent duplicate effects after retries/restarts. A missing acknowledgement, cancellation or timeout is **not** proof that a claimed action failed: inspect its receipt instead of creating a second event/alarm. Stop cannot undo an action already handed to Android. Expired receipts are bounded; retired backend task identities cannot be executed again.

Source tests and Android compilation are separate from physical-device acceptance. Do not treat either as evidence that an OEM clock, calendar provider, permission dialog or torch behaved correctly on a particular phone.

## Next layer: ordinary native app capabilities

These are feasible directions, **not a claim they are all implemented**.

### Calendar, contacts and personal organisation
- Read calendar lists, events, instances, reminders and attendees exposed by providers.
- Add/change/delete events and reminders; support time zones and all-day events properly.
- Add deliberate recurring-series and individual-occurrence editing.
- Detect schedule conflicts and propose available slots using the calendars the owner authorizes.
- Search phone contacts by name, number or email.
- Create/update contacts, groups and contact photos with additional write permission.
- Use contact/calendar pickers when the owner prefers narrow selection over broad provider access.
- Open the relevant contact or event in an installed app.
- Export/share explicitly selected calendar or contact data.

### Apps, navigation and everyday hand-offs
- Launch installed apps and supported deep links/app links.
- Open maps directions, destinations, street views and navigation through supported intents.
- Open web pages, email composers, dialers, SMS composers and share sheets.
- Hand a file/photo/document to an installed viewer or editor.
- Create alarms/timers where a clock implements Android's intents.
- Open app, notification, network, location, accessibility and battery settings.
- Receive shared text/files/URLs from other apps directly into Bob.
- Add shortcuts, widgets, quick-settings tiles and supported assistant invocation.
- Use target-app published shortcuts, providers or AppFunctions where available; there is no universal interface that every app implements.

### Device utilities and media
- Inspect battery/charging status, storage availability, connectivity and permitted system information.
- Read available sensors: orientation, acceleration, light and others actually present.
- Control media volume and flashlight.
- Play/pause/skip exposed media sessions when the necessary session/access rights exist.
- Set app-owned brightness and screen-awake behavior; changing global settings may need special access.
- Capture a photo or video through a camera app, or build an explicit in-app camera.
- Record owner-started audio, transcribe speech, speak replies and manage visible playback/recording sessions.
- Scan barcodes/QR codes with a suitable local implementation.
- Pair/connect supported Bluetooth devices and communicate over allowed Bluetooth/BLE APIs.
- Read/write supported NFC tags while the phone/app is in an appropriate state.
- Discover/control local devices using protocols those devices expose; not every appliance has a local interface.

### Files and local data
- Open/create/edit documents through Android's document picker and persisted grants.
- Read/write app-owned files, export downloads and share selected documents.
- Work with permitted photos/videos/audio through MediaStore or pickers.
- Import/export Bob conversation artifacts and user-selected backups.
- Read clipboard text while Android permits it; background clipboard access is restricted.
- Observe selected content sources with owner authorization, rather than assuming access to every app sandbox.

## Special access: high-value second implementation layer

These require a separate Android settings grant, role, or visible capture session. They do not need a paid cloud automation service.

### Notification access — `NotificationListenerService`
- Read notifications that Android makes available to the listener.
- Observe notification updates/removals; filter by app/category.
- Dismiss eligible notifications.
- Activate exposed notification actions.
- Reply through notifications that expose a supported `RemoteInput` reply action.
- Summarize available notifications and distinguish “notification received” from “full message history read.”
- **Limits:** sensitive content can be redacted; not all notifications have actions/replies; past private inboxes are not magically available. Bob's own reply notifications do not grant access to other apps' notifications.

### Screen interaction — `AccessibilityService`
- Inspect UI nodes/text/descriptions that an app actually exposes.
- Locate and press controls; focus fields, enter text and perform supported actions.
- Scroll and execute supported gestures.
- Open recent apps, Home, Back and other supported global actions.
- Build bounded, interruptible multi-step workflows across installed apps.
- Verify visible results and stop when the screen does not match the expected state.
- **Limits:** custom canvases, WebViews, games and poorly labelled controls can be opaque; layouts change; keyboard/background/lock states matter. Accessibility is not an authentication bypass or a guaranteed full private-app API.

### Capture, usage, roles and settings
- Capture/share the screen through owner-approved MediaProjection sessions and required foreground-service behavior.
- Use accessibility screenshots where Android permits them; secure windows may block capture.
- Add OCR/image understanding for visible screen content using a separately selected implementation/model.
- Read permitted app-usage statistics after Usage Access is granted.
- Manage eligible notifications/DND through notification-policy access.
- Adjust allowed system settings after the relevant special grant.
- Explore default-assistant invocation/context; taking that role does not give universal phone control.
- Explore SMS/call-log/default-dialer roles if requested: runtime permissions, installer allowlisting, roles and OS restrictions can still apply on a sideloaded build.
- Build background location/recording or geofence features only with their own explicit scope, permissions and required visible services; the first phone-tools switch does not enable these.

## Debugging, device ownership and root: a different capability tier

These are optional future architectures, not bundled permissions and not necessary for the first native tool.

- **Shizuku / shell-backed helper:** selected shell-level operations through a separately installed and trusted helper; initial/reboot setup and debugging authorization are real requirements. It is not root and is not universal.
- **ADB / debugging:** shell input, screenshots, package inspection and selected settings/permission operations, subject to shell/OS restrictions. No ADB work is part of this implementation.
- **Device owner / managed-device provisioning:** enterprise policy operations such as managed restrictions, app provisioning or lock policies; often requires dedicated provisioning/reset, not a normal toggle in an existing personal install.
- **Root / system app:** a much wider set of files, package/settings and system operations, with corresponding device risk and compatibility cost. A normal sideloaded APK is not a system app.

## Things a normal Bob APK cannot honestly promise

- Silently grant itself permissions or special access.
- Unlock the phone, bypass biometrics, defeat a banking approval or extract another app's private database.
- Read every WhatsApp/Signal/email message merely because those apps are installed.
- Send a message or complete a purchase merely because a composer/app was opened.
- Read arbitrary app sandboxes, unrestricted identifiers or all secure screen content.
- Universally toggle Wi-Fi/Bluetooth, install apps unattended, change protected settings or change system time on modern Android without the necessary role/privilege.
- Keep executing indefinitely through force-stop, every OEM battery policy and all background-start restrictions.
- Guarantee robust screen automation against arbitrary app redesigns.

## Build order

1. **Native tool foundation:** first table, permissions, phone settings, authenticated requests, results and replay protection.
2. **Notification bridge:** available notification read/dismiss/action/reply with a separate special-access switch.
3. **Accessibility bridge:** inspect/act/gesture with visible state, cancellation and result verification.
4. **Richer native features:** recurring calendars/contact writes, files, media, camera/audio, sensors, Bluetooth/NFC, explicit background jobs.
5. **Optional advanced control:** assistant/AppFunctions integration and separately requested shell/device-owner/root architectures.

Native APIs beat screen driving whenever both can do the job. They are less brittle, easier to verify and do not depend on guessing where a button moved.

## Primary Android references

- [Calendar Provider](https://developer.android.com/identity/providers/calendar-provider)
- [Contacts Provider](https://developer.android.com/identity/providers/contacts-provider)
- [Common intents](https://developer.android.com/guide/components/intents-common)
- [NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- [AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)
- [Media projection](https://developer.android.com/media/grow/media-projection)
- [AppFunctions](https://developer.android.com/ai/appfunctions) — runtime availability/adoption/allowlisting matter, even where its execution permission is normal
- [Shizuku setup](https://shizuku.rikka.app/guide/setup/)
