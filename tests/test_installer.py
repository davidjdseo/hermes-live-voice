import sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import install
import uninstall
class InstallerTests(unittest.TestCase):
    def test_soul_merge_is_idempotent_and_exact(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'SOUL.md'; path.write_text('before\n', encoding='utf-8'); install.merge_soul(path, False); first = path.read_text(encoding='utf-8'); install.merge_soul(path, False)
            self.assertEqual(path.read_text(encoding='utf-8'), first); self.assertEqual(first.count(install.START), 1); self.assertIn('<<<VOICE ... VOICE>>>', first); self.assertIn('TTS 메아리', first)
    def test_copy_exclusions(self):
        names = {'.git', '.omx', 'tests', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cache', 'src', 'foo.log'}
        self.assertEqual(install.copy_ignore('.', list(names)), names - {'src'})
    def test_skip_soul_keeps_existing_content(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'SOUL.md'; path.write_text('already configured\n', encoding='utf-8'); install.maybe_merge_soul(path, False, True)
            self.assertEqual(path.read_text(encoding='utf-8'), 'already configured\n')
    def test_link_desktop_shim_create_refuse_and_cleanup(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder) / 'home'; root = Path(folder) / 'repo'; (root / 'desktop').mkdir(parents=True); (root / 'desktop/plugin.js').write_text('plugin', encoding='utf-8')
            install.ensure_desktop_shim(home, root, False); shim = home / 'desktop-plugins' / install.NAME
            self.assertTrue(shim.is_dir()); self.assertTrue((shim / 'plugin.js').is_symlink()); self.assertTrue(install.managed_desktop_shim(shim, root))
            install.ensure_desktop_shim(home, root, False)
            (shim / 'unrelated.txt').write_text('keep', encoding='utf-8')
            with self.assertRaises(SystemExit): install.ensure_desktop_shim(home, root, False)
            (shim / 'unrelated.txt').unlink(); uninstall.remove_desktop_shim(home, root, False); self.assertFalse(shim.exists())
if __name__ == '__main__': unittest.main()
