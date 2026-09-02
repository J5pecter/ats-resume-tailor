"""Reading model output without trusting its shape.

`d.get("name", "")` looks safe and is not: the default applies only when the
key is ABSENT. When the key is present holding `null` — which models emit at
least as often as they omit it — you get `None` back, and it travels until
something tries to join or lowercase it.

That is not hypothetical. A run on a real CV died here:

    TypeError: sequence item 0: expected str instance, NoneType found

because the model wrote `{"name": null}` in a projects entry. The guard that
was about to strip a fabricated project crashed instead of stripping it, which
is the worst possible direction for a safety check to fail in.

So every string read from model output goes through `text()`, every list
through `rows()`, every nested object through `mapping()`. Tolerance here is
about SHAPE only. Nothing about what the content is allowed to say is relaxed —
evidence, keywords and retention are enforced exactly as strictly, on values
that are at least the right type.
"""

from __future__ import annotations

from typing import Any


def text(value: Any, default: str = "") -> str:
    """A string, whatever arrived. None, numbers and nulls all become usable."""
    if value is None:
        return default
    if isinstance(value, str):
        return value
    # A model asked for a string sometimes answers with a number — a year, a
    # score, a count. Rendering it is better than dropping the field.
    if isinstance(value, (int, float)):
        return str(value)
    return default


def read(source: Any, key: str, default: str = "") -> str:
    """`text()` applied to a key of a mapping that may not be one.

    Named `read` rather than `field` on purpose: `field` is dataclasses'
    own, and importing a second one shadows it wherever both are used.
    """
    if not isinstance(source, dict):
        return default
    return text(source.get(key), default)


def rows(source: Any, key: str) -> list[Any]:
    """A list of items, skipping anything that is not a mapping.

    A stray string or null inside an array of objects would otherwise reach
    code that assumes `.get` exists on it.
    """
    if not isinstance(source, dict):
        return []
    value = source.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def strings(source: Any, key: str) -> list[str]:
    """A list of strings, coercing members and dropping what cannot be one."""
    if not isinstance(source, dict):
        return []
    value = source.get(key)
    if not isinstance(value, list):
        return []
    return [text(item) for item in value if text(item)]


def mapping(source: Any, key: str) -> dict[str, Any]:
    """A nested object, or an empty one."""
    if not isinstance(source, dict):
        return {}
    value = source.get(key)
    return value if isinstance(value, dict) else {}
