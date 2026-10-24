"""Exercise the env loader with isolated files and dummy credentials only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class EnvLoading(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        shutil.copy(ROOT / 'scripts/load-env.sh', self.root / 'scripts/load-env.sh')
        self.env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME']}

    def run_loader(self, *args):
        return subprocess.run(['bash', str(self.root / 'scripts/load-env.sh'), *args,
            'python3', '-c', 'import os,json; print(json.dumps(dict(os.environ)))'],
            env=self.env, text=True, capture_output=True, check=True)

    def test_personal_overrides_shared_and_nonempty_shell_wins(self):
        (self.root / '.env').write_text('RIVET_MODE=fixture\nOPENAI_API_KEY=shared-dummy\n')
        (self.root / '.env.local').write_text('RIVET_MODE=live\nOPENAI_API_KEY=personal-dummy\n')
        result = self.run_loader()
        self.assertEqual(json.loads(result.stdout)['RIVET_MODE'], 'live')
        self.assertEqual(json.loads(result.stdout)['OPENAI_API_KEY'], 'personal-dummy')
        self.assertNotIn('personal-dummy', result.stderr)
        self.env['RIVET_MODE'] = 'fixture'
        self.assertEqual(json.loads(self.run_loader().stdout)['RIVET_MODE'], 'fixture')

    def test_encrypted_base_uses_defaults_and_web_removes_keys(self):
        (self.root / '.env').write_bytes(b'\x00GITCRYPT\x00encrypted')
        (self.root / '.env.example').write_text('RIVET_MODE=fixture\nOPENAI_API_KEY=dummy\nBACKBOARD_API_KEY=dummy\n')
        values = json.loads(self.run_loader('--web').stdout)
        self.assertEqual(values['RIVET_MODE'], 'fixture')
        self.assertNotIn('OPENAI_API_KEY', values)
        self.assertNotIn('BACKBOARD_API_KEY', values)

    def test_env_text_cannot_execute_shell_commands(self):
        marker = self.root / 'should-not-exist'
        (self.root / '.env').write_text(f'ATTACK=$(touch {marker})\nLITERAL=\'$(touch {marker})\'\n')
        result = self.run_loader()
        self.assertFalse(marker.exists())
        self.assertNotIn('ATTACK', json.loads(result.stdout))
        self.assertEqual(json.loads(result.stdout)['LITERAL'], f'$(touch {marker})')


if __name__ == '__main__':
    unittest.main()
