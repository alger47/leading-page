"""Deterministic stub content builders.

The stub mimics a perfect model for tests/dev/CI (mini-eval). It derives
structured outputs from stage inputs using local templates only — it never
echoes brief text verbatim, which makes prompt-injection artifacts
structurally impossible (brief is treated strictly as data, PART VI §6.6/8.1).

Anti-hallucination (PART VI §6.8): no phone, address, price, certification,
award, statistic, or founding date is ever invented. Missing facts surface as
branded placeholder slots reported via `placeholders`.
"""

from __future__ import annotations

from typing import Any

LOCALES = ("ar", "fr", "en")

VERTICALS = (
    "restaurant",
    "saas",
    "veterinary",
    "hotel",
    "gym",
    "real-estate",
    "law-firm",
    "medical-clinic",
    "startup",
    "e-commerce",
    "agency",
    "education",
    "other",
)

TONES = ("warm-professional", "cool-modern", "bold-creative", "minimal-clean", "friendly-casual")

VERTICAL_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("restaurant", ("restaurant", "caf", "café", "food", "menu", "dining", "مطعم", "resto")),
    ("saas", ("saas", "software", "platform", "app", "tool", "cloud", "أدوات", "logiciel")),
    ("veterinary", ("vet", "veterinar", "pet", "animal clinic", "طبيب بيطري", "عيادة", "vétérinaire")),
    ("hotel", ("hotel", "lodging", "resort", "فندق", "hôtel")),
    ("gym", ("gym", "fitness", "trainer", "ياقة", "رياضة", "salle de sport")),
    ("real-estate", ("real estate", "property", "agency estate", "عقار", "immobilier")),
    ("law-firm", ("law", "legal", "attorney", "محاماة", "قانون", "avocat")),
    ("medical-clinic", ("medical", "clinic", "doctor", "عيادة طبية", "مستشفى", "clinique médicale")),
    ("startup", ("startup", "seed", "funding", "شركة ناشئة", "start-up")),
    ("e-commerce", ("e-commerce", "ecommerce", "shop", "store", "متجر", "boutique")),
    ("agency", ("agency", "marketing", "studio", "creative", "وكالة", "agence")),
    ("education", ("school", "education", "kursus", "coaching lessons", "مدرسة", "تعلّم", "éducation")),
)

TONE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "warm-professional": ("trust", "care", "warm", "family", "premium", "ثقة", "رعاية"),
    "cool-modern": ("modern", "sleek", "tech", "efficient", "بسيط", "تقني"),
    "bold-creative": ("bold", "creative", "fun", "vibrant", "مبدع"),
    "minimal-clean": ("minimal", "clean", "simple", "fast", "أنيق"),
    "friendly-casual": ("friendly", "casual", "relaxed", "يسر", "décontracté"),
}

SIGNAL_KEYWORDS: dict[str, tuple[str, ...]] = {
    "cta": ("visit", "sign up", "start", "book", "call", "تسجيل", "s\'inscrire"),
    "contact": ("contact", "message", "phone", "call", "تواصل", "contactez"),
    "appointment": ("appointment", "book a", "schedule", "حجز موعد", "rendez-vous"),
    "pricing": ("price", "cost", "pricing", "سعر", "tarif"),
    "testimonial": ("review", "testimonial", "client said", "تقييم", "avis"),
    # These two extend the brief signal vocabulary (Phase 14); they gate the
    # new FAQ and gallery sections so a page only gains structure the brief
    # actually asks for (kept within the golden max_sections bound).
    "faq": ("faq", "frequently asked", "common questions", "سؤال", "أسئلة", "questions fréquentes"),
    "gallery": ("gallery", "photos", "photographs", "album", "صور", "غاليري", "galerie"),
}

