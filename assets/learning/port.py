#!/usr/bin/env python3
"""Reproduce the Bob prompt port without importing or executing upstream Python.

Run with --check to verify the checked-in module; no upstream checkout is needed.
Only literal strings, named string constants, concatenations, and f-string
interpolation of known strings are accepted by the AST evaluator.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "assets/learning"
MARKER = "__BOB_LEARN_REQUEST_INSERTION__"


def evaluate(node, values):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and node.id in values:
        return values[node.id]
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return evaluate(node.left, values) + evaluate(node.right, values)
    if isinstance(node, ast.JoinedStr):
        return "".join(evaluate(part, values) for part in node.values)
    if isinstance(node, ast.FormattedValue) and node.conversion == -1 and node.format_spec is None:
        return evaluate(node.value, values)
    raise ValueError(f"Unsupported AST node: {ast.dump(node)}")


def extract():
    provenance = json.loads((ASSETS / "provenance.json").read_text())
    for name, expected in provenance["files"].items():
        data = (ASSETS / "upstream" / name).read_bytes()
        assert hashlib.sha256(data).hexdigest() == expected["sha256"], name
    review = ast.parse((ASSETS / "upstream/agent/background_review.py").read_text())
    learn = ast.parse((ASSETS / "upstream/agent/learn_prompt.py").read_text())
    curator = ast.parse((ASSETS / "upstream/agent/curator.py").read_text())
    names = {
        "CURATOR_REVIEW_PROMPT",
        "_MEMORY_ROUTING_BLOCK", "_MEMORY_REVIEW_PROMPT", "_LESSON_LAYER_BLOCK",
        "_DO_NOT_CAPTURE_BLOCK", "_SKILL_REVIEW_PROMPT", "_COMBINED_REVIEW_PROMPT",
        "_AUTHORING_STANDARDS", "_KNOWLEDGE_SKILL_STANDARDS", "_SOURCE_HYGIENE",
    }
    values = {}
    for tree in (review, learn, curator):
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = node.targets[0]
                if isinstance(target, ast.Name) and target.id in names:
                    values[target.id] = evaluate(node.value, values)
    assert values.keys() == names
    builder = next(n for n in learn.body if isinstance(n, ast.FunctionDef) and n.name == "build_learn_prompt")
    req_assignment = next(n for n in builder.body if isinstance(n, ast.Assign))
    # The final operand of `(user_request or "").strip() or <literal>` is the default.
    assert isinstance(req_assignment.value, ast.BoolOp) and isinstance(req_assignment.value.op, ast.Or)
    fallback = evaluate(req_assignment.value.values[-1], values)
    result = next(n for n in builder.body if isinstance(n, ast.Return))
    prompt = evaluate(result.value, {**values, "req": MARKER})
    assert prompt.count(MARKER) == 1
    refine = next(n for n in review.body if isinstance(n, ast.FunctionDef) and n.name == "spawn_background_review_thread")
    focus_branch = next(n for n in refine.body if isinstance(n, ast.If) and isinstance(n.test, ast.NamedExpr))
    focus_assignment = focus_branch.body[0]
    focus = evaluate(focus_assignment.value, {"prompt": "__BASE__", "focus": "__FOCUS__"})
    assert focus.startswith("__BASE__") and focus.endswith("__FOCUS__")
    return values, prompt, fallback, focus[len("__BASE__"):-len("__FOCUS__")]


def adapt(text):
    # Ordered, exact substitutions are documented and reviewed as data, not code.
    for item in json.loads((ASSETS / "adaptations.json").read_text()):
        text = text.replace(item["from"], item["to"])
    return text


def literal(text):
    return "`" + text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"


def render():
    values, learn, fallback, focus = extract()
    corpus = "\n".join([*values.values(), learn])
    for item in json.loads((ASSETS / "adaptations.json").read_text()):
        assert item["from"] in corpus, f"Unmatched adaptation: {item['from']}"
        corpus = corpus.replace(item["from"], item["to"])
    result = """/**
 * Learning prompt guidance adapted from MIT-licensed upstream prompts.
 * Attribution, pinned originals, hashes and the reproducible AST-only port live
 * in assets/learning/ and THIRD_PARTY_NOTICES.md. Regenerate: python3 assets/learning/port.py
 *
 * These strings guide model behavior. Native resource tools and LearningWorker
 * documents enforce background fresh-read requirements separately; the host
 * runs the deterministic curator. This module grants no permissions or approvals.
 * Skills and memory are Bob-native resources, not files in an upstream home.
 */

"""
    for name in ("_MEMORY_REVIEW_PROMPT", "_SKILL_REVIEW_PROMPT", "_COMBINED_REVIEW_PROMPT"):
        result += f"export const {name[1:]} = {literal(adapt(values[name]))};\n\n"
    result += f"export const CURATOR_REVIEW_PROMPT = {literal(adapt(values['CURATOR_REVIEW_PROMPT']))};\n\n"
    prefix, suffix = adapt(learn).split(MARKER)
    result += f"const LEARN_PREFIX = {literal(prefix)};\n\n"
    result += f"const LEARN_SUFFIX = {literal(suffix)};\n\n"
    result += f"const DEFAULT_LEARN_REQUEST = {literal(fallback)};\n\n"
    result += """/** Build a normal /learn turn; insert the trimmed request once, without templating it. */
export function buildLearnPrompt(request: string): string {
  const req = request.trim() || DEFAULT_LEARN_REQUEST;
  return LEARN_PREFIX + req + LEARN_SUFFIX;
}

/** Explicit /refine uses the combined review, preserving the upstream focus suffix. */
export function buildRefinePrompt(focus?: string): string {
  const requestedFocus = focus?.trim();
"""
    result += f"  return requestedFocus ? COMBINED_REVIEW_PROMPT + {literal(focus)} + requestedFocus : COMBINED_REVIEW_PROMPT;\n}}\n"
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = ROOT / "src/learning-prompts.ts"
    rendered = render()
    if args.check:
        assert path.read_text() == rendered, f"Stale prompt port: regenerate {path}"
        print("Pinned source hashes, AST extraction and generated prompt module verified.")
    else:
        path.write_text(rendered)
        print(f"Wrote {path}")
