# Authentic Roleplay — SillyTavern Extension

A SillyTavern extension dedicated to a more immersive and authentic roleplay experience. The first feature is **self-modifying character cards**: the LLM can update a character's card with new events, history, and character evolution as the story unfolds — without ever removing what was already there.

---

## Features

### Self-Modifying Character Cards

As you roleplay, the character card evolves with the story:

- After every N AI responses (configurable), the LLM silently reviews the recent conversation.
- It identifies new canonical information: events that occurred, character growth, changed circumstances, new relationships.
- It appends these additions to the relevant character card fields (`Description`, `Personality`, `Scenario`).
- **Existing content is never removed or rewritten** — only new information is added, under a clearly marked `[Character Evolution Log]` section.

This means your character naturally accumulates history over long campaigns or ongoing stories, and the LLM always has that history available in the character card context.

---

## Installation

### Via SillyTavern Extension Installer (recommended)

1. In SillyTavern, open **Extensions → Install extension**.
2. Paste this repo URL: `https://github.com/Brendan-McKeag/sillytavern-authentic-roleplay`
3. Click Install.

### Manual

```bash
cd /path/to/SillyTavern/public/extensions/third-party
git clone https://github.com/Brendan-McKeag/sillytavern-authentic-roleplay authentic-roleplay
```

Then reload SillyTavern.

---

## Configuration

Open **Extensions → Authentic Roleplay** in the SillyTavern sidebar.

| Setting | Default | Description |
|---|---|---|
| Enable self-modifying character cards | On | Master toggle for the feature |
| Update every N AI messages | 5 | How often a card review is triggered |
| Require confirmation | Off | Prompt you before applying any changes |
| Description / Personality / Scenario | All on | Which card fields can be evolved |
| Analyze last N messages | 20 | How much conversation context the LLM sees |
| Show toast notifications | On | Display a notification when the card is updated |

### Buttons

- **Update Card Now** — immediately trigger a card review for the current chat.
- **View Update History** — see a log of all updates applied to the current character.

---

## How It Works

1. **Trigger**: After every N AI messages, the extension runs in the background.
2. **Prompt**: A specialized system prompt is sent to the LLM with:
   - The current character card (description, personality, scenario)
   - The last N messages of the conversation
3. **Analysis**: The LLM identifies only *new* canonical information not already in the card.
4. **Response**: The LLM returns a JSON object with text to append to each field (or `null` if nothing to add).
5. **Apply**: The extension appends new content under a `[Character Evolution Log]` header, preserving the original card content completely.
6. **Persist**: Changes are saved to the character's `.png` card via SillyTavern's API.

### Example Evolution Log

```
[Original description text here...]

[Character Evolution Log]
— [Jan 15, 2025] After the siege of Ashveil, now bears a scar across her left cheek and carries the broken standard of the Ironveil Company.
— [Jan 22, 2025] Established a hidden camp in the Thornwood, where she leads the surviving soldiers of the Ironveil Company.
```

---

## Planned Features

- **Lorebook/World Info integration** — store evolution history in character book entries instead of (or in addition to) main fields.
- **Group chat support** — track evolution for all participants in a group chat.
- **Manual annotation** — let the user highlight a message and manually trigger "add this to the card."
- **Selective rollback** — view and revert individual evolution log entries.
- **Persona evolution** — apply the same logic to the user's persona card.

---

## Contributing

Issues and PRs are welcome at [github.com/Brendan-McKeag/sillytavern-authentic-roleplay](https://github.com/Brendan-McKeag/sillytavern-authentic-roleplay).

---

## License

MIT
