"""Interview templates. Add or edit roles here (or load them from a database later)."""

TEMPLATES = {
    "software-engineer": {
        "title": "Software Engineer - Screening Interview",
        "duration_minutes": 30,
        "questions": [
            "Describe a difficult bug you fixed. How did you find the cause, and what did you change?",
            "Explain the difference between a process and a thread, in your own words.",
            "You are asked to make a slow web page faster. Walk us through how you would approach it.",
            "Tell us about a time you disagreed with a teammate on a technical decision. What happened?",
        ],
    },
    "sales": {
        "title": "Sales Executive - Screening Interview",
        "duration_minutes": 25,
        "questions": [
            "Tell us about the biggest deal you closed. What made it work?",
            "A customer says your price is too high. How do you respond?",
            "How do you decide which leads to spend your time on?",
            "Describe a time you lost a deal. What did you learn?",
        ],
    },
    "general": {
        "title": "General Screening Interview",
        "duration_minutes": 20,
        "questions": [
            "Why are you interested in this role and our company?",
            "Describe a project you are proud of and your part in it.",
            "Tell us about a time you handled a tight deadline.",
            "Where do you want to be in three years?",
        ],
    },
}


def get_template(key: str) -> dict | None:
    t = TEMPLATES.get(key)
    if not t:
        return None
    return {**t, "key": key, "questions": [{"id": i + 1, "text": q} for i, q in enumerate(t["questions"])]}


def list_templates() -> list[dict]:
    return [{"key": k, "title": v["title"]} for k, v in TEMPLATES.items()]
