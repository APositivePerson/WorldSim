import unittest

from proxy_config import normalize_proxy_environment


class ProxyConfigTests(unittest.TestCase):
    def test_normalizes_all_proxy_variants_without_changing_credentials(self):
        names = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                 "http_proxy", "https_proxy", "all_proxy")
        env = {name: "socks://user:password@127.0.0.1:7897/" for name in names}
        normalize_proxy_environment(env)
        for name in names:
            self.assertEqual(env[name], "socks5://user:password@127.0.0.1:7897/")
        normalize_proxy_environment(env)
        self.assertTrue(all(v.startswith("socks5://") for v in env.values()))

    def test_preserves_other_schemes_bypass_and_missing_variables(self):
        env = {"HTTPS_PROXY": "http://127.0.0.1:7897",
               "ALL_PROXY": "socks5h://127.0.0.1:7897",
               "NO_PROXY": "localhost,127.0.0.1", "http_proxy": ""}
        original = dict(env)
        normalize_proxy_environment(env)
        self.assertEqual(env, original)
        normalize_proxy_environment({})


if __name__ == "__main__":
    unittest.main()
