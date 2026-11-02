/**
 * MIT License
 *
 * Copyright (c) 2025 Nous Research
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Strict memory threat scan adapted from Nous Research Hermes Agent at
 * bf0203a794a07aac3ff764972ab9087baa4e4f4e, tools/threat_patterns.py.
 * Pinned originals, hashes, tests and port notes: assets/learning/memory-threats/.
 * This is a write-time heuristic, not a complete prompt-injection detector.
 */

export const MAX_MEMORY_SCAN_CHARS = 65_536;

// All upstream scopes are cumulative in strict mode; preserve upstream order and IDs.
const patterns: readonly (readonly [string, string])[] = [
  ["ignore\\s+(?:\\w+\\s+){0,8}(previous|all|above|prior)\\s+(?:\\w+\\s+){0,8}instructions", "prompt_injection"],
  ["system\\s+prompt\\s+override", "sys_prompt_override"],
  ["disregard\\s+(?:\\w+\\s+){0,8}(your|all|any)\\s+(?:\\w+\\s+){0,8}(instructions|rules|guidelines)", "disregard_rules"],
  ["act\\s+as\\s+(if|though)\\s+(?:\\w+\\s+){0,8}you\\s+(?:\\w+\\s+){0,8}(have\\s+no|don\\'t\\s+have)\\s+(?:\\w+\\s+){0,8}(restrictions|limits|rules)", "bypass_restrictions"],
  ["<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->", "html_comment_injection"],
  ["<\\s*div\\s+style\\s*=\\s*[\"\\'][^>]{0,2048}display\\s*:\\s*none", "hidden_div"],
  ["translate\\s+[^\\n]{0,512}\\s+into\\s+\\w+(?:[\\s-]+\\w+){0,2}\\s+and\\s+(execute|run|eval)\\b", "translate_execute"],
  ["do\\s+not\\s+(?:\\w+\\s+){0,8}tell\\s+(?:\\w+\\s+){0,8}the\\s+user", "deception_hide"],
  ["you\\s+are\\s+(?:\\w+\\s+){0,8}now\\s+(?:a|an|the)\\s+", "role_hijack"],
  ["pretend\\s+(?:\\w+\\s+){0,8}(you\\s+are|to\\s+be)\\s+", "role_pretend"],
  ["output\\s+(?:\\w+\\s+){0,8}(system|initial)\\s+prompt", "leak_system_prompt"],
  ["(respond|answer|reply)\\s+without\\s+(?:\\w+\\s+){0,8}(restrictions|limitations|filters|safety)", "remove_filters"],
  ["you\\s+have\\s+been\\s+(?:\\w+\\s+){0,8}(updated|upgraded|patched)\\s+to", "fake_update"],
  ["\\bname\\s+yourself\\s+\\w+", "identity_override"],
  ["register\\s+(as\\s+)?a?\\s*node", "c2_node_registration"],
  ["(heartbeat|beacon|check[\\s\\-]?in)\\s+(to|with)\\s+", "c2_heartbeat"],
  ["pull\\s+(down\\s+)?(?:new\\s+)?task(?:ing|s)?\\b", "c2_task_pull"],
  ["connect\\s+to\\s+the\\s+network\\b", "c2_network_connect"],
  ["you\\s+must\\s+(?:\\w+\\s+){0,3}(register|connect|report|beacon)\\b", "forced_action"],
  ["only\\s+use\\s+one[\\s\\-]?liners?\\b", "anti_forensic_oneliner"],
  ["never\\s+(?:\\w+\\s+){0,8}(?:create|write)\\s+(?:\\w+\\s+){0,8}(?:script|file)\\s+(?:\\w+\\s+){0,8}disk", "anti_forensic_disk"],
  ["unset\\s+\\w*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC)\\w*", "env_var_unset_agent"],
  ["\\b(?:cobalt\\s*strike|sliver|havoc|mythic|metasploit|brainworm)\\b", "known_c2_framework"],
  ["\\bc2\\s+(?:server|channel|infrastructure|beacon)\\b", "c2_explicit"],
  ["\\bcommand\\s+and\\s+control\\b", "c2_explicit_long"],
  ["curl\\s+[^\\n]{0,2048}\\$\\{?\\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\\b", "exfil_curl"],
  ["wget\\s+[^\\n]{0,2048}\\$\\{?\\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\\b", "exfil_wget"],
  ["cat\\s+[^\\n]{0,2048}(\\.env|credentials|\\.netrc|\\.pgpass|\\.npmrc|\\.pypirc)", "read_secrets"],
  ["(send|post|upload|transmit)\\s+[^\\n]{0,2048}\\s+(to|at)\\s+https?://", "send_to_url"],
  ["(include|output|print|share)\\s+(?:\\w+\\s+){0,8}(conversation|chat\\s+history|previous\\s+messages|full\\s+context|entire\\s+context)", "context_exfil"],
  ["authorized_keys", "ssh_backdoor"],
  ["(?:\\b(?:echo|cat|cp|mv|dd|tee|install|printf|rsync|scp|ln|append|add|write|sed|chmod|chown|truncate|rm|touch|curl|wget|git)\\b|\\bopen\\s*\\(|>>?)[^\\n]{0,512}(?:\\$HOME/\\.ssh|~/\\.ssh)", "ssh_access"],
  ["\\$HOME/\\.hermes/\\.env|\\~/\\.hermes/\\.env", "hermes_env"],
  ["(update|modify|edit|write|change|append|add\\s+to)\\s+[^\\n]{0,2048}(?:AGENTS\\.md|CLAUDE\\.md|\\.cursorrules|\\.clinerules)", "agent_config_mod"],
  ["(update|modify|edit|write|change|append|add\\s+to)\\s+[^\\n]{0,2048}\\.hermes/(config\\.yaml|SOUL\\.md)", "hermes_config_mod"],
  ["(?:api[_-]?key|token|secret|password)\\s*[=:]\\s*[\"\\'](?!(?-i:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)[\"\\'])[A-Za-z0-9+/=_-]{20,}", "hardcoded_secret"],
];

