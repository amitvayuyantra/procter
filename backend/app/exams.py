"""A sample exam. Replace with your own questions (or load from a database)."""

EXAM = {
    "id": "demo",
    "title": "General Knowledge Demo Exam",
    "duration_minutes": 15,
    "questions": [
        {"id": 1, "text": "What is the capital of France?", "options": ["Berlin", "Madrid", "Paris", "Rome"], "answer": 2},
        {"id": 2, "text": "Which planet is known as the Red Planet?", "options": ["Venus", "Mars", "Jupiter", "Saturn"], "answer": 1},
        {"id": 3, "text": "What is 12 x 8?", "options": ["96", "108", "88", "86"], "answer": 0},
        {"id": 4, "text": "Which gas do plants take in from the air?", "options": ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], "answer": 2},
        {"id": 5, "text": "Who wrote 'Romeo and Juliet'?", "options": ["Charles Dickens", "William Shakespeare", "Mark Twain", "Jane Austen"], "answer": 1},
    ],
}


def public_exam() -> dict:
    """The exam without the answers, safe to send to students."""
    return {**EXAM, "questions": [{k: v for k, v in q.items() if k != "answer"} for q in EXAM["questions"]]}


def grade(answers: dict[str, int]) -> tuple[int, int]:
    correct = sum(1 for q in EXAM["questions"] if answers.get(str(q["id"])) == q["answer"])
    return correct, len(EXAM["questions"])