VERTICAL_NOUNS: dict[str, dict[str, str]] = {
    "restaurant": {"ar": "مطعمنا", "fr": "notre restaurant", "en": "our restaurant"},
    "saas": {"ar": "منصتنا", "fr": "notre plateforme", "en": "our platform"},
    "veterinary": {"ar": "عيادتنا البيطرية", "fr": "notre clinique vétérinaire", "en": "our veterinary clinic"},
    "hotel": {"ar": "فندقنا", "fr": "notre hôtel", "en": "our hotel"},
    "gym": {"ar": "نادينا", "fr": "notre salle de sport", "en": "our gym"},
    "real-estate": {"ar": "وكالتنا العقارية", "fr": "notre agence immobilière", "en": "our property agency"},
    "law-firm": {"ar": "مكتبنا القانوني", "fr": "notre cabinet d\'avocats", "en": "our law firm"},
    "medical-clinic": {"ar": "عيادتنا الطبية", "fr": "notre clinique médicale", "en": "our medical clinic"},
    "startup": {"ar": "شركتنا الناشئة", "fr": "notre start-up", "en": "our startup"},
    "e-commerce": {"ar": "متجرنا", "fr": "notre boutique", "en": "our store"},
    "agency": {"ar": "وكالتنا", "fr": "notre agence", "en": "our agency"},
    "education": {"ar": "أكاديميتنا", "fr": "notre école", "en": "our school"},
    "other": {"ar": "أعمالنا", "fr": "notre activité", "en": "our business"},
}

