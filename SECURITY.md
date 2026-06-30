# Security Policy / 安全漏洞披露


If you discover a security vulnerability in WindsurfAPI, **please do not open a public GitHub issue**.

Public issues are indexed by search engines and watched by forks — disclosing there exposes every deployed instance before a fix lands.

Instead, report privately via one of:

- GitHub Security Advisories: <https://github.com/dwgx/WindsurfAPI/security/advisories/new> (preferred — encrypted, tracks the fix)
- Email: `dwgx1337@gmail.com` with subject prefix `[WindsurfAPI Security]`

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (PoC appreciated)
- Affected version / commit SHA (check `/health` endpoint)
- Your contact for follow-up

You can expect a first response within **72 hours**. Valid reports will be credited in the release notes (unless you prefer anonymity).

### In scope
- Authentication bypass (dashboard, account pool)
- Account/token/credential leakage
- Remote code execution, SSRF, path traversal
- Injection attacks (XSS, command, prompt)
- Dashboard API vulnerabilities

### Out of scope
- Rate-limit bypass on upstream Windsurf (that's an account-management concern, not a vuln in this proxy)
- Issues requiring physical access to the host
- Findings from automated scanners without demonstrated impact

---

