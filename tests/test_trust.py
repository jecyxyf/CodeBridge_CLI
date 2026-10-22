"""Host-trust regressions; all configuration and SSH traffic stay in fixtures."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock

from local_client import app, bridge, trust


def key_pin(data):
    key = mock.Mock()
    key.asbytes.return_value = data
    return bridge.fingerprint(key)


PIN = key_pin(b'fixture server key')
OTHER_PIN = key_pin(b'other fixture server key')


class TrustFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config = self.root / 'settings.json'
        self.store_path = self.root / 'trusted_hosts.json'
        # Patch before construction: even the initial settings read is isolated.
        self.patch(app, 'CONFIG', self.config)
        self.patch(bridge.Path, 'home', return_value=self.root)
        self.socket = self.patch(bridge, 'connect_socket')
        self.transport_factory = self.patch(bridge.paramiko, 'Transport')
        self.transport = self.transport_factory.return_value
        self.transport.get_remote_server_key.return_value.asbytes.return_value = b'fixture server key'
        # Stop at the authentication boundary, before any local service or mount.
        self.transport.auth_password.side_effect = bridge.BridgeError('fixture authentication boundary')
        self.process = self.patch(bridge.subprocess, 'Popen', side_effect=AssertionError('must not run a service'))
        self.application = app.Application()
        self.running = []
        self.addCleanup(self.finish_workers)

    def patch(self, target, attribute, *args, **kwargs):
        patcher = mock.patch.object(target, attribute, *args, **kwargs)
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def finish_workers(self):
        for connection, worker in self.running:
            connection.stop.set()
            worker.join(2)
            self.assertFalse(worker.is_alive(), 'fixture SSH worker did not stop')
        self.process.assert_not_called()

    def settings(self, **overrides):
        result = dict(host='server.example', port='22', username='fixture-user',
                      proxy='', folder=str(self.root), remote_os='Linux', password='fixture-secret')
        result.update(overrides)
        return result

    def connect(self, **overrides):
        self.application.connect(self.settings(**overrides))
        self.running.append((self.application.bridge, self.application.worker))

    def challenge(self):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            snapshot = self.application.snapshot()
            if snapshot['trust_challenge']:
                return snapshot['trust_challenge']
            if not self.application.worker.is_alive():
                self.fail('SSH stopped before first-use challenge: ' + snapshot['message'])
            time.sleep(0.005)
        self.fail('First-use challenge was not issued')

    def join_worker(self):
        self.application.worker.join(2)
        self.assertFalse(self.application.worker.is_alive(), 'SSH worker did not finish')

    def install_pending(self):
        """A stranded challenge from a completed worker, with no live SSH."""
        connection = bridge.Bridge(self.application.notify, self.application.verify_host)
        pending = dict(public=dict(id='fixture-one-use-nonce', host='server.example', port=22,
                                   fingerprint=PIN), bridge=connection, event=threading.Event(),
                       accepted=False, deadline=time.monotonic() + 120)
        self.application.bridge = connection
        self.application.pending_trust = pending
        return pending


class FirstUseTrustTests(TrustFixture):
    def test_accept_persists_observed_key_before_password_authentication(self):
        self.connect()
        challenge = self.challenge()
        self.transport.start_client.assert_called_once_with(timeout=15)
        self.transport.get_remote_server_key.assert_called_once_with()
        self.transport.auth_password.assert_not_called()
        self.assertFalse(self.store_path.exists())
        self.assertEqual(challenge['fingerprint'], PIN)
        self.assertEqual(self.application.snapshot()['phase'], 'host_trust')

        observations = []

        def authenticated(username, password, fallback):
            observations.append((self.application.trust.expected('server.example', 22),
                                 username, password, fallback))
            raise bridge.BridgeError('fixture authentication boundary')

        self.transport.auth_password.side_effect = authenticated
        self.application.decide_trust({'id': challenge['id'], 'accept': True})
        self.join_worker()
        self.assertEqual(observations, [(PIN, 'fixture-user', 'fixture-secret', False)])
        self.transport.auth_password.assert_called_once_with('fixture-user', 'fixture-secret', fallback=False)
        self.assertEqual(json.loads(self.store_path.read_text()), {trust.target_id('server.example', 22): PIN})
        self.assertIsNone(self.application.snapshot()['trust_challenge'])
        self.assertNotIn('fixture-secret', self.config.read_text())
        self.assertNotIn('fingerprint', json.loads(self.config.read_text()))

    def test_cancel_never_authenticates_or_saves_key(self):
        self.connect()
        challenge = self.challenge()
        self.transport.auth_password.assert_not_called()
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()
        self.transport.auth_password.assert_not_called()
        self.assertIsNone(self.application.trust.expected('server.example', 22))
        self.assertFalse(self.store_path.exists())
        self.assertIsNone(self.application.pending_trust)

    def test_disconnect_while_prompt_pending_never_sends_password(self):
        self.connect()
        self.challenge()
        self.application.disconnect()
        self.join_worker()
        self.transport.auth_password.assert_not_called()
        self.assertIsNone(self.application.pending_trust)
        self.assertFalse(self.store_path.exists())

    def test_known_key_is_reused_automatically_after_restart(self):
        self.application.trust.remember('server.example', 22, PIN)
        self.application = app.Application()
        self.connect(host='SERVER.EXAMPLE.')
        self.join_worker()
        self.transport.auth_password.assert_called_once_with('fixture-user', 'fixture-secret', fallback=False)
        self.assertIsNone(self.application.pending_trust)
        self.assertEqual(self.application.trust.expected('server.example', 22), PIN)

    def test_known_key_mismatch_stops_before_password_and_cannot_replace_pin(self):
        self.application.trust.remember('server.example', 22, OTHER_PIN)
        saved = self.store_path.read_bytes()
        self.connect(fingerprint=PIN)
        self.join_worker()
        self.transport.auth_password.assert_not_called()
        self.assertIsNone(self.application.pending_trust)
        self.assertEqual(self.store_path.read_bytes(), saved)
        self.assertIn('身份不匹配', self.application.snapshot()['message'])

    def test_another_hostname_requires_separate_confirmation(self):
        self.application.trust.remember('old.example', 22, PIN)
        self.connect()
        challenge = self.challenge()
        self.assertEqual(challenge['host'], 'server.example')
        self.transport.auth_password.assert_not_called()
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()
        self.assertEqual(self.application.trust.expected('old.example', 22), PIN)
        self.assertIsNone(self.application.trust.expected('server.example', 22))

    def test_another_port_requires_separate_confirmation(self):
        self.application.trust.remember('server.example', 22, PIN)
        self.connect(port='2222')
        challenge = self.challenge()
        self.assertEqual(challenge['port'], 2222)
        self.transport.auth_password.assert_not_called()
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()
        self.assertEqual(self.application.trust.expected('server.example', 22), PIN)
        self.assertIsNone(self.application.trust.expected('server.example', 2222))

    def test_fingerprint_from_connect_request_cannot_bypass_first_use(self):
        self.connect(fingerprint=PIN)
        challenge = self.challenge()
        self.transport.auth_password.assert_not_called()
        self.assertNotIn('fingerprint', self.application.settings)
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()

    def test_decision_cannot_substitute_challenge_host_port_or_fingerprint(self):
        self.connect()
        challenge = self.challenge()
        self.application.decide_trust(dict(id=challenge['id'], accept=True, host='attacker.example',
                                          port=2222, fingerprint=OTHER_PIN))
        self.join_worker()
        self.assertEqual(self.application.trust.read(), {trust.target_id('server.example', 22): PIN})
        self.transport.auth_password.assert_called_once()

    def test_snapshot_cannot_mutate_pending_challenge(self):
        self.connect()
        challenge = self.challenge()
        nonce = challenge['id']
        challenge.update(host='attacker.example', port=2222, fingerprint=OTHER_PIN)
        self.application.decide_trust({'id': nonce, 'accept': True})
        self.join_worker()
        self.assertEqual(self.application.trust.read(), {trust.target_id('server.example', 22): PIN})

    def test_invalid_nonce_or_non_boolean_decision_does_not_unlock_password(self):
        self.connect()
        challenge = self.challenge()
        for request in ({'id': 'wrong', 'accept': True}, {'accept': True},
                        {'id': 123, 'accept': True}, {'id': challenge['id'], 'accept': 1},
                        {'id': challenge['id'], 'accept': 'true'}, {'id': challenge['id']}):
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.application.decide_trust(request)
            self.assertFalse(self.application.pending_trust['event'].is_set())
            self.transport.auth_password.assert_not_called()
            self.assertFalse(self.store_path.exists())
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()

    def test_expired_challenge_rejects_decision_and_never_authenticates(self):
        self.connect()
        challenge = self.challenge()
        with self.application.lock:
            self.application.pending_trust['deadline'] = time.monotonic() - 1
        with self.assertRaises(ValueError):
            self.application.decide_trust({'id': challenge['id'], 'accept': True})
        self.join_worker()
        self.transport.auth_password.assert_not_called()
        self.assertFalse(self.store_path.exists())
        self.assertIsNone(self.application.pending_trust)

    def test_accepted_nonce_cannot_be_replayed(self):
        self.connect()
        challenge = self.challenge()
        decision = {'id': challenge['id'], 'accept': True}
        self.application.decide_trust(decision)
        with self.assertRaises(ValueError):
            self.application.decide_trust(decision)
        self.join_worker()
        self.transport.auth_password.assert_called_once()

    def test_cancelled_nonce_cannot_be_replayed_on_new_connection(self):
        self.connect()
        old = self.challenge()
        self.application.decide_trust({'id': old['id'], 'accept': False})
        self.join_worker()
        self.connect()
        current = self.challenge()
        self.assertNotEqual(old['id'], current['id'])
        with self.assertRaises(ValueError):
            self.application.decide_trust({'id': old['id'], 'accept': True})
        self.transport.auth_password.assert_not_called()
        self.application.decide_trust({'id': current['id'], 'accept': False})
        self.join_worker()

    def test_challenge_from_replaced_bridge_is_rejected(self):
        pending = self.install_pending()
        self.application.bridge = bridge.Bridge(self.application.notify)
        with self.assertRaises(ValueError):
            self.application.decide_trust({'id': pending['public']['id'], 'accept': True})
        self.assertFalse(self.store_path.exists())
        self.assertFalse(pending['event'].is_set())

    def test_challenge_from_stopped_bridge_is_rejected(self):
        pending = self.install_pending()
        pending['bridge'].stop.set()
        with self.assertRaises(ValueError):
            self.application.decide_trust({'id': pending['public']['id'], 'accept': True})
        self.assertFalse(self.store_path.exists())

    def test_already_signalled_challenge_is_rejected(self):
        pending = self.install_pending()
        pending['event'].set()
        with self.assertRaises(ValueError):
            self.application.decide_trust({'id': pending['public']['id'], 'accept': True})
        self.assertFalse(self.store_path.exists())

    def test_acceptance_write_failure_does_not_unlock_authentication(self):
        self.connect()
        challenge = self.challenge()
        with mock.patch.object(self.application.trust, '_write', side_effect=OSError('fixture disk failure')):
            with self.assertRaises(OSError):
                self.application.decide_trust({'id': challenge['id'], 'accept': True})
        self.transport.auth_password.assert_not_called()
        self.assertFalse(self.application.pending_trust['event'].is_set())
        self.assertFalse(self.application.pending_trust['accepted'])
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()


class TrustStoreTests(TrustFixture):
    def test_normalizes_hostname_idna_ip_and_port(self):
        cases = [(' SERVER.Example. ', '22', 'server.example', 22),
                 ('BÜCHER.example', 22, 'xn--bcher-kva.example', 22),
                 ('[2001:0db8:0:0::1]', '2222', '2001:db8::1', 2222),
                 ('127.0.0.1', '022', '127.0.0.1', 22)]
        for host, port, normalized, normalized_port in cases:
            with self.subTest(host=host):
                self.assertEqual(trust.target_id(host, port), trust.target_id(normalized, normalized_port))
                self.application.trust.remember(host, port, PIN)
                self.assertEqual(self.application.trust.expected(normalized, normalized_port), PIN)

    def test_invalid_targets_are_rejected(self):
        for host, port in [('', 22), ('a b', 22), ('a\nb', 22), ('a/b', 22),
                           ('a\\b', 22), ('server', 0), ('server', 65536), ('server', 'bad')]:
            with self.subTest(host=host, port=port), self.assertRaises((ValueError, UnicodeError)):
                trust.target_id(host, port)

    def test_pin_format_is_canonical_sha256(self):
        self.assertTrue(trust.valid_pin(PIN))
        for value in (None, '', 'SHA256:short', 'MD5:aa:bb', PIN + '=', 'SHA256:' + '*' * 43):
            with self.subTest(value=value):
                self.assertFalse(trust.valid_pin(value))

    def test_remember_cannot_replace_an_existing_pin(self):
        self.application.trust.remember('server.example', 22, PIN)
        with self.assertRaises(bridge.BridgeError):
            self.application.trust.remember('server.example', 22, OTHER_PIN)
        self.assertEqual(self.application.trust.expected('server.example', 22), PIN)

    def test_corrupt_store_fails_closed_instead_of_prompting_or_authenticating(self):
        self.store_path.write_text('{not json')
        with self.assertRaises(bridge.BridgeError):
            self.application.connect(self.settings())
        self.socket.assert_not_called()
        self.transport.auth_password.assert_not_called()
        self.assertIsNone(self.application.pending_trust)

    def test_non_object_or_invalid_pin_store_is_rejected(self):
        for invalid in ([], {'server': 'invalid'}, {'server': None}):
            with self.subTest(invalid=invalid):
                self.store_path.write_text(json.dumps(invalid))
                with self.assertRaises(bridge.BridgeError):
                    self.application.trust.read()


class ForgetHostTests(TrustFixture):
    def test_deletion_removes_only_selected_normalized_host_and_port(self):
        store = self.application.trust
        store.remember('server.example', 22, PIN)
        store.remember('server.example', 2222, OTHER_PIN)
        store.remember('another.example', 22, OTHER_PIN)
        self.application.forget_host({'host': 'SERVER.EXAMPLE.', 'port': 22})
        expected = {trust.target_id('server.example', 2222): OTHER_PIN,
                    trust.target_id('another.example', 22): OTHER_PIN}
        self.assertEqual(store.read(), expected)
        self.assertEqual(app.Application().trust.read(), expected)

    def test_deleting_unknown_host_does_not_rewrite_other_records(self):
        self.application.trust.remember('server.example', 22, PIN)
        saved = self.store_path.read_bytes()
        with mock.patch.object(self.application.trust, '_write', wraps=self.application.trust._write) as write:
            self.application.forget_host({'host': 'unknown.example', 'port': 22})
        write.assert_not_called()
        self.assertEqual(self.store_path.read_bytes(), saved)

    def test_unknown_host_with_empty_store_is_noop(self):
        self.application.forget_host({'host': 'unknown.example', 'port': 22})
        self.assertFalse(self.store_path.exists())
        self.assertFalse(self.config.exists())

    def test_live_connection_rejects_deletion_without_disconnect_or_changes(self):
        self.application.trust.remember('server.example', 22, PIN)
        saved = self.store_path.read_bytes()
        pending = self.install_pending()
        self.application.worker = mock.Mock()
        self.application.worker.is_alive.return_value = True
        self.application.state, self.application.phase = 'connected', 'readable'
        self.application.mount = '/fixture/mount'
        with mock.patch.object(self.application.bridge, 'disconnect') as disconnect:
            with self.assertRaises(ValueError):
                self.application.forget_host({'host': 'server.example', 'port': 22})
            disconnect.assert_not_called()
        self.assertEqual(self.store_path.read_bytes(), saved)
        self.assertIs(self.application.pending_trust, pending)
        self.assertFalse(pending['event'].is_set())
        self.assertEqual((self.application.state, self.application.phase, self.application.mount),
                         ('connected', 'readable', '/fixture/mount'))

    def test_pending_live_first_use_cannot_be_deleted(self):
        self.connect()
        challenge = self.challenge()
        with self.assertRaises(ValueError):
            self.application.forget_host({'host': challenge['host'], 'port': challenge['port']})
        self.assertEqual(self.application.snapshot()['trust_challenge']['id'], challenge['id'])
        self.transport.auth_password.assert_not_called()
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()

    def test_delete_invalidates_stale_pending_challenge(self):
        self.application.trust.remember('server.example', 22, PIN)
        pending = self.install_pending()
        self.application.worker = mock.Mock()
        self.application.worker.is_alive.return_value = False
        self.application.forget_host({'host': 'server.example', 'port': 22})
        self.assertTrue(pending['event'].is_set())
        self.assertFalse(pending['accepted'])
        self.assertIsNone(self.application.pending_trust)
        with self.assertRaises(ValueError):
            self.application.decide_trust({'id': pending['public']['id'], 'accept': True})
        self.assertIsNone(self.application.trust.expected('server.example', 22))

    def test_invalid_delete_target_does_not_remove_any_record(self):
        self.application.trust.remember('server.example', 22, PIN)
        for request in ({'host': 'server.example', 'port': '22'}, {'host': 'server.example', 'port': True},
                        {'host': None, 'port': 22}, {'host': 'server.example', 'port': 0}):
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.application.forget_host(request)
            self.assertEqual(self.application.trust.expected('server.example', 22), PIN)

    def test_deleted_host_requires_confirmation_on_next_connection(self):
        self.application.trust.remember('server.example', 22, PIN)
        self.application.forget_host({'host': 'server.example', 'port': 22})
        self.connect()
        challenge = self.challenge()
        self.transport.auth_password.assert_not_called()
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()


class LegacyTrustTests(TrustFixture):
    def legacy_application(self, **overrides):
        settings = self.settings(fingerprint=PIN, **overrides)
        settings.pop('password')
        self.config.write_text(json.dumps(settings))
        self.application = app.Application()
        return self.application

    def test_legacy_pin_is_scoped_to_previous_host_and_port(self):
        application = self.legacy_application(host='OLD.EXAMPLE.', port='2222')
        self.assertEqual(application.trust.expected('old.example', 2222), PIN)
        self.assertIsNone(application.trust.expected('old.example', 22))
        self.assertIsNone(application.trust.expected('new.example', 2222))
        self.assertNotIn('fingerprint', application.snapshot()['settings'])

    def test_matching_legacy_pin_migrates_and_authenticates_without_prompt(self):
        self.legacy_application()
        self.connect()
        self.join_worker()
        self.transport.auth_password.assert_called_once()
        self.assertIsNone(self.application.pending_trust)
        self.assertEqual(self.application.trust.read(), {trust.target_id('server.example', 22): PIN})
        self.assertNotIn('fingerprint', json.loads(self.config.read_text()))

    def test_legacy_pin_does_not_migrate_to_new_connect_target(self):
        self.legacy_application(host='old.example', port='2222')
        self.connect(host='new.example', port='22', fingerprint=PIN)
        challenge = self.challenge()
        self.transport.auth_password.assert_not_called()
        self.assertEqual(self.application.trust.read(), {trust.target_id('old.example', 2222): PIN})
        self.application.decide_trust({'id': challenge['id'], 'accept': False})
        self.join_worker()

    def test_existing_record_takes_precedence_over_conflicting_legacy_pin(self):
        self.application.trust.remember('server.example', 22, OTHER_PIN)
        self.legacy_application()
        self.connect()
        self.join_worker()
        self.transport.auth_password.assert_not_called()
        self.assertEqual(self.application.trust.expected('server.example', 22), OTHER_PIN)
        self.assertIn('身份不匹配', self.application.snapshot()['message'])

    def test_deleted_legacy_pin_cannot_be_reimported_after_restart(self):
        self.legacy_application()
        self.application.forget_host({'host': 'SERVER.EXAMPLE.', 'port': 22})
        self.assertNotIn('fingerprint', json.loads(self.config.read_text()))
        self.assertIsNone(self.application.trust.expected('server.example', 22))
        self.application.trust.migrate()
        self.assertEqual(self.application.trust.read(), {})
        restarted = app.Application()
        restarted.trust.migrate()
        self.assertIsNone(restarted.trust.expected('server.example', 22))
        self.assertEqual(restarted.trust.read(), {})

    def test_deleting_different_host_preserves_legacy_pin_for_original_target(self):
        self.legacy_application(host='old.example', port='2222')
        self.application.trust.remember('selected.example', 22, OTHER_PIN)
        self.application.forget_host({'host': 'selected.example', 'port': 22})
        self.assertNotIn('fingerprint', json.loads(self.config.read_text()))
        restarted = app.Application()
        self.assertEqual(restarted.trust.read(), {trust.target_id('old.example', 2222): PIN})
        self.assertEqual(restarted.trust.expected('old.example', 2222), PIN)
        self.assertIsNone(restarted.trust.expected('selected.example', 22))

    def test_invalid_legacy_pin_is_not_trusted(self):
        settings = self.settings(fingerprint='SHA256:invalid')
        settings.pop('password')
        self.config.write_text(json.dumps(settings))
        self.application = app.Application()
        self.assertIsNone(self.application.trust.expected('server.example', 22))
        self.application.trust.migrate()
        self.assertFalse(self.store_path.exists())


if __name__ == '__main__':
    unittest.main()