GENERIC: dict[str, dict[str, Any]] = {
    "en": {
        "hero_title": "Modern {noun} you can trust",
        "hero_subtitle": "Everything {noun} needs to welcome new customers and grow with confidence.",
        "eyebrow": "Why choose us",
        "features_title": "What we offer",
        "features": [
            {"title": "Simple onboarding", "description": "Getting started takes minutes, not days."},
            {"title": "Focused support", "description": "A small team that answers quickly and honestly."},
            {"title": "Clear next steps", "description": "You always know what happens next."},
        ],
        "cta_title": "Ready to get started with {noun}?",
        "cta_subtitle": "Tell us about your goals and we will prepare a personalized plan.",
        "cta_label": "Get started",
        "cta_secondary": "Learn more",
        "nav_home": "Home",
        "nav_features": "Services",
        "nav_contact": "Contact",
        "brand": "[Business name]",
        "footer_legal": "Legal placeholder — add your company details in the editor.",
        "placeholder_note": "Not provided in the brief — left for the user to complete.",
        "audience_not_stated": "Audience not stated in the brief.",
        "intent_default": "convert visitors into customers",
        "testimonials_eyebrow": "Social proof",
        "testimonials_title": "What customers say",
        "quote_placeholder": "[Customer quote]",
        "name_placeholder": "[Customer name]",
        "role_placeholder": "[Role / company]",
        "pricing_eyebrow": "Pricing",
        "pricing_title": "Simple, honest pricing",
        "plan_name_placeholder": "[Plan name]",
        "price_placeholder": "[Price]",
        "feature_placeholder": "[Benefit or feature]",
        "plan_cta_placeholder": "[Plan CTA]",
        "faq_eyebrow": "FAQ",
        "faq_title": "Frequently asked questions",
        "question_placeholder": "[Question]",
        "answer_placeholder": "[Answer]",
        "gallery_eyebrow": "Gallery",
        "gallery_title": "A look inside",
        "caption_placeholder": "[Caption]",
        "contact_eyebrow": "Contact",
        "contact_title": "Get in touch",
        "contact_subtitle": "Tell us what you need — we answer fast.",
        "hours_placeholder": "[Opening hours]",
    },
    "fr": {
        "hero_title": "{noun} moderne, à votre service",
        "hero_subtitle": "Tout ce dont {noun} a besoin pour accueillir ses clients et se développer sereinement.",
        "eyebrow": "Pourquoi nous choisir",
        "features_title": "Ce que nous proposons",
        "features": [
            {"title": "Prise en main simple", "description": "Commencez en quelques minutes."},
            {"title": "Accompagnement proche", "description": "Une petite équipe qui répond vite et honnêtement."},
            {"title": "Étapes claires", "description": "Vous savez toujours quelle est la suite."},
        ],
        "cta_title": "Prêt à démarrer avec {noun} ?",
        "cta_subtitle": "Décrivez vos objectifs : nous préparerons un plan personnalisé.",
        "cta_label": "Commencer",
        "cta_secondary": "En savoir plus",
        "nav_home": "Accueil",
        "nav_features": "Services",
        "nav_contact": "Contact",
        "brand": "[Nom de l\'entreprise]",
        "footer_legal": "Mention légale à compléter dans l\'éditeur.",
        "placeholder_note": "Absent du brief — à compléter par l\'utilisateur.",
        "audience_not_stated": "Audience non précisée dans le brief.",
        "intent_default": "convertir les visiteurs en clients",
        "testimonials_eyebrow": "Preuves sociales",
        "testimonials_title": "Ce que disent nos clients",
        "quote_placeholder": "[Avis client]",
        "name_placeholder": "[Nom du client]",
        "role_placeholder": "[Poste / entreprise]",
        "pricing_eyebrow": "Tarifs",
        "pricing_title": "Des tarifs simples et honnêtes",
        "plan_name_placeholder": "[Nom de la formule]",
        "price_placeholder": "[Prix]",
        "feature_placeholder": "[Avantage ou prestation]",
        "plan_cta_placeholder": "[Bouton de la formule]",
        "faq_eyebrow": "FAQ",
        "faq_title": "Questions fréquentes",
        "question_placeholder": "[Question]",
        "answer_placeholder": "[Réponse]",
        "gallery_eyebrow": "Galerie",
        "gallery_title": "Un aperçu de nos réalisations",
        "caption_placeholder": "[Légende]",
        "contact_eyebrow": "Contact",
        "contact_title": "Contactez-nous",
        "contact_subtitle": "Décrivez votre besoin : nous répondons vite.",
        "hours_placeholder": "[Horaires d\'ouverture]",
    },
    "ar": {
        "hero_title": "{noun} العصرية التي تستحق ثقتك",
        "hero_subtitle": "كل ما يحتاجه {noun} لاستقبال عملاء جدد والنمو بثقة.",
        "eyebrow": "لماذا تختارنا",
        "features_title": "ماذا نقدم",
        "features": [
            {"title": "بداية سهلة", "description": "تبدأ في دقائق، لا في أيام."},
            {"title": "دعم قريب", "description": "فريق صغير يرد بسرعة وبشفافية."},
            {"title": "خطوات واضحة", "description": "تعرف دائماً ما الخطوة التالية."},
        ],
        "cta_title": "جاهز للبدء مع {noun}؟",
        "cta_subtitle": "أخبرنا بأهدافك وسنعدّ خطة مخصصة لك.",
        "cta_label": "ابدأ الآن",
        "cta_secondary": "اعرف المزيد",
        "nav_home": "الرئيسية",
        "nav_features": "خدماتنا",
        "nav_contact": "تواصل معنا",
        "brand": "[اسم الشركة]",
        "footer_legal": "نص قانوني مؤقت — أكمل بياناتك في المحرر.",
        "placeholder_note": "غير وارد في الطلب — يُترك للمستخدم لاستكماله.",
        "audience_not_stated": "الجمهور غير محدد في الطلب.",
        "intent_default": "تحويل الزوار إلى عملاء",
        "testimonials_eyebrow": "آراء عملائنا",
        "testimonials_title": "ماذا يقول عملاؤنا",
        "quote_placeholder": "[اقتباس العميل]",
        "name_placeholder": "[اسم العميل]",
        "role_placeholder": "[المنصب / الشركة]",
        "pricing_eyebrow": "الأسعار",
        "pricing_title": "أسعار بسيطة وصريحة",
        "plan_name_placeholder": "[اسم الباقة]",
        "price_placeholder": "[السعر]",
        "feature_placeholder": "[ميزة أو خدمة]",
        "plan_cta_placeholder": "[زر الباقة]",
        "faq_eyebrow": "الأسئلة الشائعة",
        "faq_title": "أسئلة متكررة",
        "question_placeholder": "[السؤال]",
        "answer_placeholder": "[الجواب]",
        "gallery_eyebrow": "المعرض",
        "gallery_title": "نظرة على أعمالنا",
        "caption_placeholder": "[التعليق]",
        "contact_eyebrow": "تواصل",
        "contact_title": "تواصل معنا",
        "contact_subtitle": "أخبرنا بما تحتاجه — نرد بسرعة.",
        "hours_placeholder": "[ساعات العمل]",
    },
}

