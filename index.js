/**
 * Authentic Roleplay - Self-Modifying Character Cards
 *
 * Listens to conversations and periodically asks the LLM to identify new
 * canonical information (events, character growth, changed circumstances)
 * and appends it to the character card. Existing content is never removed.
 *
 * @author Brendan McKeag
 * @license MIT
 */

import {
    getContext,
    extension_settings,
    writeExtensionField,
} from '../../scripts/extensions.js';
import { eventSource, event_types } from '../../scripts/events.js';
import { saveSettingsDebounced } from '../../script.js';
import { POPUP_TYPE, callGenericPopup } from '../../scripts/popup.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXTENSION_NAME = 'authentic-roleplay';

// Inlined because renderExtensionTemplateAsync cannot resolve paths for
// user-installed (third-party) extensions.
const SETTINGS_HTML = `
<div class="authentic-roleplay-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Authentic Roleplay</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="ar-setting-row">
                <label class="ar-label" for="ar-enabled">
                    <input id="ar-enabled" type="checkbox" />
                    Enable Self-Modifying Character Cards
                </label>
                <small class="ar-hint">When enabled, the LLM will automatically update the character card with new events, history, and character evolution from your conversations.</small>
            </div>
            <hr class="sysHR" />
            <div class="ar-setting-group">
                <label class="ar-section-label">Update Trigger</label>
                <div class="ar-setting-row ar-inline">
                    <label for="ar-update-frequency">Update every</label>
                    <input id="ar-update-frequency" type="number" min="1" max="50" step="1" class="text_pole ar-number-input" />
                    <label>AI messages</label>
                </div>
                <small class="ar-hint">How many AI responses to wait before triggering a character card review.</small>
                <div class="ar-setting-row">
                    <label class="ar-label" for="ar-require-confirmation">
                        <input id="ar-require-confirmation" type="checkbox" />
                        Require confirmation before applying updates
                    </label>
                </div>
            </div>
            <hr class="sysHR" />
            <div class="ar-setting-group">
                <label class="ar-section-label">Fields to Update</label>
                <small class="ar-hint">Choose which parts of the character card the LLM can evolve.</small>
                <div class="ar-setting-row">
                    <label class="ar-label" for="ar-update-description">
                        <input id="ar-update-description" type="checkbox" />
                        Description
                    </label>
                </div>
                <div class="ar-setting-row">
                    <label class="ar-label" for="ar-update-personality">
                        <input id="ar-update-personality" type="checkbox" />
                        Personality
                    </label>
                </div>
                <div class="ar-setting-row">
                    <label class="ar-label" for="ar-update-scenario">
                        <input id="ar-update-scenario" type="checkbox" />
                        Scenario
                    </label>
                </div>
            </div>
            <hr class="sysHR" />
            <div class="ar-setting-group">
                <label class="ar-section-label">Context</label>
                <div class="ar-setting-row ar-inline">
                    <label for="ar-context-messages">Analyze last</label>
                    <input id="ar-context-messages" type="number" min="4" max="100" step="1" class="text_pole ar-number-input" />
                    <label>messages</label>
                </div>
                <small class="ar-hint">How many recent messages the LLM reads when deciding what to add to the character card.</small>
            </div>
            <hr class="sysHR" />
            <div class="ar-setting-group">
                <label class="ar-section-label">Notifications</label>
                <div class="ar-setting-row">
                    <label class="ar-label" for="ar-show-notifications">
                        <input id="ar-show-notifications" type="checkbox" />
                        Show toast notification when card is updated
                    </label>
                </div>
            </div>
            <hr class="sysHR" />
            <div class="ar-actions">
                <button id="ar-update-now" class="menu_button" title="Immediately trigger a character card review for the current chat">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    Update Card Now
                </button>
                <button id="ar-view-history" class="menu_button" title="View the history of updates made to the current character's card">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    View Update History
                </button>
            </div>
        </div>
    </div>
</div>`;
const EVOLUTION_SECTION_HEADER = '\n\n[Character Evolution Log]';
const EVOLUTION_ENTRY_PREFIX = '\n— ';

