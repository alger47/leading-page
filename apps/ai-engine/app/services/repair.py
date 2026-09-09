"""Local safe repair — deterministic fixes only (PART VI §6.5).

The repair tier NEVER invents content. It fixes mechanical violations:
empty required strings get a branded placeholder, numeric bounds are clamped.
If a fix would require judgment, it is left for the honest-failure path.
"""

from __future__ import annotations

from typing import Any

PLACEHOLDER_FILLER = "[text to complete]"

_REQUIRED_ISSUES = {"required", "minLength"}
_CLAMP_ISSUES = {"minimum", "maximum"}


def apply_local_repair(
    stage: str, data: dict[str, Any], issues: list[dict[str, Any]], schema: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Return (fixed_data, fixed_anything). Only error issues marked fixable act."""
    fixed = _deep_copy(data)
    applied = False

    for issue in issues:
        if issue.get("severity") != "error" or not issue.get("fixable"):
            continue
        validator = issue.get("ruleId")
        # jsonschema issues carry ruleId SCHEMA; message carries the validator keyword.
        if validator != "SCHEMA":
            continue
        path = _path_tokens(issue["path"])
        if not path or path[0] == "$":
            path = path[1:] if path and path[0] == "$" else path
        target = _get_at(fixed, path)
        if target is None:
            continue
        message = issue.get("message", "")

        if isinstance(target, str) and (not target.strip()) and any(k in message for k in _REQUIRED_ISSUES):
            _set_at(fixed, path, PLACEHOLDER_FILLER)
            applied = True
        elif isinstance(target, int):
            new_value = target
            if "below the minimum" in message or "is less than the minimum" in message or "minimum" in message:
                bounds = _schema_minimum(schema, path)
                if bounds is not None and new_value < bounds:
                    _set_at(fixed, path, bounds)
                    applied = True
            if "above the maximum" in message or "is greater than the maximum" in message or "maximum" in message:
                bounds = _schema_maximum(schema, path)
                if bounds is not None and new_value > bounds:
                    _set_at(fixed, path, bounds)
                    applied = True
    return fixed, applied


def _deep_copy(value: Any) -> Any:
    import copy

    return copy.deepcopy(value)


def _path_tokens(path: str) -> list[str]:
    """'$.sections[0].slots.title' -> ['sections','0','slots','title']."""
    tokens: list[str] = []
    for part in path.split("."):
        part = part.replace("$", "", 1).lstrip("$")
        if not part:
            continue
        if "[" in part:
            head, _, idx = part.partition("[")
            idx = idx.rstrip("]")
            if head:
                tokens.append(head)
            tokens.append(idx)
        else:
            tokens.append(part)
    return tokens


def _get_at(doc: Any, path: list[str]) -> Any:
    current = doc
    for token in path:
        if isinstance(current, list):
            try:
                current = current[int(token)]
            except (ValueError, IndexError):
                return None
        elif isinstance(current, dict):
            current = current.get(token)
        else:
            return None
    return current


def _set_at(doc: Any, path: list[str], value: Any) -> None:
    current = doc
    for token in path[:-1]:
        if isinstance(current, dict):
            current = current[token]
        elif isinstance(current, list):
            current = current[int(token)]
        else:
            return
    last = path[-1]
    if isinstance(current, dict) and last in current:
        current[last] = value
    elif (
        isinstance(current, list)
        and last.isdigit()
        and int(last) < len(current)
    ):
        current[int(last)] = value


def _schema_minimum(schema: dict[str, Any], path: list[str]) -> Any:
    node = _schema_at(schema, path)
    if isinstance(node, dict):
        return node.get("minimum")
    return None


def _schema_maximum(schema: dict[str, Any], path: list[str]) -> Any:
    node = _schema_at(schema, path)
    if isinstance(node, dict):
        return node.get("maximum")
    return None


def _schema_at(schema: dict[str, Any], path: list[str]) -> Any:
    node: Any = schema
    # property chain only; array indices map to `items`.
    for token in path:
        if isinstance(node, dict) and "properties" in node and token in node["properties"]:
            node = node["properties"][token]
        elif isinstance(node, dict) and "items" in node and token.isdigit():
            node = node["items"]
        else:
            return None
    return node