PLAN_TEMPLATES: dict[str, list[dict[str, Any]]] = {
    # Order matters: hero is the first content section (SEM-001), the page ends
    # with a footer (SEM-004). Slots are declared as an object (page_planner
    # schema requires object; SEM-002 requires hero.title among the keys).
    "default": [
        {
            "type": "hero",
            "variant": "split",
            "slots": {"title": "", "subtitle": "", "primaryCta": "", "image": ""},
        },
        {
            "type": "header",
            "variant": "with-cta",
            "slots": {"brandName": "", "nav": "", "navCta": ""},
        },
        {
            "type": "features",
            "variant": "grid-3",
            "slots": {"eyebrow": "", "title": "", "items": ""},
        },
        {
            "type": "cta",
            "variant": "banner",
            "slots": {"title": "", "subtitle": "", "primaryCta": ""},
        },
        {
            "type": "footer",
            "variant": "extended",
            "slots": {"brandName": "", "links": "", "legal": "", "contact": ""},
        },
    ],
}


def detect_vertical(brief: str) -> str:
    lowered = brief.lower()
    for vertical, keywords in VERTICAL_KEYWORDS:
        if any(k in lowered for k in keywords):
            return vertical
    return "other"


def detect_tone(brief: str) -> str:
    lowered = brief.lower()
    for tone, keys in TONE_KEYWORDS.items():
        if any(k in lowered for k in keys):
            return tone
    return "warm-professional"


def detect_signals(brief: str) -> list[str]:
    lowered = brief.lower()
    found: list[str] = []
    for signal, keys in SIGNAL_KEYWORDS.items():
        if any(k in lowered for k in keys):
            found.append(signal)
    return found or ["none"]


def analyze(brief: str, locale: str) -> dict[str, Any]:
    vertical = detect_vertical(brief)
    signals = detect_signals(brief)
    g = GENERIC[locale]
    return {
        "vertical": vertical,
        "audience": g["audience_not_stated"],
        "tone": detect_tone(brief),
        "intent": g["intent_default"],
        "signals": signals,
        "summary": f"{VERTICAL_NOUNS[vertical][locale].capitalize()} described in the brief.",
        "has_enough_facts": False,
    }


def plan(analysis: dict[str, Any]) -> dict[str, Any]:
    """Signal-aware section plan (Phase 14).

    The canonical skeleton stays the 5-section default (header+hero+features+
    cta+footer), keeping golden pages/regression within their bounds and the
    stub regression-calibrated copy unchanged. A section is ADDED only when the
    brief explicitly signals it (pricing/testimonial/faq/gallery/contact
    keywords), so variety is a real intent match, never default boilerplate.
    Ordering is deterministic and anchor-safe (SEM-001 hero first, SEM-004
    footer last) regardless of the signal set.
    """
    vertical = analysis.get("vertical", "other")
    template = PLAN_TEMPLATES.get(vertical, PLAN_TEMPLATES["default"])
    sections: list[dict[str, Any]] = []
    counter: dict[str, int] = {}
    for item in template:
        t = item["type"]
        counter[t] = counter.get(t, 0) + 1
        sections.append(
            {
                "id": f"{t}-{counter[t]}",
                "type": t,
                "variant": item["variant"],
                "slots": dict(item["slots"]),
            }
        )

    signals = set(analysis.get("signals") or [])

    def add_after(anchor: str, item: dict[str, Any]) -> None:
        for idx, sec in enumerate(sections):
            if sec["id"] == anchor:
                sections.insert(idx + 1, item)
                return
        sections.append(item)

    def add_before(anchor: str, item: dict[str, Any]) -> None:
        for idx, sec in enumerate(sections):
            if sec["id"] == anchor:
                sections.insert(idx, item)
                return
        sections.append(item)

    def make(item: dict[str, Any]) -> dict[str, Any]:
        t = item["type"]
        counter[t] = counter.get(t, 0) + 1
        return {"id": f"{t}-{counter[t]}", "type": t, "variant": item["variant"], "slots": dict(item["slots"])}

    if "testimonial" in signals:
        add_after("features-1", make({"type": "testimonials", "variant": "grid-3", "slots": {"eyebrow": "", "title": "", "items": ""}}))
    if "pricing" in signals:
        add_after("features-1", make({"type": "pricing", "variant": "tiers-3", "slots": {"eyebrow": "", "title": "", "tiers": ""}}))
    if "gallery" in signals:
        add_after("features-1", make({"type": "gallery", "variant": "grid-3", "slots": {"eyebrow": "", "title": "", "items": ""}}))
    if "faq" in signals:
        add_before("cta-1", make({"type": "faq", "variant": "accordion", "slots": {"eyebrow": "", "title": "", "items": ""}}))
    if "contact" in signals:
        add_before("footer-1", make({"type": "contact", "variant": "split", "slots": {"eyebrow": "", "title": "", "subtitle": ""}}))
    return {
        "sections": sections,
        "rationale": "Canonical skeleton plus sections the brief explicitly signals.",
    }


