"""Regression checks for the evidence gate itself, not for BrandGuard."""
import copy
import tempfile
import unittest
from pathlib import Path
from verify_plan import check_plan, check_release


class EvidenceGateTests(unittest.TestCase):
    def setUp(self):
        self.requirements = [dict(id='R01', owner='Sanath', source='PS', requirement='Review', evidence='Report', tests=['T01'])]
        self.cases = [dict(id='T01', owner='Surya', setup='Draft', action='Review', expected='Evidence')]
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        artifact = self.root / 'verification/evidence/result.txt'
        artifact.parent.mkdir(parents=True)
        artifact.write_text('Synthetic verifier-test fixture; not product evidence.')
        self.release = dict(tested_commit='a' * 40, deployed_url='https://demo.test.invalid',
                            repository_url='https://github.com/team/repo',
                            tests={'T01': dict(status='pass', commit='a' * 40,
                                               executed_at='2026-10-22T12:00:00Z', artifact='verification/evidence/result.txt')},
                            requirements={'R01': dict(status='complete', artifact='verification/evidence/result.txt')})

    def check(self, release):
        return check_release(release, self.requirements, self.cases, self.root)

    def test_valid_inventory(self):
        self.assertEqual(check_plan(self.requirements, self.cases), [])
        self.assertEqual(self.check(self.release), [])

    def test_duplicate_and_unmapped_cases(self):
        self.assertTrue(check_plan(self.requirements * 2, self.cases))
        self.assertTrue(check_plan(self.requirements, self.cases + [dict(self.cases[0], id='T02')]))

    def test_unknown_reference(self):
        req = copy.deepcopy(self.requirements)
        req[0]['tests'] = ['T99']
        self.assertTrue(check_plan(req, self.cases))

    def test_unrun_failed_missing_and_stale_results_rejected(self):
        for change in ({'status': 'not_run'}, {'status': 'fail'}, {'commit': 'b' * 40}, {'executed_at': ''}):
            release = copy.deepcopy(self.release)
            release['tests']['T01'].update(change)
            self.assertTrue(self.check(release), change)
        self.release['tests'] = {}
        self.assertTrue(self.check(self.release))

    def test_missing_empty_and_escaped_artifacts(self):
        for path in ('verification/evidence/missing.txt', '../outside.txt', '/etc/hosts'):
            release = copy.deepcopy(self.release)
            release['tests']['T01']['artifact'] = path
            self.assertTrue(self.check(release), path)
        (self.root / 'verification/evidence/result.txt').write_text('')
        self.assertTrue(self.check(self.release))

    def test_pending_requirement_and_future_execution(self):
        release = copy.deepcopy(self.release)
        release['requirements']['R01']['status'] = 'pending'
        self.assertTrue(self.check(release))
        self.release['tests']['T01']['executed_at'] = '2999-01-01T00:00:00Z'
        self.assertTrue(self.check(self.release))


if __name__ == '__main__':
    unittest.main()
