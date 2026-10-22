# Publishing to Chrome and Firefox stores

This guide explains package preparation and store submission. It does not publish the extension. Store policies, account requirements, fees and accepted asset formats can change; confirm the current official requirements when submitting.

## Before distribution

- Use the project’s `GPL-3.0-or-later` license consistently in the repository, source archive and store listing. Include the license text and preserve third-party notices when distributing packages; provide the corresponding source under the applicable license terms.
- Configure public support/privacy contacts and a private vulnerability-reporting channel.
- Validate live Linkwarden integration and the browsers/operating systems advertised in the listing. The current preview has not completed live-server validation.
- Review the final package, source archive and repository for credentials, private addresses, browser profiles, logs and signing keys.
- Ensure the README, privacy policy, permissions and store declarations match the submitted version. Do not advertise unavailable biometric unlocking or unverified browser support.

The project must be identified as independent from Linkwarden. Never supply personal account credentials in public listings, repository files or review materials.

## Build packages

Use Node.js 24 and npm from the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run zip
npm run zip:firefox
```

WXT writes separate Chromium and Firefox ZIPs to `.output`, along with the Firefox review source archive. Check that each package has `manifest.json` at its root, uses Manifest V3, and contains only the required runtime resources. The editable source archive must match the submitted version and include its lockfile and build instructions, without dependencies, secrets or browser profiles. Test reconstruction in a clean directory before submission.

The current Firefox identifier is `linkwarden-sync@linkwarden-sync.local`. Confirm the intended permanent identifier before the first signed release and preserve it for subsequent updates. Build commands do not sign or publish a package.

## Automatic builds on GitHub Actions

The [build workflow](../.github/workflows/build.yml) runs on pull requests, pushes to `main`, new `v*` tag pushes, and manual **Run workflow** requests. It checks types and runs unit tests before building the Chromium and Firefox variants in separate jobs, using Node.js 24 and the lockfile. Both manifests inherit the version from `package.json`; update the root version in `package-lock.json` alongside it. Browser package versions use numeric `major.minor.patch` values. A tag must be exactly `v` followed by that version; a mismatch fails before building.

After a successful run, open **Actions → Build extension packages → the run → Artifacts**. Download the required artifact:

| Artifact | Contents |
| --- | --- |
| `linkwarden-sync-chrome-<version>` | Chromium ZIP and its SHA-256 checksum file. |
| `linkwarden-sync-firefox-<version>` | Unsigned Firefox ZIP and its SHA-256 checksum file. |
| `linkwarden-sync-sources-<version>` | Firefox review source ZIP and its SHA-256 checksum file. |

Artifacts are retained for seven days. Unpack the downloaded artifact to find the extension ZIP. To load it locally, follow the [installation guide](GETTING_STARTED.md); Firefox still requires temporary loading until a signed release is available. The workflow checks archive layout, manifest versions, permissions, translations, license notices and accidental inclusion of common local/generated files. It does not run browser smoke checks or validate a live Linkwarden instance.

Builds need no Linkwarden token, signing key or store credentials. Checks and builds use read-only repository permissions. The workflow disables persisted checkout credentials and package-manager caching, and pins third-party actions to commit hashes. It does not sign extensions or publish to either store. Check the final package and complete the distribution requirements below before store submission.

See GitHub's [artifact documentation](https://docs.github.com/actions/using-workflows/storing-workflow-data-as-artifacts) and [workflow security guidance](https://docs.github.com/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions).

## Publish a GitHub pre-release with a tag

A new version tag push automatically publishes a **GitHub pre-release** after all checks and both browser builds succeed. Releases remain previews and are not marked as the latest stable release. Pull requests, branch pushes and manual workflow runs only build artifacts.

For example, to prepare version `0.1.1` from `0.1.0`:

```sh
npm version patch --no-git-tag-version
```

Review and commit the resulting `package.json` and `package-lock.json` changes together with any release changes, then push that commit. From the same commit, create and push the matching tag (replace `<remote>` with your Git remote name):

```sh
git tag -a v0.1.1 -m "Preview v0.1.1"
git push <remote> v0.1.1
```

The tagged commit must contain this workflow. Tags created before the workflow was added do not trigger it retroactively; pushing an unchanged existing tag does not create a new event. Use a new version for the next release, and do not move or reuse published tags.

The release job downloads the three exact artifacts from its own run. It checks that all six files are present, verifies their checksums and archive contents, and confirms that the remote tag still resolves to the tested commit immediately before publication. That final check cannot prevent someone forcibly moving the tag during publication; keep release tags protected against changes in the repository settings.

Only this final job receives `contents: write`, through GitHub's built-in workflow token. No personal access token is required. It uploads the Chromium ZIP, unsigned Firefox ZIP and review source ZIP, each with its checksum file. Existing releases and drafts for that tag are rejected rather than overwritten. If publication fails, inspect **Actions** and **Releases**, including drafts, before retrying; a failed upload may have left a draft.

Download the six files directly from **Releases → the version → Assets**. Unlike Actions artifacts, release assets are not subject to the workflow's seven-day artifact retention. These packages still require the [local installation steps](GETTING_STARTED.md); a GitHub release does not replace store signing or review. See GitHub's [release documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## Chrome Web Store

1. Register an owner-controlled publishing account in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Follow the current [registration](https://developer.chrome.com/docs/webstore/register) and [account setup](https://developer.chrome.com/docs/webstore/set-up-account) requirements, including account security and any displayed registration fee.
2. Create a new item and upload the Chromium ZIP. Resolve validation errors and inspect the requested permissions.
3. Add the name, summary, full description, category, icons, screenshots and public support/privacy links. The public README can provide the basis for the description, adapted to the submitted version.
4. Complete the privacy and permission declarations. Tokens and selected bookmark URLs are processed and transmitted to the user's instance even without telemetry; do not describe the extension as processing no data.
5. Provide private review instructions and a dedicated HTTPS test instance containing synthetic data. Explain connection setup, password unlocking, host permission and bookmark operations. Supply any necessary test credentials only through official private review fields.
6. Select the intended distribution and submit for review. Confirm publication settings, respond to review requests and verify installation/update through the published listing.

Use the official [package preparation](https://developer.chrome.com/docs/webstore/prepare), [listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [image requirements](https://developer.chrome.com/docs/webstore/images), [privacy declarations](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [publishing](https://developer.chrome.com/docs/webstore/publish) guides. Do not assume README GIFs are accepted as store screenshots.

## Firefox Add-ons

1. Set up an owner-controlled Mozilla Account and developer profile, following the current [publishing instructions](https://extensionworkshop.com/documentation/publish/).
2. Start a [new submission](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/). Choose **On this site** for a public AMO listing; self-distribution has a separate workflow and still requires signing.
3. Upload the Firefox package. Confirm the permanent add-on ID, minimum browser version and [data-consent declarations](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/). The current manifest declares `authenticationInfo` and `browsingActivity`; verify these against the final behavior and validator.
4. Provide editable source and exact reconstruction instructions, including Node/npm versions and the lockfile, according to Mozilla's [source submission requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/).
5. Complete the description, license, privacy policy, support details, icons and screenshots. Explain synthetic media and the same data/permission behavior described in the README.
6. Supply private reviewer instructions and dedicated test-instance access. Submit, address review feedback, and verify the resulting signed package and public listing.

A temporary add-on loaded through `about:debugging` is removed on restart and does not replace signed distribution. See Mozilla's [add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) and [listing guidance](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/).

## Screenshots and demonstrations

The README's GIFs and screenshots use synthetic data in an in-memory UI demonstration. They do not demonstrate production authentication or live server writes. Preserve that disclosure, and capture the actual submitted version for store assets. Verify current store dimensions and formats; a GitHub GIF is not automatically a valid store upload.

Never record real tokens, passwords, private instances, personal library contents, private tabs or notifications. Review every frame and file metadata before sharing.

## Updates

Publish updates under the same store item and extension identity, with a higher version and matching source/package/privacy information. Keep signing and publisher credentials outside the repository and extension packages. Verify the store update path and any changed permission prompts.

Add store download links to the README only after the listings exist and have been checked. See [Chrome updates](https://developer.chrome.com/docs/webstore/update) and [Firefox submissions](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
