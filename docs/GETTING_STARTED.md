# Installation and usage

Linkwarden Sync is a preview. Chrome Web Store and Firefox Add-ons downloads are not available yet. You can build the source or download an available GitHub release and load it locally.

## Requirements

- Chromium 140+ or Firefox 140+. Local checks cover Chromium 155 and Firefox 158 on Linux; other browser versions and operating systems have not been verified.
- A Linkwarden instance over HTTPS. The minimum API target is 2.16.3; live integration and later versions still require validation.
- A dedicated Linkwarden API token.
- Node.js 24 and npm to build from source.

The browser must trust the server certificate. HTTP and TLS bypasses are not supported. Instance URLs may include a base path.

## Build from source

From the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run build:firefox
```

`npm ci` restores the pinned dependencies and generates WXT's required local files. The browser builds are written to `.output/chrome-mv3` and `.output/firefox-mv3`; generated files and dependencies are excluded from Git.

## Download a GitHub Actions build

When the project is hosted on GitHub with Actions enabled, successful **Build extension packages** runs provide separate Chromium and Firefox artifacts for seven days. Open the run under **Actions**, download the required artifact and extract it to obtain the extension ZIP and SHA-256 checksum file. Extract that ZIP into a folder, then use the loading instructions below with that folder. These are unsigned test packages; they are not store installations. See [automatic builds](PUBLISHING.md#automatic-builds-on-github-actions) for the artifact names and scope.

## Download a GitHub release

Open the repository's **Releases** page and select an available pre-release. Under **Assets**, download the `chrome.zip` or `firefox.zip` package for your browser and its matching `SHA256SUMS.txt` file. The filenames also include the version. Verify the checksum, then extract the ZIP to a folder and use the loading instructions below, selecting that folder instead of `.output`. Firefox packages are unsigned and require temporary installation. The sources ZIP is for reviewing or rebuilding the extension.

## Load in Chromium

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select `.output/chrome-mv3`.
4. Pin the extension to the toolbar and open its popup.

Edge and Brave have not been separately verified.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `.output/firefox-mv3/manifest.json`.
4. Open the extension from the toolbar.

Firefox removes a temporary installation on restart. A signed release is required for normal distribution.

## Configure your connection

Enter the HTTPS instance URL, API token and a separate vault password of at least 12 characters. Prefer a long, unique passphrase. The extension does not request your Linkwarden account password. Passwords are used exactly as entered, without trimming or normalization.

Unlocking is local. **Allow access and connect** confirms the server, requests its host permission if necessary, and contacts it. A remembered grant may not show another prompt. If the permission prompt closes the popup, reopen it and connect again.

A complete browser restart requires the vault password again, without copying the URL or API token again. If you forget that password, configure the connection again with a valid token; there is no recovery bypass.

## Browse and save links

Open a collection to see its links and immediate subfolders. Use the breadcrumbs to go back, search all links or the current collection, and load more results as needed. Large lists scroll inside the popup.

To save the selected browser tab, choose **Add link** in the toolbar popup. Review its prefilled URL/title, other fields and destination, then choose **Save**. Nothing is saved until confirmation. Internal pages, incognito tabs and unavailable tab access cannot be captured. In the full library page, use the toolbar popup to add a page; existing links can still be edited and organized there.

Review shared destinations before saving. Linkwarden may fetch and archive submitted URLs, and changing a URL may delete its archives. Avoid simultaneous edits in different clients. If a save result is uncertain, check Linkwarden before repeating it.

## Appearance and language

Use the moon icon to open **Appearance**. Choose **Follow system** (default), **Light** or **Dark**. The choice is saved only on this device, applies while locked too, and does not synchronize with Linkwarden.

Choose English or Portuguese (Portugal) from the language selector. Language selection is kept only in the open interface's memory.

## Automatic locking

After unlocking, open **Security**. **After inactivity (recommended)** is the default: 5 minutes without interaction or 30 minutes in total. To disable both time limits, choose **Until the browser closes**, read the warning and press **Save**. This non-secret preference is remembered locally; it never unlocks a restarted browser automatically.

Closing the popup or all browser windows may leave the process and unlocked session running. Manual lock and security-related locking remain active. Returning to inactivity mode starts fresh limits. Browser scheduling can delay cleanup, so expiry is also checked before credentials are used.

## Lock, forget and revoke

**Lock** discards the unlocked session and clears private content from extension views. **Forget vault** also removes the encrypted connection, lock/appearance preferences and granted instance permissions.

Neither action revokes the API token or deletes data in Linkwarden. Revoke an exposed or unwanted token in Linkwarden itself. Read the [security overview](../README.md#security-and-privacy) and [privacy policy](../PRIVACY.md) before using a real account.
