# Tribe Marks & User-Generated Content Policy

Effective: 2025-09-24

This policy governs short textual tribe mark content stored in EF-Map Cloudflare KV. Personal marks (saved only in your browser) are out of scope and never leave your device.

## 1. What Is Stored
- Tribe mark: title (≤60 chars) + note (≤160 chars) plus optional folder metadata in a single JSON document per tribe: `tribe_marks_v1/<tribe>.json`.
- No end‑to‑end encryption: operator can read stored data. Do not store secrets, personal info, or anything sensitive.

## 2. Visibility & Access
- All current authenticated members of a tribe can read and modify that tribe's marks.
- Cross‑tribe access is blocked server-side via membership verification.
- Operator access: permitted for maintenance, abuse handling, and infrastructure needs.

## 3. Sanitization
Input is normalized to reduce incidental risk:
- Control chars removed; whitespace collapsed.
- HTTP/HTTPS links replaced with `[link removed]`.
- Discord invite links replaced with `[invite removed]`.
- Length limits enforced (title 60, note 160).
Limitations: Does NOT automatically detect harassment, hate speech, PII, or defamation beyond the above transformations.

## 4. Prohibited Content
You must not store in titles or notes:
- Illegal content or instructions facilitating unlawful acts.
- Personal data about real individuals (addresses, phone numbers, emails, full names without consent) or doxxing.
- Threats, targeted harassment, hate or discriminatory slurs.
- Private keys, credentials, access tokens, or other secrets.
- Copyrighted or third‑party confidential material you lack rights to share.

## 5. Enforcement & Reporting
- Report violations: email `abuse@ef-map.com` with tribe id and (if possible) the mark title/note excerpt.
- Review target: best‑effort within 72 hours.
- Actions: edit or removal of offending mark; repeated or severe abuse may lead to tribe mark feature suspension for involved accounts.
- Escalation: Clearly illegal or credible threat content may be preserved for legal/security follow-up.

## 6. Roadmap (Informational)
Planned/considered: basic offensive term filtering, mutation rate limiting, optional per‑tribe encryption, lightweight audit buffer. These future items are not yet active.

## 7. Disclaimer
Tribe marks are a collaborative tactical convenience feature. They are short, sanitized, and not encrypted against the operator. By using them you agree not to store sensitive, personal, or unlawful information. Content that violates this policy may be removed without notice.

## 8. Contact
Primary: `abuse@ef-map.com`
Fallback (public issues – avoid sensitive details): GitHub repository issues page.

---
Archived verbose draft retained at `docs/archive/policy/` for historical context.
