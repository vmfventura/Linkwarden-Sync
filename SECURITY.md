# Security policy

## Supported versions

Version 0.1.0 is a preview, with no published store release or independent security audit. There are no maintained public releases yet. The [README](README.md#security-and-privacy) describes the current protections and their limits; the [privacy policy](PRIVACY.md) describes data processing.

## Reporting a vulnerability

**A private reporting channel has not yet been configured.** Do not post vulnerabilities, exploit details or credentials in public issues. A private contact or repository vulnerability-reporting route must be available before public distribution.

When a private channel is available, include the affected extension version, browser/version, operating system, Linkwarden version, reproduction steps and observed impact. Use synthetic data.

Never attach API tokens, vault passwords, encryption keys, browser profiles, vault files, private addresses or real libraries. Sanitize screenshots and traces; an encrypted vault is still sensitive.

## If a credential is exposed

Revoke the token in Linkwarden and generate a replacement. Forgetting the extension's vault, uninstalling it, or deleting a public message does not invalidate that token. If the device is compromised, secure it before entering replacement credentials.

## Disclosure

Reports should be handled privately while the impact is assessed and a fix is prepared. No response-time guarantee or service-level agreement is currently offered.
