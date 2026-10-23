# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.5.x   | :white_check_mark: |
| < 0.5.0 | :x:                |

## Reporting a Vulnerability

The MagDrive project takes the security of its zero-knowledge cryptographic storage, local database, and cloud communication seriously.

If you discover a security vulnerability or cryptographic flaw within MagDrive:

1. **Do not create a public GitHub Issue.**
2. Please report the issue privately using **[GitHub Private Vulnerability Reporting](https://github.com/uragenky/MagDrive/security/advisories/new)** or by emailing the maintainer directly at:
   - **Email**: `ura_genky@yahoo.com`
3. Please include:
   - Type of vulnerability (e.g. key derivation weakness, permission escalation, memory safety, token leakage).
   - Step-by-step reproduction instructions or proof-of-concept (PoC).
   - Impact assessment on encrypted vaults or user data.

## Disclosure Process

- We will acknowledge receipt of your vulnerability report within 48 hours.
- We will coordinate a remediation patch and assign appropriate CVE identifiers if warranted.
- Public disclosure will only occur after a patched release is made available to users.
