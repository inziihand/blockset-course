from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from firebase_admin import firestore

from stratexec.adapters.firebase.auth import initialize_firebase


def main() -> int:
    parser = argparse.ArgumentParser(description="Synchronize App lifecycle metadata without changing current state.")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).parents[2]
    config = json.loads(args.config.resolve().read_text(encoding="utf-8-sig"))
    enabled_apps = set(config["enabledApps"])
    manifests = []
    for path in sorted((root / "infrastructure" / "apps").glob("*.json")):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest["kind"] == "frontend-app":
            manifests.append(manifest)

    if not args.apply:
        for manifest in manifests:
            status = "installed" if manifest["appKey"] in enabled_apps else "uninstalled"
            print(f"PLAN {manifest['appKey']}: catalog metadata, initial status={status}")
        return 0

    initialize_firebase(project_id=config["gcpProjectId"])
    database = firestore.client()
    for manifest in manifests:
        reference = database.collection("appInstallations").document(manifest["appKey"])
        existing = reference.get()
        payload = {
            "appKey": manifest["appKey"],
            "displayName": manifest["displayName"],
            "category": manifest["lifecycle"]["category"],
            "removable": manifest["lifecycle"]["removable"],
            "protected": manifest["access"]["protected"],
            "requiredServices": manifest["requiredServices"],
            "updatedAt": datetime.now(timezone.utc),
            "updatedBy": "catalog-sync",
        }
        if not existing.exists:
            payload["status"] = "installed" if manifest["appKey"] in enabled_apps else "uninstalled"
        reference.set(payload, merge=True)
        status = (existing.to_dict() or {}).get("status", payload.get("status", "unchanged"))
        print(f"SYNCED {manifest['appKey']}: status={status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
