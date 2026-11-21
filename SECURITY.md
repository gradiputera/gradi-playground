# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue or pull request for them.

Use GitHub private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Include a description of the issue, the affected path or service, and steps to reproduce.

Responses are best effort; this is a personal portfolio project.

## Secrets

This repository must never contain real secrets, credentials, tokens or personal data.

- Only example files with placeholders (for example `.env.example`) are committed.
- Real secrets live in the hosting dashboards (Vercel, Supabase, Grafana Cloud) or in local `.env*` files that are ignored by Git.
- Automated secret scanning (gitleaks) runs in GitHub Actions on every push and pull request.

If you find a committed secret, report it through the channel above. Rotate the secret first; history rewriting is not a substitute for rotation.

## Supported versions

Only the `main` branch is supported.
