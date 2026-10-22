# Privacy policy

Updated on 17 October 2026.

> Applies to the 0.1.0 preview. Store distribution is not available, live Linkwarden integration remains unvalidated, and a public privacy contact has not yet been configured.

## Purpose

The extension browses, saves, and organizes links in a user-selected Linkwarden instance. There is no project-operated intermediary backend. Content stored in Linkwarden remains subject to the instance operator's configuration, permissions, and policies.

## Data processing and destinations

- **Instance URL and API token:** configure and authenticate requests to the instance. These connection values are written to extension local storage only encrypted together with essential cryptographic metadata. Separate non-secret automatic-lock and appearance preferences are also stored locally. Browser-managed installation and permission metadata are separate.
- **Vault password:** used only in memory to protect/unlock the local record; is not stored or sent to Linkwarden or the project owner.
- **Library, collections, tags, and searches:** processed during navigation and sent to the instance where required by the API. No library or search history is written to extension storage.
- **Current page and link fields:** the selected tab's URL/title are obtained only after clicking Add link in the toolbar popup; confirmed fields sent to the instance for saving/editing. Organizing collections also changes server data.
- **Unlocked session:** decrypted URL/token and temporary expiry/identity markers may exist in browser session RAM until locking or process termination. Library content is held only in the open interface’s memory.
- **Automatic-lock preference:** a local `timeout` or `browser` choice, saved only when explicitly changed while unlocked. It contains no credential, library or browsing data, is not synchronized or sent to the server, and is removed by Forget vault. Missing or invalid values default to inactivity locking.
- **Appearance preference:** `uiTheme` stores only `system`, `light` or `dark` after an explicit choice. It is local, not synchronized or sent to Linkwarden, available while locked, and removed by Forget vault. Missing or invalid values follow system appearance. The browser resolves system appearance locally; this does not detect or synchronize the Linkwarden server theme.
- **UI language:** European Portuguese and English are available; language choice stays in UI session memory without a disk preference.
- **Biometric data:** biometric unlocking is not available. This version does not collect fingerprints, biometric templates or other biometric data.

The design excludes analytics, advertising, telemetry, automatic crash reports, and automatic third-party requests for fonts, icons, or previews. This does not eliminate necessary transmission to the chosen instance. Opening a link through a user action visits an external destination under that site's and browser's rules.

Saving a link sends its URL and selected fields to Linkwarden, which may fetch and archive the destination. Changing a URL may delete existing archives. The UI warns about these effects and shared destinations; live Linkwarden integration has not yet been validated. Shared collections may expose links to other members.

## Retention and control

The encrypted connection remains until replacement or Forget vault. Lock removes the unlocked session while retaining the encrypted record. By default, idle expiry is 5 minutes and absolute expiry is 30 minutes; interaction renews idle expiry at most once per 30 seconds. In Security, choosing Until the browser closes disables both limits and retains credentials in session memory until manual/security locking or browser process termination. The automatic-lock preference is remembered without unlocking after restart. Closing all windows may leave the process running. Returning to inactivity mode starts fresh limits. Browser scheduling may delay cleanup, so expiry is also checked before using credentials.

Forget vault removes the encrypted record, RAM session, lock and theme preferences and granted instance origins. Ordinary lock retains origin permission. Firefox permissions cover the chosen HTTPS host across ports; requests remain bound to the configured URL. No biometric material is stored in this version. It cannot guarantee physical erasure of backups or earlier profile copies and does not revoke the token in Linkwarden. Revocation takes place on that server.

To withdraw the extension's authorization, lock/forget the connection and revoke the token in Linkwarden. Deletion of submitted bookmarks or server archives/logs depends on the API, operator, and instance policies. Uninstalling the extension does not delete server data.

## Protection and limits

The extension uses an encrypted vault, HTTPS, restricted permissions and internal messaging, and session locking. There is no guarantee of protection on a compromised computer, absence of swap/hibernation traces, or concealment of the domain in permission/network metadata.

The browser may manage installation metadata, permission grants, alarms, and navigation history. The instance operator may retain logs. The project does not control those layers. See the [security and privacy overview](README.md#security-and-privacy) for the protections and their limits.

## Responsible party and contact

Responsible party/public privacy contact: **to be defined before distribution**. Never send API tokens, passwords, vault files, or a real library in support requests. For vulnerabilities, see [SECURITY.md](SECURITY.md).
