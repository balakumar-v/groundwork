"""
Generates physics-chapter.pdf — a short, fictional-but-standard mechanics
chapter used by the AI-tutor eval (see eval/run.ts, EVAL_SET=physics).

It exercises what the tutor must handle: sectioned textbook structure,
formulas the model must find and cite, numerical questions with a known
numeric answer, and topics deliberately NOT covered (Newton's third law,
gravitation, electricity) so the tutor must decline and say what's missing.

Each page carries one section so questions-physics.json's expected pages and
sections are unarguable ground truth.

Run: python3 generate_physics_fixture.py   (needs reportlab)
"""

from reportlab.lib.pagesizes import LETTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

OUTPUT_PATH = "physics-chapter.pdf"

styles = getSampleStyleSheet()
body = styles["BodyText"]
body.spaceAfter = 10

PAGES = [
    (
        "1.1 Newton's Second Law",
        [
            "Newton's second law states that the net force on an object equals its mass multiplied "
            "by its acceleration, F = m * a.",
            "Force is measured in newtons (N). One newton is the force needed to accelerate a mass "
            "of 1 kg at 1 m/s^2.",
        ],
    ),
    (
        "1.2 Equations of Motion",
        [
            "For motion with constant acceleration, the final velocity is v = u + a * t, where u is "
            "the initial velocity, a is the acceleration and t is the time taken.",
            "The distance covered is s = u * t + 0.5 * a * t^2.",
        ],
    ),
    (
        "2.1 Kinetic Energy and Work",
        [
            "The kinetic energy of a moving body is KE = 0.5 * m * v^2, where m is its mass and v "
            "its speed. Energy is measured in joules (J).",
            "Work done by a constant force equals the force times the displacement, W = F * d.",
        ],
    ),
    (
        "2.2 Power",
        [
            "Power is the rate of doing work, P = W / t. It is measured in watts (W).",
            "One watt equals one joule per second. One horsepower is about 746 W.",
        ],
    ),
]


def build():
    doc = SimpleDocTemplate(OUTPUT_PATH, pagesize=LETTER)
    story = [
        Paragraph("Mechanics: Motion, Force and Energy", styles["Title"]),
        Paragraph("(Evaluation fixture for the AI tutor)", body),
    ]
    for heading, paragraphs in PAGES:
        story.append(PageBreak())
        story.append(Paragraph(heading, styles["Heading1"]))
        story.append(Spacer(1, 12))
        for p in paragraphs:
            story.append(Paragraph(p, body))
    doc.build(story)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    build()
