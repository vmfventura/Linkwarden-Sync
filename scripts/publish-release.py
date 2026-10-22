#!/usr/bin/env python3
"""Publish verified packages only from a matching GitHub Actions tag push."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CHECKS = runpy.run_path(str(ROOT / 'scripts/verify-packages.py'))
require = CHECKS['require']


def release_assets(directory, version):
    names = [f'linkwarden-sync-{version}-{kind}.zip' for kind in ('chrome', 'firefox', 'sources')]
    expected = set(names + [f'{Path(name).stem}-SHA256SUMS.txt' for name in names])
    require(directory.is_dir() and not directory.is_symlink(), 'Release asset directory is missing or a symlink.')
    require({path.name for path in directory.iterdir()} == expected, 'Expected exactly three ZIPs and three checksum files.')
    assets = []
    for name, browser in zip(names, ('chrome', 'firefox', None)):
        archive = directory / name
        checksum = directory / f'{archive.stem}-SHA256SUMS.txt'
        require(all(path.is_file() and not path.is_symlink() for path in (archive, checksum)),
                'Release assets must be regular files.')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        require(checksum.read_text() == f'{digest}  {name}\n', 'Release asset checksum does not match.')
        CHECKS['verify_archive'](archive, version, browser)
        assets.extend((archive, checksum))
    return assets


def github_json(repository, endpoint, *options):
    try:
        result = subprocess.run(['gh', 'api', '--hostname', 'github.com', '--method', 'GET',
                                 f'repos/{repository}/{endpoint}', *options],
                                check=True, capture_output=True, text=True, timeout=60)
        return json.loads(result.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise ValueError('Could not read GitHub state; publication was not attempted.') from error


def verify_remote_tag(repository, tag, commit):
    response = github_json(repository, f'git/ref/tags/{tag}')
    require(isinstance(response, dict), 'GitHub returned an invalid tag reference.')
    obj = response.get('object')
    seen = set()
    for _ in range(10):
        require(isinstance(obj, dict), 'GitHub returned an invalid tag reference.')
        sha = obj.get('sha')
        require(isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{40}', sha), 'GitHub returned an invalid object ID.')
        if obj.get('type') == 'commit':
            require(sha == commit, 'The remote tag no longer points to the tested commit.')
            return
        require(obj.get('type') == 'tag' and sha not in seen, 'Invalid or cyclic annotated tag.')
        seen.add(sha)
        response = github_json(repository, f'git/tags/{sha}')
        require(isinstance(response, dict), 'GitHub returned an invalid annotated tag.')
        obj = response.get('object')
    raise ValueError('Too many nested annotated tags.')


def publish(tag, commit, repository, directory, dry_run=False):
    version = CHECKS['metadata'](tag)
    require(re.fullmatch(r'[0-9a-f]{40}', commit), 'Expected the full tested commit SHA.')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repository),
            'Invalid GitHub repository name.')
    assets = release_assets(directory, version)
    if dry_run:
        print(f'Validated {tag}: {len(assets)} assets; no GitHub requests or publication performed.')
        return
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_EVENT_NAME') == 'push'
            and os.environ.get('GITHUB_REF') == f'refs/tags/{tag}'
            and os.environ.get('GITHUB_REPOSITORY') == repository and bool(os.environ.get('GH_TOKEN')),
            'Publication requires the matching GitHub Actions tag-push context and token.')
    pages = github_json(repository, 'releases', '--paginate', '--slurp')
    require(isinstance(pages, list) and all(isinstance(page, list) for page in pages), 'Invalid GitHub release list.')
    require(all(isinstance(release, dict) for page in pages for release in page), 'Invalid GitHub release entry.')
    require(not any(release.get('tag_name') == tag for page in pages for release in page),
            'A release or draft already exists for this tag; refusing to overwrite it.')
    verify_remote_tag(repository, tag, commit)
    command = ['gh', 'release', 'create', tag, *map(str, assets), '--repo', f'github.com/{repository}',
               '--verify-tag', '--target', commit, '--title', f'{tag} — Preview', '--prerelease',
               '--latest=false', '--generate-notes', '--notes',
               'Preview build for Chromium and Firefox. Live Linkwarden integration has not yet been validated. '
               'Firefox packages are unsigned and require temporary installation.']
    try:
        subprocess.run(command, check=True, timeout=180)
    except subprocess.SubprocessError as error:
        raise ValueError('Release command failed; inspect the release or draft on GitHub before retrying.') from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--asset-dir', required=True, type=Path)
    parser.add_argument('--dry-run', action='store_true', help='Validate local files without accessing GitHub.')
    args = parser.parse_args()
    publish(args.tag, args.commit, args.repository, args.asset_dir, args.dry_run)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'Release publication failed: {error}', file=sys.stderr)
        sys.exit(1)