// ─── Default settings ─────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    enabled: true,
    updateFrequency: 5,
    updateDescription: true,
    updatePersonality: true,
    updateScenario: true,
    showNotifications: true,
    requireConfirmation: false,
    maxContextMessages: 20,
};

// ─── Module state ─────────────────────────────────────────────────────────────

let aiMessageCount = 0;
let isUpdating = false;

// ─── Settings helpers ─────────────────────────────────────────────────────────

function getSettings() {
    extension_settings[EXTENSION_NAME] ??= {};
    return Object.assign(
        {},
        DEFAULT_SETTINGS,
        extension_settings[EXTENSION_NAME],
    );
}

function saveSettings(patch) {
    extension_settings[EXTENSION_NAME] = {
        ...getSettings(),
        ...patch,
    };
    saveSettingsDebounced();
}

// ─── Prompt construction ──────────────────────────────────────────────────────

/**
 * Build the system+user prompt that asks the LLM to propose card additions.
 */
function buildUpdatePrompt(character, messages) {
    const settings = getSettings();

    const enabledFields = [
        settings.updateDescription && 'description',
        settings.updatePersonality && 'personality',
        settings.updateScenario && 'scenario',
    ].filter(Boolean);

    const currentCard = `Name: ${character.name}
Description: ${character.description || '(empty)'}
Personality: ${character.personality || '(empty)'}
Scenario: ${character.scenario || '(empty)'}`;

    const transcript = messages
        .map(m => `${m.is_user ? 'User' : character.name}: ${m.mes.replace(/<[^>]+>/g, '').trim()}`)
        .join('\n\n');

    return `You are a character archivist maintaining a permanent record for "${character.name}".
Analyze the conversation below and identify any new canonical information that should be ADDED to the character card.

=== CURRENT CHARACTER CARD ===
${currentCard}

=== RECENT CONVERSATION ===
${transcript}

=== YOUR TASK ===
Find NEW information established in this conversation that is not already captured in the character card. Focus on:
- Significant events that happened (battles, discoveries, decisions, losses)
- Character growth or development revealed through actions or dialogue
- New relationships, alliances, or conflicts formed
- Skills, items, knowledge, or circumstances that changed
- Emotional or psychological shifts that define who the character is becoming

=== STRICT RULES ===
1. ONLY ADD — never remove, rewrite, or contradict existing card content.
2. Only include information ESTABLISHED in this conversation, not speculation.
3. Keep each addition to 1–3 concise sentences.
4. If a field has nothing meaningful to add, use null.
5. Additions must read as natural extensions of the existing text.
6. Do NOT repeat information already in the card.

=== RESPONSE FORMAT ===
Reply ONLY with valid JSON — no markdown fences, no explanation, no other text.
Only include these keys: ${[...enabledFields, 'summary'].join(', ')}

Example:
{
  "description": "After the siege of Ashveil, bears a scar across her left cheek.",
  "personality": null,
  "scenario": "Now leads the remnants of the Ironveil Company from their hidden camp in the Thornwood.",
  "summary": "Survived the siege of Ashveil; now commands the Ironveil survivors"
}`;
}

// ─── Character card update ─────────────────────────────────────────────────────

/**
 * Append new content to a character card field, using an evolution log section
 * so original content is never touched.
 */
function buildUpdatedFieldValue(currentValue, addition, dateLabel) {
    const existing = currentValue || '';

    // Deduplicate: don't add if substantial overlap exists
    if (existing.toLowerCase().includes(addition.toLowerCase().substring(0, 40))) {
        return null;
    }

    const entry = `${EVOLUTION_ENTRY_PREFIX}[${dateLabel}] ${addition.trim()}`;

    if (existing.includes(EVOLUTION_SECTION_HEADER)) {
        // Append to existing evolution log
        return existing + entry;
    }

    // Create the evolution log section
    return existing + EVOLUTION_SECTION_HEADER + entry;
}

/**
 * Apply the LLM-proposed updates to the character card via the ST API.
 */
