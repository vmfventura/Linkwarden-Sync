"""Release safeguards tested without GitHub requests or publication."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch


RELEASE = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/publish-release.py'))
CHECKS = RELEASE['CHECKS']
VERSION = CHECKS['metadata']()
TAG = f'v{VERSION}'
COMMIT = 'a' * 40
REPOSITORY = 'owner/extension'


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.assets = []
        for kind in ('chrome', 'firefox', 'sources'):
            archive = self.directory / f'linkwarden-sync-{VERSION}-{kind}.zip'
            archive.write_bytes(f'synthetic {kind} archive'.encode())
            checksum = self.directory / f'{archive.stem}-SHA256SUMS.txt'
            checksum.write_text(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n')
            self.assets.extend((archive, checksum))
        # Archive internals have their own verifier; exercise it with real builds separately.
        self.archive_check = self.enterContext(patch.dict(CHECKS, {'verify_archive': unittest.mock.Mock()}))
        self.process = self.enterContext(patch.object(RELEASE['subprocess'], 'run'))
        self.process.side_effect = self.github
        self.enterContext(patch.dict(os.environ, {
            'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': f'refs/tags/{TAG}',
            'GITHUB_REPOSITORY': REPOSITORY, 'GH_TOKEN': 'synthetic-test-token',
        }, clear=True))
        self.pages = [[]]
        self.reference = {'object': {'type': 'commit', 'sha': COMMIT}}
        self.annotated = {}

    def github(self, command, **kwargs):
        if command[:3] == ['gh', 'release', 'create']:
            return subprocess.CompletedProcess(command, 0)
        self.assertEqual(command[:6], ['gh', 'api', '--hostname', 'github.com', '--method', 'GET'])
        endpoint = command[6].removeprefix(f'repos/{REPOSITORY}/')
        if endpoint == 'releases':
            self.assertEqual(command[7:], ['--paginate', '--slurp'])
            payload = self.pages
        elif endpoint == f'git/ref/tags/{TAG}':
            payload = self.reference
        else:
            payload = self.annotated[endpoint.removeprefix('git/tags/')]
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(payload))

    def publish(self, **overrides):
        args = dict(tag=TAG, commit=COMMIT, repository=REPOSITORY, directory=self.directory)
        args.update(overrides)
        RELEASE['publish'](**args)

    def assert_no_publication(self):
        self.assertFalse(any(call.args[0][:3] == ['gh', 'release', 'create']
                             for call in self.process.call_args_list))

    def test_exact_tag_matches_package_and_lockfile(self):
        self.assertEqual(CHECKS['metadata'](TAG), VERSION)
        for invalid in ('v9.9.9', VERSION, TAG + '-beta', 'v01.0.0', 'v1.0.0;echo unsafe'):
            if invalid == TAG:
                continue
            with self.subTest(tag=invalid), self.assertRaises(ValueError):
                CHECKS['metadata'](invalid)

    def test_success_uploads_exact_assets_as_prerelease(self):
        self.publish()
        command = self.process.call_args.args[0]
        self.assertEqual(command[:4], ['gh', 'release', 'create', TAG])
        self.assertEqual(command[4:10], list(map(str, self.assets)))
        self.assertIn('--verify-tag', command)
        self.assertIn('--prerelease', command)
        self.assertIn('--latest=false', command)
        self.assertEqual(command[command.index('--target') + 1], COMMIT)
        self.assertNotIn('--clobber', command)
        self.assertNotIn('synthetic-test-token', command)
        self.assertEqual(CHECKS['verify_archive'].call_count, 3)

    def test_dry_run_never_accesses_github(self):
        with patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            self.publish(dry_run=True)
        self.process.assert_not_called()

    def test_missing_extra_and_directory_assets_are_rejected(self):
        path = self.assets[-1]
        data = path.read_bytes()
        path.unlink()
        with self.assertRaises(ValueError):
            self.publish()
        path.write_bytes(data)
        extra = self.directory / 'unexpected.txt'
        extra.write_text('extra')
        with self.assertRaises(ValueError):
            self.publish()
        extra.unlink()
        path.unlink()
        path.mkdir()
        with self.assertRaises(ValueError):
            self.publish()
        self.process.assert_not_called()

    def test_changed_archive_or_checksum_is_rejected(self):
        archive, checksum = self.assets[:2]
        original = archive.read_bytes()
        archive.write_bytes(b'changed')
        with self.assertRaises(ValueError):
            self.publish()
        archive.write_bytes(original)
        checksum.write_text('invalid checksum\n')
        with self.assertRaises(ValueError):
            self.publish()
        self.process.assert_not_called()

    def test_symlink_asset_is_rejected(self):
        archive = self.assets[0]
        target = self.directory.parent / f'{self.directory.name}-outside'
        target.write_bytes(archive.read_bytes())
        self.addCleanup(target.unlink)
        archive.unlink()
        archive.symlink_to(target)
        with self.assertRaises(ValueError):
            self.publish()
        self.process.assert_not_called()

    def test_invalid_archive_is_rejected_before_github(self):
        CHECKS['verify_archive'].side_effect = ValueError('invalid archive')
        with self.assertRaisesRegex(ValueError, 'invalid archive'):
            self.publish()
        self.process.assert_not_called()

    def test_wrong_context_does_not_access_github(self):
        for key, value in (('GITHUB_ACTIONS', 'false'), ('GITHUB_EVENT_NAME', 'workflow_dispatch'),
                           ('GITHUB_REF', 'refs/heads/main'), ('GITHUB_REPOSITORY', 'other/repo'),
                           ('GH_TOKEN', '')):
            with self.subTest(key=key), patch.dict(os.environ, {key: value}), self.assertRaises(ValueError):
                self.publish()
        self.process.assert_not_called()

    def test_invalid_input_does_not_access_github(self):
        for args in ({'tag': TAG + '-rc1'}, {'commit': 'short'}, {'repository': 'owner/../other'}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.publish(**args)
        self.process.assert_not_called()

    def test_existing_release_and_draft_are_not_overwritten(self):
        for draft in (False, True):
            self.pages = [[], [{'tag_name': TAG, 'draft': draft}]]
            with self.subTest(draft=draft), self.assertRaisesRegex(ValueError, 'already exists'):
                self.publish()
        self.assert_no_publication()

    def test_annotated_and_nested_tags_resolve_to_tested_commit(self):
        self.reference = {'object': {'type': 'tag', 'sha': 'b' * 40}}
        self.annotated = {
            'b' * 40: {'object': {'type': 'tag', 'sha': 'c' * 40}},
            'c' * 40: {'object': {'type': 'commit', 'sha': COMMIT}},
        }
        self.publish()
        self.assertEqual(self.process.call_args.args[0][:3], ['gh', 'release', 'create'])

    def test_moved_tag_is_rejected(self):
        self.reference['object']['sha'] = 'd' * 40
        with self.assertRaisesRegex(ValueError, 'tested commit'):
            self.publish()
        self.assert_no_publication()

    def test_cyclic_tag_is_rejected(self):
        self.reference = {'object': {'type': 'tag', 'sha': 'b' * 40}}
        self.annotated = {'b' * 40: self.reference}
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            self.publish()
        self.assert_no_publication()

    def test_malformed_github_responses_are_rejected(self):
        for pages in ({}, [[] , [None]]):
            self.pages = pages
            with self.subTest(pages=pages), self.assertRaises(ValueError):
                self.publish()
        self.pages = [[]]
        for reference in ([], {}, {'object': {'type': 'commit', 'sha': 'invalid'}}):
            self.reference = reference
            with self.subTest(reference=reference), self.assertRaises(ValueError):
                self.publish()
        self.assert_no_publication()

    def test_api_failure_and_invalid_json_stop_publication(self):
        for failure in (subprocess.CalledProcessError(1, ['gh', 'api']),
                        subprocess.TimeoutExpired(['gh', 'api'], 60)):
            self.process.side_effect = failure
            with self.subTest(failure=failure), self.assertRaisesRegex(ValueError, 'not attempted'):
                self.publish()
        self.process.side_effect = None
        self.process.return_value = subprocess.CompletedProcess(['gh'], 0, stdout='invalid JSON')
        with self.assertRaisesRegex(ValueError, 'not attempted'):
            self.publish()
        self.assert_no_publication()

    def test_failed_create_is_not_retried_or_overwritten(self):
        def fail_create(command, **kwargs):
            if command[:3] == ['gh', 'release', 'create']:
                raise subprocess.CalledProcessError(1, command)
            return self.github(command, **kwargs)
        self.process.side_effect = fail_create
        with self.assertRaisesRegex(ValueError, 'inspect the release or draft'):
            self.publish()
        self.assertEqual(sum(call.args[0][:3] == ['gh', 'release', 'create']
                             for call in self.process.call_args_list), 1)


if __name__ == '__main__':
    unittest.main()
