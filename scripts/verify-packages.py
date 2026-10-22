#!/usr/bin/env python3
"""Verify distributable archives without extracting them or contacting a server."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
from zipfile import BadZipFile, ZipFile

ROOT = Path(__file__).resolve().parents[1]
NAME = 'linkwarden-sync'
LEGAL_FILES = ('LICENSE', 'THIRD_PARTY_NOTICES.txt')
RUNTIME_ROOT_FILES = {*LEGAL_FILES, 'manifest.json', 'popup.html', 'library.html', 'background.js'}
SOURCE_ROOT_FILES = {*LEGAL_FILES, 'README.md', 'PRIVACY.md', 'SECURITY.md', 'package.json',
                     'package-lock.json', 'tsconfig.json', 'wxt.config.ts', 'vitest.config.ts'}
RUNTIME_DIRS = {'assets', 'chunks', 'icon', '_locales'}
SOURCE_DIRS = {'entrypoints', 'src', 'public', 'tests', 'scripts', 'demo', 'docs'}
GENERATED_DIRS = {'.git', '.wxt', '.output', 'node_modules', 'dist', 'coverage',
                  'test-results', '.profiles', 'artifacts', '__pycache__'}
PRIVATE_SUFFIXES = {'.key', '.pem', '.p12', '.pfx', '.log', '.zip', '.xpi'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def metadata(tag=None):
    package = json.loads((ROOT / 'package.json').read_text())
    locked = json.loads((ROOT / 'package-lock.json').read_text())['packages']['']
    require(package['name'] == locked['name'] == NAME, 'Project names do not match.')
    version = package['version']
    require(isinstance(version, str) and re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version),
            'Use a numeric major.minor.patch package version for browser packages.')
    parts = [int(part) for part in version.split('.')]
    require(any(parts) and all(part <= 65535 for part in parts), 'Version numbers must fit browser manifest limits.')
    require(locked['version'] == version, 'Update the root lockfile version with package.json.')
    require(package['license'] == locked['license'] == 'GPL-3.0-or-later', 'License metadata does not match.')
    if tag is not None:
        require(tag == f'v{version}', 'Tag must be v followed by the exact package.json version.')
    return version


def verify_archive(path, version, browser=None):
    with ZipFile(path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Archive contains duplicate paths.')
        root_files = RUNTIME_ROOT_FILES if browser else SOURCE_ROOT_FILES
        directories = RUNTIME_DIRS if browser else SOURCE_DIRS
        for name in names:
            entry = PurePosixPath(name)
            require(name and not entry.is_absolute() and '\\' not in name and '..' not in entry.parts,
                    'Archive contains an unsafe path.')
            require(not GENERATED_DIRS.intersection(entry.parts), 'Archive contains generated or local files.')
            require(not any(part.startswith('.env') and part != '.env.example' for part in entry.parts),
                    'Archive contains an environment file.')
            require(entry.suffix.lower() not in PRIVATE_SUFFIXES, 'Archive contains a private or generated file type.')
            require(name in root_files or (len(entry.parts) > 1 and entry.parts[0] in directories),
                    'Archive contains an unexpected file.')
        require(root_files.issubset(names), 'Archive is missing required files.')
        require(archive.testzip() is None, 'Archive failed its CRC check.')
        for name in LEGAL_FILES:
            require(archive.read(name) == (ROOT / name).read_bytes(), 'License or third-party notices differ.')
        if browser:
            manifest = json.loads(archive.read('manifest.json'))
            require(manifest['manifest_version'] == 3 and manifest['version'] == version,
                    'Manifest version differs from the project version or is not MV3.')
            require(manifest.get('action', {}).get('default_popup') == 'popup.html', 'Popup entrypoint is missing.')
            require(set(manifest.get('permissions', [])) == {'storage', 'activeTab', 'alarms'},
                    'Review changes to runtime permissions before packaging.')
            require(not manifest.get('host_permissions') and not manifest.get('content_scripts'),
                    'Unexpected installation-time host access or content scripts.')
            require(manifest.get('incognito') == 'not_allowed' and not manifest.get('web_accessible_resources'),
                    'Unexpected incognito access or web-accessible resources.')
            require(manifest.get('optional_host_permissions') == ['https://*/*'], 'Unexpected optional host access.')
            require({'_locales/en/messages.json', '_locales/pt_PT/messages.json'}.issubset(names),
                    'An extension translation is missing.')
            background = manifest.get('background', {})
            if browser == 'chrome':
                require(background.get('service_worker') == 'background.js', 'Chromium worker is missing.')
            else:
                require(background.get('scripts') == ['background.js'] and not background.get('service_worker'),
                        'Firefox background scripts are missing.')
                require(bool(manifest.get('browser_specific_settings', {}).get('gecko', {}).get('id')),
                        'Firefox add-on ID is missing.')
        else:
            package = json.loads(archive.read('package.json'))
            locked = json.loads(archive.read('package-lock.json'))['packages']['']
            require(package['version'] == locked['version'] == version, 'Source versions do not match.')
            require(package['license'] == locked['license'] == 'GPL-3.0-or-later', 'Source licenses do not match.')
            require(any(name.startswith('tests/') for name in names), 'Source archive is missing the regression tests.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('browser', nargs='?', choices=('chrome', 'firefox'))
    parser.add_argument('--print-version', action='store_true')
    parser.add_argument('--tag', help='Require this tag to match the project version.')
    args = parser.parse_args()
    require(bool(args.browser) != args.print_version, 'Choose a browser or --print-version.')
    version = metadata(args.tag)
    if args.print_version:
        print(version)
        return
    output = ROOT / '.output'
    archives = [(output / f'{NAME}-{version}-{args.browser}.zip', args.browser)]
    if args.browser == 'firefox':
        archives.append((output / f'{NAME}-{version}-sources.zip', None))
    # Verify the whole set before writing any checksum files.
    for path, browser in archives:
        verify_archive(path, version, browser)
    for path, _ in archives:
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        path.with_name(f'{path.stem}-SHA256SUMS.txt').write_text(f'{checksum}  {path.name}\n')
        print(f'Verified {path.name}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, BadZipFile) as error:
        print(f'Package verification failed: {error}', file=sys.stderr)
        sys.exit(1)
