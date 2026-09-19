from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
os.environ.setdefault("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "demo-stratexec-platform")

from stratexec.api.identity_app import create_app  # noqa: E402
from stratexec.identity.models import IdentityPrincipal, Member  # noqa: E402


class _NoopAdapter:
    def verify(self, token: str) -> IdentityPrincipal:
        raise RuntimeError("not used while exporting OpenAPI")

    def set_admin(self, uid: str, *, enabled: bool) -> None:
        return None

    def synchronize(self, principal: IdentityPrincipal, *, bootstrap_admin: bool) -> Member:
        raise RuntimeError("not used while exporting OpenAPI")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    from stratexec.identity.service import IdentityService

    schema = create_app(IdentityService(_NoopAdapter(), _NoopAdapter(), _NoopAdapter())).openapi()
    output = Path(__file__).parents[2] / "contracts" / "identity" / "openapi.json"
    rendered = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        if not output.exists() or output.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Identity OpenAPI contract is stale. Run export_identity_openapi.py.")
        return 0
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