async function applyUpdates(character, updates) {
    const settings = getSettings();
    const dateLabel = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
    });

    const fieldMap = {
        description: settings.updateDescription,
        personality: settings.updatePersonality,
        scenario: settings.updateScenario,
    };

    let anyChanged = false;

    for (const [field, allowed] of Object.entries(fieldMap)) {
        if (!allowed || !updates[field]) continue;

        const currentValue = character.data?.[field] ?? character[field] ?? '';
        const newValue = buildUpdatedFieldValue(currentValue, updates[field], dateLabel);

        if (newValue === null) {
            console.log(`[${EXTENSION_NAME}] Skipping "${field}" — content appears to already exist.`);
            continue;
        }

        // Update local character object
        if (character.data) character.data[field] = newValue;
        character[field] = newValue;
        anyChanged = true;

        // Persist to server
        const response = await fetch('/api/characters/edit-attribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                avatar: character.avatar,
                field,
                value: newValue,
            }),
        });

        if (!response.ok) {
            console.error(`[${EXTENSION_NAME}] Failed to save field "${field}":`, response.statusText);
        }
    }

    return anyChanged;
}

// ─── Core update pipeline ─────────────────────────────────────────────────────

/**
 * Run the full character card update cycle:
 *   1. Build prompt from current card + recent chat
 *   2. Ask the LLM (quiet, no UI output)
 *   3. Parse JSON response
 *   4. (Optionally) ask user to confirm
 *   5. Apply additive updates
 *   6. Record history in extension data
 */
async function runCharacterCardUpdate() {
    if (isUpdating) return;

    const context = getContext();
    const settings = getSettings();

    // Guard: need a selected character, not a group
    if (context.characterId === undefined || context.characterId === null) return;
    if (context.groupId) return; // Group chats: skip for now

    const character = context.characters[context.characterId];
    if (!character) return;

    const chat = context.chat ?? [];
    if (chat.length < 2) return;

    const recentMessages = chat.slice(-settings.maxContextMessages);

    isUpdating = true;
    console.log(`[${EXTENSION_NAME}] Running character card review for "${character.name}"…`);

    try {
        const prompt = buildUpdatePrompt(character, recentMessages);

        // generateQuietPrompt: background LLM call, no chat history injected
        const rawResponse = await context.generateQuietPrompt(prompt, false, false);

        if (!rawResponse?.trim()) {
            console.log(`[${EXTENSION_NAME}] Empty response from LLM — no update.`);
            return;
        }

        // Strip markdown code fences if the model ignores the instruction
        const jsonText = rawResponse
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();

        let updates;
        try {
            updates = JSON.parse(jsonText);
        } catch (parseErr) {
            console.warn(`[${EXTENSION_NAME}] Could not parse LLM response as JSON:`, parseErr, '\nRaw:', rawResponse);
            return;
        }

        const hasContent = ['description', 'personality', 'scenario'].some(f => updates[f]);
        if (!hasContent) {
            console.log(`[${EXTENSION_NAME}] LLM found nothing new to add — card unchanged.`);
            return;
        }

        if (settings.requireConfirmation) {
            const preview = [
                updates.summary ? `Summary: ${updates.summary}` : null,
                updates.description ? `Description: ${updates.description}` : null,
                updates.personality ? `Personality: ${updates.personality}` : null,
                updates.scenario ? `Scenario: ${updates.scenario}` : null,
            ].filter(Boolean).join('\n\n');

            const confirmed = await callGenericPopup(
                `Apply these updates to ${character.name}'s character card?\n\n${preview}`,
                POPUP_TYPE.CONFIRM,
            );
            if (!confirmed) {
                console.log(`[${EXTENSION_NAME}] Update cancelled by user.`);
                return;
            }
        }

        const changed = await applyUpdates(character, updates);

        if (changed) {
            // Record update in extension field history
            const extData = character.data?.extensions?.[EXTENSION_NAME] ?? {};
            const history = Array.isArray(extData.updateHistory) ? extData.updateHistory : [];
            history.push({
                date: new Date().toISOString(),
                summary: updates.summary ?? '(no summary)',
                chatLength: chat.length,
            });
            await writeExtensionField(context.characterId, EXTENSION_NAME, {
                ...extData,
                updateHistory: history.slice(-100),
            });

            if (settings.showNotifications) {
                const msg = updates.summary
                    ? `Character card updated: ${updates.summary}`
                    : `${character.name}'s character card was updated.`;
                toastr.info(msg, 'Authentic Roleplay', { timeOut: 6000 });
            }

            console.log(`[${EXTENSION_NAME}] Card updated successfully.`);
        }

    } catch (err) {
        console.error(`[${EXTENSION_NAME}] Unexpected error during update:`, err);
    } finally {
        isUpdating = false;
    }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled) return;

    aiMessageCount++;
    if (aiMessageCount >= settings.updateFrequency) {
        aiMessageCount = 0;
        // Run async so we don't block ST's message pipeline
        runCharacterCardUpdate();
    }
}

