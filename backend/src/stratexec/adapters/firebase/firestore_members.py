from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from firebase_admin import firestore
from google.cloud.firestore_v1 import FieldFilter

from stratexec.identity.models import (
    AppGrant,
    AppCategory,
    AppInstallation,
    AppInstallationStatus,
    AppPolicy,
    IdentityPrincipal,
    Member,
    MemberPatch,
    MemberRole,
)
from stratexec.identity.service import AccessDenied, MemberNotFound


def _now() -> datetime:
    return datetime.now(timezone.utc)


class FirestoreMemberRepository:
    def __init__(self) -> None:
        self._database = firestore.client()

    def synchronize(self, principal: IdentityPrincipal, *, bootstrap_admin: bool) -> Member:
        reference = self._database.collection("members").document(principal.uid)
        snapshot = reference.get()
        timestamp = _now()
        profile = {
            "uid": principal.uid,
            "email": principal.email.lower(),
            "displayName": principal.display_name,
            "photoUrl": principal.photo_url,
            "provider": principal.provider,
            "emailVerified": principal.email_verified,
            "lastLoginAt": timestamp,
            "updatedAt": timestamp,
        }
        if snapshot.exists:
            reference.set(profile, merge=True)
        else:
            reference.set(
                {
                    **profile,
                    "role": MemberRole.ADMIN.value if bootstrap_admin else MemberRole.MEMBER.value,
                    "status": "active",
                    "plan": "free",
                    "createdAt": timestamp,
                }
            )
        return self._load(reference)

    def get(self, uid: str) -> Member | None:
        reference = self._database.collection("members").document(uid)
        if not reference.get().exists:
            return None
        return self._load(reference)

    def list(self, *, limit: int = 100) -> list[Member]:
        query = self._database.collection("members").where(filter=FieldFilter("status", "in", ["active", "disabled"]))
        return [self._from_snapshot(snapshot) for snapshot in query.limit(limit).stream()]

    def list_page(self, *, limit: int = 20, cursor: str | None = None) -> tuple[list[Member], str | None]:
        collection = self._database.collection("members")
        query = (
            collection
            .where(filter=FieldFilter("status", "in", ["active", "disabled"]))
            .order_by("__name__")
        )
        if cursor:
            cursor_snapshot = collection.document(cursor).get()
            if not cursor_snapshot.exists:
                raise ValueError("Invalid member page cursor.")
            query = query.start_after(cursor_snapshot)
        snapshots = list(query.limit(limit + 1).stream())
        page_snapshots = snapshots[:limit]
        next_cursor = page_snapshots[-1].id if len(snapshots) > limit and page_snapshots else None
        return [self._from_snapshot(snapshot) for snapshot in page_snapshots], next_cursor

    def update(self, uid: str, patch: MemberPatch, *, actor_uid: str) -> Member:
        reference = self._database.collection("members").document(uid)
        changes = patch.model_dump(exclude_none=True, mode="json", by_alias=True)
        changes["updatedAt"] = _now()
        audit_reference = self._database.collection("adminAuditLogs").document(str(uuid4()))

        @firestore.transactional
        def apply_update(transaction) -> None:
            snapshot = reference.get(transaction=transaction)
            if not snapshot.exists:
                raise MemberNotFound(uid)
            current = snapshot.to_dict() or {}
            next_role = changes.get("role", current.get("role"))
            next_status = changes.get("status", current.get("status"))
            removes_active_admin = (
                current.get("role") == "admin"
                and current.get("status") == "active"
                and (next_role != "admin" or next_status != "active")
            )
            if removes_active_admin:
                query = (
                    self._database.collection("members")
                    .where(filter=FieldFilter("role", "==", "admin"))
                    .where(filter=FieldFilter("status", "==", "active"))
                )
                if len(list(transaction.get(query))) <= 1:
                    raise AccessDenied("The last active administrator cannot be disabled or demoted.")
            transaction.update(reference, changes)
            transaction.set(audit_reference, self._audit_payload(actor_uid, "member.updated", uid, changes))

        apply_update(self._database.transaction())
        return self._load(reference)

    def set_app_grant(self, uid: str, grant: AppGrant, *, actor_uid: str) -> Member:
        member_reference = self._database.collection("members").document(uid)
        if not member_reference.get().exists:
            raise MemberNotFound(uid)
        grant_reference = member_reference.collection("appGrants").document(grant.app_key)
        payload = grant.model_dump(mode="python", by_alias=True)
        audit_reference = self._database.collection("adminAuditLogs").document(str(uuid4()))
        batch = self._database.batch()
        batch.set(grant_reference, payload)
        batch.update(member_reference, {"updatedAt": _now()})
        batch.set(
            audit_reference,
            self._audit_payload(actor_uid, "member.app-grant.updated", uid, payload),
        )
        batch.commit()
        return self._load(member_reference)

    def list_enabled_app_keys(self) -> list[str]:
        return sorted(
            installation.app_key
            for installation in self.list_app_installations()
            if installation.status is AppInstallationStatus.INSTALLED
        )

    def _legacy_enabled_app_keys(self) -> list[str]:
        snapshot = self._database.collection("platformMeta").document("schema").get()
        payload = snapshot.to_dict() or {}
        return sorted({str(app_key) for app_key in payload.get("enabledApps", []) if app_key})

    def list_app_policies(self) -> list[AppPolicy]:
        return sorted([
            AppPolicy.model_validate(snapshot.to_dict())
            for snapshot in self._database.collection("appPolicies").stream()
            if snapshot.to_dict()
        ], key=lambda policy: policy.app_key)

    def set_app_policy(self, policy: AppPolicy, *, actor_uid: str) -> AppPolicy:
        policy_reference = self._database.collection("appPolicies").document(policy.app_key)
        payload = policy.model_dump(mode="python", by_alias=True)
        audit_reference = self._database.collection("adminAuditLogs").document(str(uuid4()))
        batch = self._database.batch()
        batch.set(policy_reference, payload)
        batch.set(
            audit_reference,
            {
                "actorUid": actor_uid,
                "action": "app-policy.updated",
                "targetAppKey": policy.app_key,
                "changes": payload,
                "createdAt": _now(),
            },
        )
        batch.commit()
        return AppPolicy.model_validate(payload)

    def list_app_installations(self) -> list[AppInstallation]:
        legacy_enabled = set(self._legacy_enabled_app_keys())
        policy_payloads = {
            snapshot.id: snapshot.to_dict() or {}
            for snapshot in self._database.collection("appPolicies").stream()
        }
        installation_payloads = {
            snapshot.id: snapshot.to_dict() or {}
            for snapshot in self._database.collection("appInstallations").stream()
        }
        app_keys = legacy_enabled | set(policy_payloads) | set(installation_payloads)
        installations: list[AppInstallation] = []
        for app_key in sorted(app_keys):
            payload = installation_payloads.get(app_key)
            if payload:
                installations.append(AppInstallation.model_validate(payload))
                continue
            policy = policy_payloads.get(app_key, {})
            protected = bool(policy.get("protected")) or app_key == "access-control"
            installations.append(AppInstallation(
                app_key=app_key,
                display_name=str(policy.get("displayName") or app_key),
                status=(
                    AppInstallationStatus.INSTALLED
                    if app_key in legacy_enabled
                    else AppInstallationStatus.UNINSTALLED
                ),
                category=(
                    AppCategory.CORE
                    if protected
                    else AppCategory.SAMPLE if "demo" in app_key else AppCategory.APPLICATION
                ),
                removable=not protected,
                protected=protected,
            ))
        return installations

    def set_app_installation(self, installation: AppInstallation, *, actor_uid: str) -> AppInstallation:
        installation_reference = self._database.collection("appInstallations").document(installation.app_key)
        schema_reference = self._database.collection("platformMeta").document("schema")
        audit_reference = self._database.collection("adminAuditLogs").document(str(uuid4()))
        payload = installation.model_dump(mode="python", by_alias=True)
        enabled_apps_change = (
            firestore.ArrayUnion([installation.app_key])
            if installation.status is AppInstallationStatus.INSTALLED
            else firestore.ArrayRemove([installation.app_key])
        )
        batch = self._database.batch()
        batch.set(installation_reference, payload)
        batch.set(schema_reference, {"enabledApps": enabled_apps_change, "updatedAt": _now()}, merge=True)
        batch.set(audit_reference, {
            "actorUid": actor_uid,
            "action": f"app.lifecycle.{installation.status.value}",
            "targetAppKey": installation.app_key,
            "changes": payload,
            "createdAt": _now(),
        })
        batch.commit()
        return AppInstallation.model_validate(payload)

    def get_app_order(self) -> list[str]:
        snapshot = self._database.collection("platformMeta").document("schema").get()
        payload = snapshot.to_dict() or {}
        app_order: list[str] = []
        for app_key in payload.get("appOrder", []):
            normalized = str(app_key).strip()
            if normalized and normalized not in app_order:
                app_order.append(normalized)
        return app_order

    def set_app_order(self, app_keys: list[str], *, actor_uid: str) -> list[str]:
        schema_reference = self._database.collection("platformMeta").document("schema")
        audit_reference = self._database.collection("adminAuditLogs").document(str(uuid4()))
        app_order = list(app_keys)
        batch = self._database.batch()
        batch.set(schema_reference, {"appOrder": app_order, "updatedAt": _now()}, merge=True)
        batch.set(audit_reference, {
            "actorUid": actor_uid,
            "action": "app.order.updated",
            "targetAppKey": "*",
            "changes": {"appOrder": app_order},
            "createdAt": _now(),
        })
        batch.commit()
        return app_order

    def _load(self, reference) -> Member:
        member = self._from_snapshot(reference.get())
        member.app_grants = [
            AppGrant.model_validate(snapshot.to_dict()) for snapshot in reference.collection("appGrants").stream()
        ]
        return member

    @staticmethod
    def _from_snapshot(snapshot) -> Member:
        payload = snapshot.to_dict()
        if not payload:
            raise MemberNotFound(snapshot.id)
        return Member.model_validate(payload)

    @staticmethod
    def _audit_payload(actor_uid: str, action: str, target_uid: str, changes: dict) -> dict:
        return {
            "actorUid": actor_uid,
            "action": action,
            "targetUid": target_uid,
            "changes": changes,
            "createdAt": _now(),
        }
