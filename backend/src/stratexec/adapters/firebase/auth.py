from __future__ import annotations

import atexit
import os
from pathlib import Path
import ssl
import tempfile

import firebase_admin
from firebase_admin import auth
from firebase_admin.credentials import Base
from google.auth.credentials import AnonymousCredentials
import truststore

from stratexec.identity.models import IdentityPrincipal


_system_trust_configured = False
_grpc_ca_bundle: Path | None = None


class _EmulatorCredential(Base):
    def get_credential(self) -> AnonymousCredentials:
        return AnonymousCredentials()


def _remove_grpc_ca_bundle() -> None:
    if _grpc_ca_bundle is not None:
        _grpc_ca_bundle.unlink(missing_ok=True)


def _configure_system_trust() -> None:
    global _grpc_ca_bundle, _system_trust_configured
    if _system_trust_configured:
        return

    # HTTP clients can use the native OS store directly. This is required on
    # desktop installations behind TLS inspection where certifi lacks the
    # locally managed root certificate.
    truststore.inject_into_ssl()

    # Firestore uses gRPC C-core, which does not consume Python's SSL context.
    # Export public Windows trust roots to a process-local PEM file unless the
    # operator already supplied an explicit bundle. Linux containers continue
    # to use their normal system CA path.
    if os.name == "nt" and not os.getenv("GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"):
        certificates: list[str] = []
        for store_name in ("ROOT", "CA"):
            for certificate, encoding, _trust in ssl.enum_certificates(store_name):
                if encoding == "x509_asn":
                    certificates.append(ssl.DER_cert_to_PEM_cert(certificate))
        if certificates:
            handle, bundle_path = tempfile.mkstemp(prefix="stratexec-windows-ca-", suffix=".pem")
            with os.fdopen(handle, "w", encoding="ascii", newline="\n") as bundle:
                bundle.write("".join(dict.fromkeys(certificates)))
            _grpc_ca_bundle = Path(bundle_path)
            os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = bundle_path
            atexit.register(_remove_grpc_ca_bundle)

    _system_trust_configured = True


def initialize_firebase(*, project_id: str | None = None) -> None:
    _configure_system_trust()
    try:
        firebase_admin.get_app()
    except ValueError:
        options = {"projectId": project_id} if project_id else None
        use_emulators = os.getenv("FIRESTORE_EMULATOR_HOST") and os.getenv("FIREBASE_AUTH_EMULATOR_HOST")
        credential = _EmulatorCredential() if use_emulators else None
        firebase_admin.initialize_app(credential=credential, options=options)


class FirebaseTokenVerifier:
    def verify(self, token: str) -> IdentityPrincipal:
        decoded = auth.verify_id_token(token, check_revoked=True)
        firebase = decoded.get("firebase", {})
        identities = firebase.get("identities", {})
        providers = identities.get("google.com", [])
        return IdentityPrincipal(
            uid=decoded["uid"],
            email=decoded.get("email", ""),
            display_name=decoded.get("name"),
            photo_url=decoded.get("picture"),
            provider="google.com" if providers else firebase.get("sign_in_provider", ""),
            email_verified=bool(decoded.get("email_verified", False)),
        )


class FirebaseClaimsWriter:
    def set_admin(self, uid: str, *, enabled: bool) -> None:
        user = auth.get_user(uid)
        claims = dict(user.custom_claims or {})
        if enabled:
            claims["admin"] = True
        else:
            claims.pop("admin", None)
        if claims != dict(user.custom_claims or {}):
            auth.set_custom_user_claims(uid, claims or None)
