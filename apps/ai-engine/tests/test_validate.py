"""Stage-output validation: semantic hardening against malformed LLM entries.

Real providers (e.g. Groq strict:false JSON mode) can slip non-object entries
into arrays; the semantic pass must flag them, never crash with a 500.
"""

from __future__ import annotations

from app.services.validate import _content_semantics, _plan_semantics

def _hero() -> dict:
    return {
        "id": "hero-1",
        "type": "hero",
        "variant": "split",
        "slots": {"title": "Hi", "primaryCta": {"text": "Go", "link": "/"}},
    }


def test_plan_semantics_rejects_non_dict_sections() -> None:
    data = {
        "sections": [_hero(), "", _hero()],
        "rationale": "test",
    }
    issues = _plan_semantics(data)
    sem010 = [i for i in issues if i["ruleId"] == "SEM-010"]
    assert len(sem010) == 1
    assert "1 non-object" in sem010[0]["message"]
    assert sem010[0]["severity"] == "error"


def test_plan_semantics_counts_multiple_non_dict_entries() -> None:
    data = {
        "sections": ["bad", 123, _hero()],
        "rationale": "test",
    }
    issues = _plan_semantics(data)
    sem010 = [i for i in issues if i["ruleId"] == "SEM-010"]
    assert len(sem010) == 1
    assert "2 non-object" in sem010[0]["message"]


def test_plan_semantics_all_objects_no_sem010() -> None:
    data = {
        "sections": [_hero()],
        "rationale": "test",
    }
    issues = _plan_semantics(data)
    assert not [i for i in issues if i["ruleId"] == "SEM-010"]


def test_content_semantics_rejects_non_dict_entry() -> None:
    data = {
        "sections": [
            {"sectionId": "hero-1", "content": {"title": "Hi"}},
            "bad-string",
        ]
    }
    issues = _content_semantics(data, plan=None, _analysis=None)
    flagged = [i for i in issues if i["ruleId"] == "SCHEMA" and "non-object" in i["message"]]
    assert len(flagged) == 1


def test_content_semantics_rejects_invented_price() -> None:
    data = {
        "sections": [
            {
                "sectionId": "pricing-1",
                "content": {
                    "tiers": [
                        {"name": "Starter", "price": "$29.99"},
                        {"name": "Pro", "price": "[Prix]"},
                    ]
                },
            }
        ]
    }
    issues = _content_semantics(data, plan=None, _analysis=None)
    sem012 = [i for i in issues if i["ruleId"] == "SEM-012"]
    assert len(sem012) == 1
    assert "placeholder" in sem012[0]["message"]


def test_content_semantics_allows_placeholder_prices() -> None:
    data = {
        "sections": [
            {
                "sectionId": "pricing-1",
                "content": {"tiers": [{"name": "Standard", "price": "[Prix]"}]},
            }
        ]
    }
    issues = _content_semantics(data, plan=None, _analysis=None)
    assert not [i for i in issues if i["ruleId"] == "SEM-012"]