def layout(plan_data: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    ordering = [{"sectionId": s["id"], "order": i} for i, s in enumerate(plan_data["sections"])]
    hints: dict[str, Any] = {}
    for s in plan_data["sections"]:
        if s["type"] in ("features", "testimonials", "pricing", "gallery"):
            hints[s["id"]] = {"columns": 3}
    tone = analysis.get("tone", "warm-professional")
    theme = TONE_TO_THEME.get(tone, "warm-professional")
    return {"ordering": ordering, "layoutHints": hints, "theme": theme}


TONE_TO_THEME: dict[str, str] = {
    "warm-professional": "warm-professional",
    "cool-modern": "cool-modern",
    "bold-creative": "bold-creative",
    "minimal-clean": "minimal-clean",
    "friendly-casual": "warm-professional",
}


def content(plan_data: dict[str, Any], locale: str, tone: str, analysis: dict[str, Any]) -> dict[str, Any]:
    g = GENERIC[locale]
    vertical = analysis.get("vertical", "other")
    noun = VERTICAL_NOUNS[vertical][locale]
    sections: list[dict[str, Any]] = []
    placeholders: list[dict[str, Any]] = []

    hero_id = _first_of_type(plan_data, "hero")
    cta_id = _first_of_type(plan_data, "cta")
    features_id = _first_of_type(plan_data, "features")
    nav_labels = _nav_labels(plan_data, g)

    for sec in plan_data["sections"]:
        sec_id = sec["id"]
        t = sec["type"]
        if t == "header":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "brandName": g["brand"],
                        "nav": [{"label": lab, "href": f"#{target}"} for lab, target in nav_labels],
                        "navCta": {"label": g["cta_label"], "href": f"#{cta_id}"} if cta_id else None,
                    },
                }
            )
        elif t == "hero":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "title": g["hero_title"].format(noun=noun),
                        "subtitle": g["hero_subtitle"].format(noun=noun),
                        "primaryCta": {"label": g["cta_label"], "href": f"#{cta_id}"} if cta_id else None,
                        "secondaryCta": {"label": g["cta_secondary"], "href": f"#{features_id}"}
                        if features_id
                        else None,
                        "image": {"assetRef": f"asset:hero-{vertical}", "alt": noun},
                    },
                }
            )
        elif t == "features":
            items = [{"title": i["title"], "description": i["description"]} for i in g["features"]]
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {"eyebrow": g["eyebrow"], "title": g["features_title"], "items": items},
                }
            )
        elif t == "testimonials":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "eyebrow": g["testimonials_eyebrow"],
                        "title": g["testimonials_title"],
                        "items": [
                            {"quote": g["quote_placeholder"], "name": g["name_placeholder"], "role": g["role_placeholder"]}
                            for _ in range(3)
                        ],
                    },
                }
            )
            placeholders.append({"sectionId": sec_id, "slot": "items[].quote/name/role", "note": g["placeholder_note"]})
        elif t == "pricing":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "eyebrow": g["pricing_eyebrow"],
                        "title": g["pricing_title"],
                        "tiers": [
                            {
                                "name": g["plan_name_placeholder"],
                                "price": g["price_placeholder"],
                                "features": [g["feature_placeholder"] for _ in range(3)],
                                "highlight": idx == 1,
                                "cta": {"label": g["plan_cta_placeholder"], "href": f"#{cta_id}"} if cta_id else None,
                            }
                            for idx in range(3)
                        ],
                    },
                }
            )
            placeholders.append({"sectionId": sec_id, "slot": "tiers[].name/price/features", "note": g["placeholder_note"]})
        elif t == "faq":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "eyebrow": g["faq_eyebrow"],
                        "title": g["faq_title"],
                        "items": [
                            {"question": g["question_placeholder"], "answer": g["answer_placeholder"]} for _ in range(4)
                        ],
                    },
                }
            )
            placeholders.append({"sectionId": sec_id, "slot": "items[].question/answer", "note": g["placeholder_note"]})
        elif t == "gallery":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "eyebrow": g["gallery_eyebrow"],
                        "title": g["gallery_title"],
                        "items": [
                            {
                                "image": {"assetRef": f"asset:gallery-{vertical}-{idx}", "alt": noun},
                                "caption": g["caption_placeholder"],
                            }
                            for idx in range(1, 5)
                        ],
                    },
                }
            )
            placeholders.append({"sectionId": sec_id, "slot": "items[].caption", "note": g["placeholder_note"]})
        elif t == "contact":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "eyebrow": g["contact_eyebrow"],
                        "title": g["contact_title"],
                        "subtitle": g["contact_subtitle"],
                        "phone": "[Phone]",
                        "email": "[Email]",
                        "address": "[Address]",
                        "hours": g["hours_placeholder"],
                    },
                }
            )
            placeholders.append({"sectionId": sec_id, "slot": "phone/email/address/hours", "note": g["placeholder_note"]})
        elif t == "cta":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "title": g["cta_title"].format(noun=noun),
                        "subtitle": g["cta_subtitle"].format(noun=noun),
                        "primaryCta": {"label": g["cta_label"], "href": f"#{cta_id}"} if cta_id else None,
                    },
                }
            )
        elif t == "footer":
            sections.append(
                {
                    "sectionId": sec_id,
                    "content": {
                        "brandName": g["brand"],
                        "links": [{"label": lab, "href": f"#{target}"} for lab, target in nav_labels],
                        "legal": g["footer_legal"],
                        "contact": {
                            "phone": "[Phone]",
                            "email": "[Email]",
                            "address": "[Address]",
                        },
                    },
                }
            )

    placeholders.append({"sectionId": hero_id or "", "slot": "contact/phone/address", "note": g["placeholder_note"]})
    return {"sections": sections, "placeholders": placeholders}


