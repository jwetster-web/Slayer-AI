# Security and privacy

GLIDE handles personal data: names, addresses, emails, phone numbers and order history. These controls are built in.

## Secrets

- App passwords, OAuth refresh tokens, Discord bot tokens and carrier API keys are encrypted with **AES-256-GCM** under a random 32-byte workspace key.
- The workspace key is sealed with the operating system's credential store through Electron `safeStorage`: Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux.
- If the OS offers no credential store (for example, Linux without a keyring), GLIDE warns in the system log and stores the key unprotected. Install a keyring to avoid this.
- Secrets never leave the main process and worker. The UI only learns whether a secret exists.

## Stored email

- Only messages recognized as retail mail are stored. They are gzip-compressed and, by default, encrypted with the workspace key.
- In the in-app source viewer, emails are shown in a script-free sandboxed frame. The app's CSP blocks remote images, so tracking pixels never load.
- Storing raw emails can be turned off in **Settings → Email & sync**.

## Payment data

CSV imports drop card number, CVV, expiry and similar columns by header. They also drop any column whose values look like card numbers (Luhn-valid, 13–19 digits), whatever the header says. Order tracking never needs payment details, so none are stored.

## Renderer hardening

- `contextIsolation`, `sandbox`, no `nodeIntegration`.
- One validated IPC channel; calls from any other web contents are rejected.
- Strict Content Security Policy: no remote scripts, no remote connections, images only from the app, `data:` and the local `glide-img://` protocol.
- `glide-img://` serves files from the current workspace's image cache only, with a path-traversal check.
- New windows and navigation are blocked; https links open in the system browser.

## Logs and audit

- Parser diagnostics keep **redacted** samples, with emails, street lines, phone numbers, long digit runs and tokens removed.
- System logs never contain passwords, tokens or full addresses.
- Identity changes (merges, splits, assignments, approvals, rejections), settings changes, imports, rollbacks, restores and exports are written to the audit log.

## Discord privacy

Order notifications go only to the private admin channel you configure, or as a DM to the order's own member, identified by stable Discord ID. Tracking numbers and addresses are never included, and nothing per-order is posted to public channels. Cook Export graphics contain no addresses, emails, order numbers or tracking numbers. Masked-name mode hides member names and avatars.

## Data rights

- **Export**: Settings → Data & backups → Export all data (CSV per table, secrets excluded).
- **Forget a member**: the member drawer → Forget member removes identity records. Orders stay in totals but become unassigned.
- **Delete a workspace**: removes its database, images, exports, backups and key from the computer.
- **Backups**: rotating online backups (`VACUUM INTO`), and restore keeps a pre-restore backup.

## Not included

Full-database encryption (SQLCipher) is not included, so order data is a standard SQLite file inside your user profile. Use OS disk encryption (FileVault or BitLocker) for at-rest protection of the whole database.

GLIDE does not scrape retailer accounts, bypass CAPTCHAs or use unofficial retailer APIs. It works from email you authorize and files you import.
