import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('mkety_mt5_connector.py')
spec = importlib.util.spec_from_file_location('mkety_mt5_connector_transport', MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConnectorTransportTests(unittest.TestCase):
    def test_empty_gateway_frame_is_reported_as_disconnect_not_json_error(self):
        for raw in (None, '', b''):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(RuntimeError, 'Mkety gateway disconnected'):
                    module.decode_gateway_message(raw)

    def test_valid_gateway_json_is_decoded(self):
        self.assertEqual(module.decode_gateway_message('{"type":"auth_ok"}'), {'type': 'auth_ok'})


if __name__ == '__main__':
    unittest.main()