function onChatChanged() {
    aiMessageCount = 0;
}

// ─── Update history popup ─────────────────────────────────────────────────────

function showUpdateHistory() {
    const context = getContext();
    if (context.characterId === undefined || context.characterId === null) {
        toastr.warning('No character selected.', 'Authentic Roleplay');
        return;
    }

    const character = context.characters[context.characterId];
    const history = character?.data?.extensions?.[EXTENSION_NAME]?.updateHistory ?? [];

    let html;
    if (history.length === 0) {
        html = '<div class="ar-history-empty">No updates recorded yet for this character.</div>';
    } else {
        html = '<div class="ar-history-container">'
            + [...history].reverse().map(entry => `
                <div class="ar-history-entry">
                    <div class="ar-history-date">${new Date(entry.date).toLocaleString()} · after message ${entry.chatLength}</div>
                    <div class="ar-history-summary">${entry.summary}</div>
                </div>`).join('')
            + '</div>';
    }

    callGenericPopup(html, POPUP_TYPE.TEXT, '', { wide: false, allowVerticalScrolling: true });
}

// ─── Settings UI wiring ───────────────────────────────────────────────────────

function syncUIFromSettings() {
    const s = getSettings();
    $('#ar-enabled').prop('checked', s.enabled);
    $('#ar-update-frequency').val(s.updateFrequency);
    $('#ar-require-confirmation').prop('checked', s.requireConfirmation);
    $('#ar-update-description').prop('checked', s.updateDescription);
    $('#ar-update-personality').prop('checked', s.updatePersonality);
    $('#ar-update-scenario').prop('checked', s.updateScenario);
    $('#ar-context-messages').val(s.maxContextMessages);
    $('#ar-show-notifications').prop('checked', s.showNotifications);
}

function wireSettingsUI() {
    $('#ar-enabled').on('change', function () {
        saveSettings({ enabled: $(this).prop('checked') });
    });

    $('#ar-update-frequency').on('input', function () {
        const val = Math.max(1, parseInt($(this).val()) || 5);
        saveSettings({ updateFrequency: val });
    });

    $('#ar-require-confirmation').on('change', function () {
        saveSettings({ requireConfirmation: $(this).prop('checked') });
    });

    $('#ar-update-description').on('change', function () {
        saveSettings({ updateDescription: $(this).prop('checked') });
    });

    $('#ar-update-personality').on('change', function () {
        saveSettings({ updatePersonality: $(this).prop('checked') });
    });

    $('#ar-update-scenario').on('change', function () {
        saveSettings({ updateScenario: $(this).prop('checked') });
    });

    $('#ar-context-messages').on('input', function () {
        const val = Math.max(4, parseInt($(this).val()) || 20);
        saveSettings({ maxContextMessages: val });
    });

    $('#ar-show-notifications').on('change', function () {
        saveSettings({ showNotifications: $(this).prop('checked') });
    });

    $('#ar-update-now').on('click', async function () {
        if (isUpdating) {
            toastr.info('An update is already in progress…', 'Authentic Roleplay');
            return;
        }
        toastr.info('Reviewing conversation for character card updates…', 'Authentic Roleplay');
        await runCharacterCardUpdate();
    });

    $('#ar-view-history').on('click', showUpdateHistory);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

jQuery(async () => {
    // Inject settings panel into ST's Extensions menu
    $('#extensions_settings').append(SETTINGS_HTML);

    // Wire UI controls
    wireSettingsUI();
    syncUIFromSettings();

    // Register event listeners
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.CHAT_LOADED, onChatChanged);

    console.log(`[${EXTENSION_NAME}] Authentic Roleplay extension loaded.`);
});