const invisible = new Set(Array.from('\u200b\u200c\u200d\u2060\u2062\u2063\u2064\ufeff\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069'));
// Python's Unicode \w is letters/numbers/underscore, not JS's ASCII-only \w.
// Keep category checks case-sensitive: JS /iu would include combining U+0345
// through its case-fold to Greek iota. Scoped modifiers require Bob's Node 24.
const wordBody = '\\p{L}\\p{N}_';
const word = `(?-i:[${wordBody}])`;
const boundary = `(?:(?<=${word})(?!${word})|(?<!${word})(?=${word}))`;
// Python str.isspace()/re \s includes U+001C..001F and U+0085, but not JS's BOM.
const space = '[\\t-\\r\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
function pythonRegex(source: string) {
  let translated = '', inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '\\') {
      const escaped = source[++i]!;
      if (escaped === 'w') {
        // No pinned pattern has a word token inside a class; refuse future additions
        // rather than accidentally weaken the Python category semantics there.
        if (inClass) throw Error('Unsupported Python word token inside character class');
        translated += word;
      }
      else if (escaped === 's') translated += inClass ? space.slice(1, -1) : space;
      else if (escaped === 'b' && !inClass) translated += boundary;
      // Python accepts these identity escapes; JS Unicode regex rejects them.
      else if (escaped === "'" || escaped === '~') translated += escaped;
      else translated += '\\' + escaped;
    } else {
      if (ch === '[') inClass = true;
      if (ch === ']') inClass = false;
      translated += ch;
    }
  }
  return new RegExp(translated, 'iu');
}
// Preserve the case-sensitive env-name exemption against the original normalized
// value, not the dotted/dotless-I-folded copy used for case-insensitive matching.
const compiled = patterns.filter(([, id]) => id !== 'hardcoded_secret').map(([source, id]) => [pythonRegex(source), id] as const);
const secretAssignment = pythonRegex('(?:api[_-]?key|token|secret|password)\\s*[=:]\\s*["\']');
const secretValue = /^[A-Za-z0-9+/=_-]{20,}/iu;
const envNameValue = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+["']/;
function hasHardcodedSecret(normalized: string, folded: string) {
  const assignments = new RegExp(secretAssignment.source, 'giu');
  for (const match of folded.matchAll(assignments)) {
    const start = match.index + match[0].length;
    if (!envNameValue.test(normalized.slice(start)) && secretValue.test(folded.slice(start))) return true;
  }
  return false;
}

/** Matched strict-scope IDs; scan copies only, never normalize the persisted fact. */
export function scanMemoryThreats(content: string): string[] {
  // Python slices codepoints, not UTF-16 code units. Apply its cap before NFKC.
  const chars: string[] = [];
  for (const ch of content) { if (chars.length === MAX_MEMORY_SCAN_CHARS) break; chars.push(ch); }
  const raw = chars.join('');
  const findings = [...new Set(chars)].filter(ch => invisible.has(ch)).map(ch =>
    `invisible_unicode_U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
  const normalized = raw.normalize('NFKC');
  // Python re.IGNORECASE also folds dotted/dotless I to ASCII i; JS /iu does not.
  // The other special ASCII-range folds (long s and Kelvin sign) are folded by NFKC.
  // This length-preserving substitution keeps secret-value offsets valid.
  const folded = normalized.replace(/[\u0130\u0131]/g, 'i');
  for (const [pattern, id] of compiled) if (pattern.test(folded)) findings.push(id);
  if (hasHardcodedSecret(normalized, folded)) findings.push('hardcoded_secret');
  return findings;
}

/** Same refusal as Hermes _scan_memory_content / first_threat_message(strict). */
export function firstMemoryThreatMessage(content: string): string | undefined {
  const first = scanMemoryThreats(content)[0];
  if (!first) return undefined;
  if (first.startsWith('invisible_unicode_')) return `Blocked: content contains invisible unicode character ${first.slice('invisible_unicode_'.length)} (possible injection).`;
  return `Blocked: content matches threat pattern '${first}'. Content is injected into the system prompt and must not contain injection or exfiltration payloads.`;
}
