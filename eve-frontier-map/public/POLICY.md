<!-- Mirror of root POLICY.md for static site serving. Keep in sync manually or via future sync script. -->

# Tribe Marks & User-Generated Content Policy (Draft)

(Status note: This is a direct mirror of the repository root `POLICY.md`. If discrepancies arise, the repository version is authoritative until an automated sync is added.)

Status: DRAFT (2025-09-24) – Not yet surfaced in UI. Review before linking from Help Panel.

## 1. Scope
This policy governs short textual content stored in Cloudflare KV generated through the EF-Map interface:
- Tribe marks (shared per tribe): title (≤60 chars) + note (≤160 chars), optional folder association.
- Personal marks are explicitly out-of-scope: they are stored locally in the user’s browser (localStorage) and are not transmitted to EF-Map infrastructure.

## 2. Data Ownership & Visibility
| Data Type | Storage Location | Visibility | Operator Access | Cryptographic Confidentiality |
|----------|------------------|------------|-----------------|-------------------------------|
| Personal mark | Browser localStorage only | Only the creating user (same browser profile) | No | N/A |
| Tribe mark | Cloudflare KV (`tribe_marks_v1/<tribe>.json`) | All authenticated members of the same tribe | Yes | None (plaintext in KV) |

EF-Map (operator) can read tribe mark content. Tribe isolation prevents cross-tribe end-user access but **does not** prevent operator access.

## 3. Current Isolation Model (Wallet-Based Membership)
- Users authenticate by signing a nonce (SIWE‑lite) with their wallet.
- The server derives tribe membership by querying the World API for that wallet address.
- Tribe marks endpoints enforce membership server-side; client cannot self-assert tribe membership.
- A user from Tribe A cannot request Tribe B’s marks unless they control a valid Tribe B wallet.

### Practical Recommendation (Action Item)
Add a Help Panel subsection clarifying:
> Tribe marks are visible only to current members of your tribe. They are not end-to-end encrypted and can be read by site operators. Do not store secrets, personal data, or anything sensitive. Short notes are for tactical in-game context only.

## 4. Content Sanitization (What We Already Do)
`sanitizeText()` currently:
- Strips control characters & collapses whitespace.
- Removes or replaces HTTP/HTTPS URLs with `[link removed]`.
- Removes Discord invite URLs (`discord.gg`, `discord.com`) → `[invite removed]`.
- Applies max length (title 60, note 160 chars).
- Normalizes simple color inputs (`#rrggbb`) for items.

Limitations: Does not filter harassment, hate speech, doxxing, PII, or defamation in plain text.

## 5. Prohibited Content (Draft Wording)
Prohibited in tribe mark titles/notes:
- Illegal content (any jurisdiction where EF-Map is hosted or primarily used).
- Doxxing / personal identifiable info about real individuals (addresses, phone numbers, full names without consent).
- Threats, targeted harassment, or hate speech.
- Sensitive credentials or private keys.
- Copyrighted material pasted verbatim (not expected in 160 chars but included for completeness).

## 6. Reporting & Enforcement (Proposed Minimal Process)
| Step | Action |
|------|--------|
| Report | User submits issue via designated contact (see Contact section) with tribe id + offending mark id/text. |
| Triage | Operator reviews within a reasonable best-effort window (e.g., 72h). |
| Removal | Operator edits/removes offending mark (mutation via existing API). |
| Audit (optional) | Mark id and removal timestamp noted in internal log / decision log entry if severe. |
| Escalation | If clearly illegal (e.g., credible threat), operator preserves snapshot and may notify relevant platform/legal channel. |

## 7. Roadmap – Optional Future Enhancements
| Priority | Feature | Benefit |
|----------|---------|---------|
| Medium | Help Panel “Tribe Data & Privacy” section | Transparency & expectation setting |
| Low | Simple offensive word blocklist | Immediate basic filtering |
| Medium | Author mutation audit buffer (last N operations per tribe) | Abuse forensics |
| High | End-to-end encryption (per-tribe key distribution) | Operator-blind confidentiality |
| Low | Rate limit tribe mutations (e.g., 30 writes / 10 min / address) | Spam mitigation |
| Low | Extended redaction (emails/phone heuristics) | Minimize accidental PII persistence |

## 8. Disclaimer (Draft)
> EF-Map provides collaborative tactical notes for tribes. Notes are short and sanitized, but they are **not** encrypted against the site operator. By using Tribe marks you agree not to store personal, sensitive, or unlawful information. Content violating this policy may be removed and access revoked.

## 9. Proposed Help Panel Snippet (Drop-In Text)
```
### Tribe Marks – Data & Privacy
Tribe marks are a shared tactical layer for your tribe only. They are NOT end‑to‑end encrypted. Site operators can access them. Keep notes short & non-sensitive: no secrets, PII, invites, or harassment. Links & Discord invites are auto-scrubbed. Report abuse via the contact method in this policy.
```

## 10. Contact Options (Avoiding Personal Email)
You asked how to provide a contact without exposing a personal inbox. Options:

| Option | Effort | Pros | Cons |
|--------|--------|------|------|
| Cloudflare Email Routing (alias -> hidden destination) | Low | Use `policy@ef-map.com` or `abuse@ef-map.com`, keep personal addr private | Still forwards to you; must trust routing security |
| Dedicated mailbox (e.g., Proton, Fastmail) | Low | Segregated operational inbox | Small cost |
| Issue tracker label (GitHub Issues) | Very Low | Public transparency | Users need GitHub; sensitive reports public unless using private form |
| Web contact form + serverless email (Workers + Postmark/API) | Medium | Structure + spam control | More code & maintenance |
| Simple `mailto:` plus obfuscated text | Very Low | Minimal | Scraping risk (less severe if alias) |

### Recommended Path
1. Create an alias like `abuse@ef-map.com` or `contact@ef-map.com` via your domain registrar / Cloudflare Email Routing.
2. Forward to a dedicated mailbox (Proton or similar) rather than your personal email.
3. Publish only the alias in the Help Panel & this policy.
4. (Optional) Add a GitHub issue template for “Content Report” linking to this policy for structured submissions.

### If You Want Zero Email Exposure
State: “Report issues via GitHub: https://github.com/<org>/EF-Map/issues (label: content-report). For sensitive legal matters, DM the maintainer on Discord (handle: <placeholder>)”. But note: some users won’t have GitHub/Discord.

## 11. Immediate Action Items (Operator Checklist)
- [ ] Approve wording for Sections 5, 8, 9.
- [ ] Set up `abuse@ef-map.com` (or chosen alias) & test forwarding.
- [ ] Add Help Panel snippet (Section 9) under an appropriate heading.
- [ ] Add a short link: “Full Policy” pointing to `/POLICY.md` (served from repo root) or mirror content into Help Panel.
- [ ] Append decision log entry once published.

## 12. Open Questions (For Later Decision)
| Question | Decision Needed |
|----------|-----------------|
| Retention of removed marks? | Keep ephemeral audit or hard delete? |
| End-to-end encryption priority? | Is operator-blind confidentiality desired? |
| Automated language filtering? | Accept false positives risk? |
| Reporting SLA? | Publicly commit (24h/48h/72h)? |

---
Prepared: 2025-09-24. This file is a draft and not yet binding until explicitly referenced in UI.