def assets(plan_data: dict[str, Any]) -> dict[str, Any]:
    requirements: list[dict[str, Any]] = []
    for sec in plan_data["sections"]:
        if sec["type"] in ("hero", "features", "gallery"):
            requirements.append(
                {
                    "id": sec["id"],
                    "kind": "image",
                    "subject": f"{sec['type']} visual for the page section",
                    "orientation": "landscape",
                    "constraints": {"tone": "neutral, professional"},
                }
            )
    return {"requirements": requirements}


def _first_of_type(plan_data: dict[str, Any], t: str) -> str | None:
    for s in plan_data["sections"]:
        if s["type"] == t:
            return s["id"]
    return None


def _nav_labels(plan_data: dict[str, Any], g: dict[str, Any]) -> list[tuple[str, str]]:
    hero = _first_of_type(plan_data, "hero")
    features = _first_of_type(plan_data, "features")
    cta = _first_of_type(plan_data, "cta")
    contact = _first_of_type(plan_data, "contact")
    faq = _first_of_type(plan_data, "faq")
    labels: list[tuple[str, str]] = [(g["nav_home"], hero or "")] if hero else []
    if features:
        labels.append((g["nav_features"], features))
    if faq:
        labels.append((g["faq_eyebrow"], faq))
    if contact:
        labels.append((g["nav_contact"], contact))
    elif cta:
        labels.append((g["nav_contact"], cta))
    return labels