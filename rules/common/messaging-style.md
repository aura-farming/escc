# Messaging Style

How ESCC writes outbound. Applies to every drafting skill (`cold-outreach`, `outbound-sequences`, `follow-up-ops`, `reply-handling`). Team voice/tone is set by `brand-voice`; this file sets the structural bar that holds regardless of voice.

## Personalization bar
- Every first touch clears a personalization bar: a specific, verifiable reason this message is going to THIS person now (role + trigger + relevance), sourced per `selling-principles` (evidence-first).
- Banned: generic praise ("love what you're doing"), fake familiarity, congratulations on a stale event, and "personalization" that is just a merge field.

## Length & structure
- Cold email: aim for < 120 words, mobile-readable, short sentences and paragraphs. Subject < 50 characters, honest, no clickbait.
- One idea per message. Front-load the relevance; put the ask last.

## One CTA per message
- Exactly **one** clear call to action per outbound touch. No stacked asks, no "or we could also…". The ask is specific and low-friction. "One-CTA-per-outreach" is a default behavior (seed instinct).

## Anti-spam patterns
- Avoid spam-trigger phrasing, ALL CAPS, excessive punctuation, link-heavy bodies, and image-only emails.
- No soft closes ("just checking in", "circling back" with no new value), no manufactured urgency, no guilt.
- Verify merge fields render before sending; a broken `{{first_name}}` is worse than none. `post:outbound-style-check` warns on these.

## Sequences
- Multi-touch cadences carry an unsubscribe + sender-identity block on every commercial step (`outbound-compliance`).
- Each step adds NEW value or a new angle; never re-send the same pitch in different words.
