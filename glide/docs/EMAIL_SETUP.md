# Connecting inboxes

GLIDE only ever **reads** mail. Every mailbox is opened read-only (IMAP `EXAMINE`) and bodies are fetched with `BODY.PEEK`, so nothing is marked as read, moved, labeled or deleted.

Only envelopes are downloaded for every message. Full messages are downloaded only when they look like retail mail. Non-retail messages are never stored, apart from a minimal record that keeps the sync from processing them twice.

## Option 1 — IMAP with an app password (any provider)

1. Turn on IMAP in your mail provider's settings.
2. Create an **app password** (Gmail: Google Account → Security → 2-Step Verification → App passwords; iCloud, Yahoo and Fastmail have equivalents).
3. In GLIDE: **Email Accounts → Connect inbox → IMAP / app password**. The server is filled in automatically for common providers.

The password is encrypted with your workspace key, which your operating system's keychain protects.

## Option 2 — Gmail with OAuth

Use this when you prefer not to create app passwords.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. Enable the **Gmail API**.
3. Configure the OAuth consent screen: choose External, and add your Google accounts as **test users**.
4. Create credentials → **OAuth client ID** → application type **Desktop app**.
5. In GLIDE: **Settings → Email & sync → Gmail OAuth client**. Paste the client ID and client secret. (Desktop-app secrets are not confidential.)
6. **Email Accounts → Connect inbox → Gmail (OAuth)** opens your browser. Sign in and approve.

GLIDE requests `https://mail.google.com/`, because that is the scope Google requires for IMAP. The refresh token is stored encrypted.

## Option 3 — Outlook / Microsoft 365 with OAuth

1. In [Microsoft Entra](https://entra.microsoft.com/): App registrations → New registration.
2. Under **Mobile and desktop applications**, add the redirect URI `http://127.0.0.1`.
3. API permissions → add **Office 365 Exchange Online → IMAP.AccessAsUser.All** (delegated) and `offline_access`.
4. Under Authentication, enable **Allow public client flows**.
5. In GLIDE: **Settings → Email & sync → Microsoft client**. Enter the application (client) ID and tenant (`common`, `consumers`, or your tenant ID).
6. **Email Accounts → Connect inbox → Outlook (OAuth)**.

## Forwarding inboxes

Members can forward their order emails to a shared inbox that you connect. GLIDE unwraps Gmail, Outlook and Apple Mail inline forwards and forward-as-attachment. If the same order email arrives directly and through forwards, you still get one order, with every copy listed under *Source messages*.

## Historical import

Use **Email Accounts → Import EML / MBOX** (or **Import folder**) for Google Takeout `.mbox` files, Thunderbird or Outlook exports, or folders of `.eml` files. Imports are idempotent, so running the same file twice adds nothing.

## Backfill and polling

Each inbox has a **backfill** window (days). The first sync scans that period once, and later syncs only fetch new UIDs. The polling interval is set under **Settings → Email & sync**.
