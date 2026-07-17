# Repository Privacy and Secret-Safety Rules

This is an open-source repository. Treat every repository artifact as public, including source code, documentation, examples, tests, fixtures, generated files, logs, screenshots, issue and pull-request text, review comments, release notes, and commit messages.

## Mandatory rules

- Never include private or sensitive data in any public artifact. This includes personal names or contact details that are not intentionally public, account identifiers, credentials, API keys, access tokens, passwords, private keys, session cookies, internal URLs, private IP addresses, hostnames, filesystem paths, customer data, and proprietary operational details.
- Information explicitly approved for publication by a maintainer is allowed. This includes the configured Git author name and email address when the maintainer authorizes their use; approval of identity metadata does not authorize unrelated private data.
- Never commit real secrets, even temporarily, in deleted files, examples, tests, fixtures, comments, or Git history.
- Use obvious placeholders such as `YOUR_API_KEY`, `example.com`, or documented environment-variable names. Placeholders must not resemble live credentials.
- Read secrets from environment variables or an approved secret manager. Keep local secret files out of Git and provide only sanitized templates such as `.env.example`.
- Before publishing code, documentation, commits, issues, pull requests, releases, logs, or screenshots, inspect the complete content and metadata for sensitive data.
- When a suspected secret or privacy leak is found, do not copy it into new output. Stop publishing, report it privately to the maintainers, revoke or rotate affected credentials, remove the data from the current tree, and clean Git history when necessary. Deleting it in a later commit is not sufficient.

When uncertain whether information is safe to publish, treat it as private until a maintainer explicitly confirms otherwise.
