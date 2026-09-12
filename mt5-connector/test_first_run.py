import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

MODULE_PATH = Path(__file__).with_name('mkety_mt5_connector.py')
spec = importlib.util.spec_from_file_location('mkety_mt5_connector_first_run', MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FirstRunTests(unittest.TestCase):
    def test_missing_config_prompts_for_token_and_uses_baked_gateway(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'connector.json'
            args = SimpleNamespace(config=str(path), reset=False, token=None, gateway=None)
            prompts = []
            config = module.resolve_startup_config(
                args,
                input_fn=lambda prompt: prompts.append(prompt) or 'mt5v1.one-time.signature',
            )
            self.assertEqual(config['gateway_url'], module.DEFAULT_GATEWAY)
            self.assertEqual(config['connection_token'], 'mt5v1.one-time.signature')
            self.assertTrue(prompts)
            self.assertEqual(module.load_local_config(path)['connection_token'], 'mt5v1.one-time.signature')

    def test_existing_config_does_not_prompt(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'connector.json'
            expected = module.save_local_config(path, {
                'gateway_url': module.DEFAULT_GATEWAY,
                'connection_token': 'mt5r1.reconnect.signature',
                'connector_instance_id': 'instance-1',
            })
            args = SimpleNamespace(config=str(path), reset=False, token=None, gateway=None)
            config = module.resolve_startup_config(
                args,
                input_fn=lambda _prompt: self.fail('existing config must not prompt'),
            )
            self.assertEqual(config, expected)


if __name__ == '__main__':
    unittest.main()
