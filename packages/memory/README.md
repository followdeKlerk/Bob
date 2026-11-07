# Optional long-term memory

Bob can use [Hindsight](https://github.com/vectorize-io/hindsight) to recall useful context and save conversations for later. It is a separate service, not required for ordinary chat, Notes or skills.

## Using memory

Ask Bob to check memory status, recall a topic, turn automatic recall/saving on or off for a conversation, or retry a failed save. **Queued** and **saving** do not mean processing has finished; check for **saved** or an error.

Ordinary owner messages and final replies can be saved. Tool output, hidden reasoning, attachments and helper conversations are not automatically exported. Existing Hermes memories can be recalled read-only; new saves go to Bob's bank.

Add `#nomem` or `#skip` to a message to exclude that turn from automatic memory. The normal chat transcript remains. Turning saving off does not undo data already sent or cancel processing the service has accepted.

## Setup

Run and secure your Hindsight service first. In Bob's backend state directory, create a private `hindsight.json`, for example:

```json
{
  "enabled": true,
  "baseUrl": "http://127.0.0.1:8888",
  "writeBank": "bob",
  "recallBanks": ["bob"],
  "recallTimeoutMs": 10000,
  "requestTimeoutMs": 20000,
  "maxTokens": 1600,
  "budget": "mid"
}
```

Add `"hermes"` to `recallBanks` only if you have that existing bank and want it searched. Use HTTPS for a service outside loopback. Keep this file readable only by the backend account; supply a required service key privately through `BOB_HINDSIGHT_API_KEY`, not chat or Git.

Apply configuration through your deployment's normal backend update process. Ask Bob to check connectivity and, when wanted, verify a small save and recall. A deeper health check can call the memory service's model providers and incur costs.

Bob also preserves validated configuration in its saved backend settings. To disable the service, explicitly set `enabled` to `false`; merely deleting the override file does not disable it. Per-conversation controls are separate.

## Privacy

Memory extraction and recall may use external models even when the database runs locally. Secret redaction is best-effort, not a guarantee. Keep sensitive material out of automatic saving or disable it for that conversation.

Removing the module does not delete the Hindsight database. Settle or cancel active memory work before removing it. Back up service credentials separately and keep them private.
