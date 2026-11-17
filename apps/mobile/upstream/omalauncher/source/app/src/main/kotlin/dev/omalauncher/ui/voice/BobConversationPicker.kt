package dev.omalauncher.ui.voice

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.omalauncher.R
import dev.omalauncher.ui.BracketAction
import dev.omalauncher.ui.DialogFrame
import dev.omalauncher.ui.Mono
import dev.omalauncher.ui.Palette
import dev.omalauncher.ui.TextSize
import dev.omalauncher.voice.BobLink
import dev.omalauncher.voice.VoiceSession

/** One bounded metadata page and one scroll surface, including confirmation actions on short windows. */
@Composable
internal fun BobConversationPicker(session: VoiceSession) {
    val state = session.bobPicker
    var confirming by remember { mutableStateOf<BobLink.SessionOption?>(null) }
    val limit = (LocalWindowInfo.current.containerSize.height / LocalDensity.current.density * 0.7f).dp
    DialogFrame(onDismiss = { if (!state.selecting) session.dismissBobPicker() }) {
        Column(Modifier.fillMaxWidth().heightIn(max = limit).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val choice = confirming
            BasicText(stringResource(if (choice == null) R.string.voice_conversation_title else R.string.voice_conversation_confirm_title), style = Mono.copy(fontSize = TextSize.Title))
            when {
                state.menu -> {
                    BasicText(session.bobConversation, style = Mono.copy(color = Palette.muted))
                    BracketAction(stringResource(R.string.voice_conversation_new), Palette.accent) {
                        session.dismissBobPicker()
                        session.startOver()
                    }
                    if (session.canResume) BracketAction(stringResource(R.string.voice_conversation_resume), Palette.accent) {
                        session.dismissBobPicker()
                        session.resume()
                    }
                    BracketAction(stringResource(R.string.voice_conversation_choose), Palette.accent) { session.listBobSessions() }
                }
                state.failed -> {
                    BasicText(stringResource(R.string.voice_conversation_error), style = Mono.copy(color = Palette.red))
                    BracketAction(stringResource(R.string.voice_bob_retry), Palette.accent) {
                        session.dismissBobPicker()
                        session.restartBob()
                    }
                }
                state.loading || state.selecting -> BasicText(stringResource(R.string.voice_conversation_loading), style = Mono.copy(color = Palette.muted))
                choice != null -> {
                    val identity = choice.title + " · " + stringResource(R.string.voice_conversation_selected, choice.id)
                    BasicText(stringResource(R.string.voice_conversation_confirm, identity), style = Mono.copy(color = Palette.muted))
                    BracketAction(stringResource(R.string.files_cancel), Palette.muted) { confirming = null }
                    BracketAction(stringResource(R.string.voice_conversation_use), Palette.accent) {
                        confirming = null
                        session.selectBobSession(choice)
                    }
                }
                else -> {
                    if (state.items.isEmpty()) BasicText(stringResource(R.string.voice_conversation_empty), style = Mono.copy(color = Palette.muted))
                    // At most 100 metadata rows. Avoid nesting a scrolling list inside the dialog scroll surface.
                    for (option in state.items) {
                        Column(Modifier.fillMaxWidth().clickable { confirming = option }.padding(vertical = 8.dp)) {
                            BasicText(option.title, style = Mono.copy(color = Palette.accent))
                            BasicText(stringResource(R.string.voice_conversation_selected, option.id), style = Mono.copy(color = Palette.muted, fontSize = TextSize.Small))
                        }
                    }
                    if (state.next != null) BracketAction(stringResource(R.string.voice_conversation_more), Palette.accent) { session.listBobSessions(older = true) }
                }
            }
            if (!state.selecting) BracketAction(stringResource(R.string.files_cancel), Palette.muted) { session.dismissBobPicker() }
        }
    }
}
