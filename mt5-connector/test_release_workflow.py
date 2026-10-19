import re
import unittest
from pathlib import Path


WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "mt5-connector-release.yml"


class ReleaseWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_manual_publish_requires_main_and_an_explicit_version_tag(self):
        self.assertRegex(self.workflow, r"release_tag:\s*\n\s*description:.*mt5-connector-v1\.1\.0")
        self.assertRegex(
            self.workflow,
            r"github\.ref == 'refs/heads/main' && inputs\.release_tag != ''",
        )
        self.assertRegex(
            self.workflow,
            r"tag=\"\$RELEASE_TAG\"[\s\S]*?\^mt5-connector-v\[0-9\]\+",
        )

    def test_manual_tag_points_at_the_built_commit_and_never_forces_a_tag(self):
        self.assertIn('git tag "$tag" "$GITHUB_SHA"', self.workflow)
        self.assertIn('git push origin "refs/tags/$tag"', self.workflow)
        self.assertIn('git ls-remote --exit-code --tags origin "refs/tags/$tag"', self.workflow)
        self.assertNotRegex(self.workflow, r"git push[^\n]*--force")
        self.assertIn("gh release create", self.workflow)
        self.assertIn("--verify-tag", self.workflow)
        self.assertNotIn("--clobber", self.workflow)

    def test_windows_package_includes_and_smoke_tests_local_copier_worker(self):
        self.assertIn('--hidden-import local_copier_worker', self.workflow)
        self.assertIn("@('--local-copy-worker','--help')", self.workflow)
        self.assertIn('Packaged local copier worker entrypoint failed', self.workflow)


if __name__ == "__main__":
    unittest.main()
