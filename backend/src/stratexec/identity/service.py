from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
import logging

from .models import (
    AppAccessMode,
    AppInstallation,
    AppInstallationPatch,
    AppInstallationStatus,
    AppOrderPatch,
    InstalledAppCatalogEntry,
    AppLifecycleAction,
    AppGrant,
    AppGrantPatch,
    AppPolicy,
    AppPolicyPatch,
    DeploymentAccess,
    EffectiveAppAccess,
    Member,
    MemberList,
    MemberPatch,
    MemberRole,
    MemberStatus,
    SourceAppActivation,
    VerifiedAppActivation,
)
from .ports import ClaimsWriter, MemberRepository, TokenVerifier


_LOGGER = logging.getLogger(__name__)


class IdentityError(Exception):
    """Base identity-domain error."""


class InvalidIdentity(IdentityError):
    pass


class AccessDenied(IdentityError):
    pass


class MemberNotFound(IdentityError):
    pass


class IdentityService:
    PROTECTED_ACCESS_APP = "access-control"

    def __init__(
        self,
        verifier: TokenVerifier,
        repository: MemberRepository,
        claims: ClaimsWriter,
        *,
        bootstrap_admin_emails: Iterable[str] = (),
    ) -> None:
        self._verifier = verifier
        self._repository = repository
        self._claims = claims
        self._bootstrap_admin_emails = {email.strip().lower() for email in bootstrap_admin_emails if email.strip()}

    def authenticate(self, token: str) -> Member:
        try:
            principal = self._verifier.verify(token)
        except Exception as exc:
            # Keep bearer tokens and decoded claims out of logs while retaining
            # the verifier's exception class for deployment diagnostics.
            _LOGGER.warning("Firebase ID token verification failed (%s).", type(exc).__name__)
            raise InvalidIdentity("Firebase ID token is invalid.") from exc
        if not principal.email_verified or principal.provider != "google.com":
            raise AccessDenied("A verified Google account is required.")
        bootstrap_admin = principal.email.lower() in self._bootstrap_admin_emails
        member = self._repository.synchronize(principal, bootstrap_admin=bootstrap_admin)
        if member.status is not MemberStatus.ACTIVE:
            raise AccessDenied("Member access is disabled.")
        self._claims.set_admin(member.uid, enabled=member.role is MemberRole.ADMIN)
        return self._with_effective_access(member)

    def list_members(self, actor: Member, *, limit: int = 20, cursor: str | None = None) -> MemberList:
        self._require_admin(actor)
        if limit < 1 or limit > 50:
            raise ValueError("Member page size must be between 1 and 50.")
        members, next_cursor = self._repository.list_page(limit=limit, cursor=cursor)
        return MemberList(
            members=[self._with_effective_access(member) for member in members],
            next_cursor=next_cursor,
        )

    def update_member(self, actor: Member, uid: str, patch: MemberPatch) -> Member:
        self._require_admin(actor)
        current = self._repository.get(uid)
        if current is None:
            raise MemberNotFound(uid)
        removes_active_admin = (
            current.role is MemberRole.ADMIN
            and current.status is MemberStatus.ACTIVE
            and (
                patch.role is MemberRole.MEMBER
                or patch.status is MemberStatus.DISABLED
            )
        )
        if removes_active_admin:
            active_admins = [
                member for member in self._repository.list()
                if member.role is MemberRole.ADMIN and member.status is MemberStatus.ACTIVE
            ]
            if len(active_admins) <= 1:
                raise AccessDenied("The last active administrator cannot be disabled or demoted.")
        member = self._repository.update(uid, patch, actor_uid=actor.uid)
        self._claims.set_admin(uid, enabled=member.role is MemberRole.ADMIN)
        return self._with_effective_access(member)

    def set_app_grant(self, actor: Member, uid: str, app_key: str, patch: AppGrantPatch) -> Member:
        self._require_admin(actor)
        self._require_enabled_app(app_key)
        if app_key == self.PROTECTED_ACCESS_APP:
            raise AccessDenied("The protected access-control App cannot use member grants.")
        if patch.valid_from and patch.valid_until and patch.valid_until <= patch.valid_from:
            raise ValueError("App grant validUntil must be later than validFrom.")
        policy = next(
            (item for item in self._repository.list_app_policies() if item.app_key == app_key),
            None,
        )
        declared_entitlements = {item.key for item in policy.entitlements} if policy else set()
        requested_entitlements = list(dict.fromkeys(patch.entitlements))
        unknown_entitlements = sorted(set(requested_entitlements) - declared_entitlements)
        if unknown_entitlements:
            raise ValueError(f"Unknown App entitlements: {', '.join(unknown_entitlements)}.")
        grant = AppGrant(
            app_key=app_key,
            enabled=patch.enabled,
            roles=patch.roles,
            entitlements=requested_entitlements,
            source=patch.source,
            product_key=patch.product_key,
            valid_from=patch.valid_from,
            valid_until=patch.valid_until,
            updated_by=actor.uid,
        )
        member = self._repository.set_app_grant(uid, grant, actor_uid=actor.uid)
        return self._with_effective_access(member)

    def list_app_policies(self, actor: Member) -> list[AppPolicy]:
        self._require_admin(actor)
        return [self._with_declared_modes(policy) for policy in self._repository.list_app_policies()]

    def list_installed_app_keys(self) -> list[str]:
        return [item.app_key for item in self.list_installed_app_catalog()]

    def list_installed_app_catalog(self) -> list[InstalledAppCatalogEntry]:
        policies = {policy.app_key: policy for policy in self._repository.list_app_policies()}
        return [
            InstalledAppCatalogEntry(
                app_key=installation.app_key,
                access_mode=(
                    policies[installation.app_key].access_mode
                    if installation.app_key in policies
                    else AppAccessMode.DISABLED
                ),
            )
            for installation in self._ordered_installations()
            if self._installation_is_available(installation)
        ]

    def list_app_installations(self, actor: Member) -> list[AppInstallation]:
        self._require_admin(actor)
        return self._ordered_installations()

    def set_app_order(self, actor: Member, patch: AppOrderPatch) -> list[AppInstallation]:
        self._require_admin(actor)
        installations = self._repository.list_app_installations()
        current_keys = {installation.app_key for installation in installations}
        requested_keys = patch.app_keys
        if len(requested_keys) != len(set(requested_keys)):
            raise ValueError("App order must not contain duplicate keys.")
        if set(requested_keys) != current_keys:
            raise ValueError("App order must contain every registered App exactly once.")
        self._repository.set_app_order(requested_keys, actor_uid=actor.uid)
        by_key = {installation.app_key: installation for installation in installations}
        return [by_key[app_key] for app_key in requested_keys]

    def _ordered_installations(self) -> list[AppInstallation]:
        installations = self._repository.list_app_installations()
        by_key = {installation.app_key: installation for installation in installations}
        ordered_keys: list[str] = []
        for app_key in self._repository.get_app_order():
            if app_key in by_key and app_key not in ordered_keys:
                ordered_keys.append(app_key)
        ordered_keys.extend(
            installation.app_key
            for installation in sorted(installations, key=lambda item: item.app_key)
            if installation.app_key not in ordered_keys
        )
        return [by_key[app_key] for app_key in ordered_keys]

    def authorize_deployment(self, actor: Member, app_key: str) -> DeploymentAccess:
        self._require_admin(actor)
        self._validate_app_key(app_key)
        installation = next(
            (item for item in self._repository.list_app_installations() if item.app_key == app_key),
            None,
        )
        if installation and (installation.protected or app_key == self.PROTECTED_ACCESS_APP):
            return DeploymentAccess(
                app_key=app_key,
                allowed=False,
                reason="protected_platform_app",
                app_state=installation.status.value,
                permissions=[],
            )
        return DeploymentAccess(
            app_key=app_key,
            allowed=True,
            reason="active_admin_new_app" if installation is None else "active_admin_app_manager",
            app_state="new" if installation is None else installation.status.value,
            permissions=["deployment:manage"],
        )

    def update_app_installation(
        self,
        actor: Member,
        app_key: str,
        patch: AppInstallationPatch,
    ) -> AppInstallation:
        self._require_admin(actor)
        self._validate_app_key(app_key)
        installation = next(
            (item for item in self._repository.list_app_installations() if item.app_key == app_key),
            None,
        )
        if installation is None:
            raise ValueError("Unknown App key.")
        if installation.protected or app_key == self.PROTECTED_ACCESS_APP:
            raise AccessDenied("Protected platform Apps cannot change installation state.")
        if (
            patch.action in {AppLifecycleAction.INSTALL, AppLifecycleAction.ENABLE}
            and installation.required_services
        ):
            raise AccessDenied(
                "Apps with backend services require verified Deployment Agent activation."
            )
        transitions = {
            AppLifecycleAction.INSTALL: ({AppInstallationStatus.UNINSTALLED}, AppInstallationStatus.INSTALLED),
            AppLifecycleAction.DISABLE: ({AppInstallationStatus.INSTALLED}, AppInstallationStatus.DISABLED),
            AppLifecycleAction.ENABLE: ({AppInstallationStatus.DISABLED}, AppInstallationStatus.INSTALLED),
            AppLifecycleAction.UNINSTALL: (
                {AppInstallationStatus.INSTALLED, AppInstallationStatus.DISABLED},
                AppInstallationStatus.UNINSTALLED,
            ),
        }
        allowed_from, next_status = transitions[patch.action]
        if installation.status not in allowed_from:
            raise ValueError(f"Cannot {patch.action.value} an App in {installation.status.value} state.")
        if patch.action is AppLifecycleAction.UNINSTALL and not installation.removable:
            raise AccessDenied("This App is not removable.")
        updated = installation.model_copy(
            update={
                "status": next_status,
                "updated_at": datetime.now(timezone.utc),
                "updated_by": actor.uid,
            }
        )
        return self._repository.set_app_installation(updated, actor_uid=actor.uid)

    def activate_verified_app(
        self,
        actor: Member,
        app_key: str,
        activation: VerifiedAppActivation,
    ) -> AppInstallation:
        """Register or re-enable an App only from immutable deployment evidence."""
        self._require_admin(actor)
        self._validate_app_key(app_key)
        if activation.protected or app_key == self.PROTECTED_ACCESS_APP:
            raise AccessDenied("Protected platform Apps cannot be registered by Deployment Agent.")
        if not all(character in "0123456789abcdef" for character in activation.plan_fingerprint):
            raise ValueError("Invalid deployment plan fingerprint.")
        if not activation.required_services:
            raise ValueError("Verified activation is reserved for Apps with backend services.")
        if activation.verified_at > datetime.now(timezone.utc):
            raise ValueError("Deployment verification time cannot be in the future.")
        allowed_access_modes = self._validated_declared_modes(
            activation.default_access_mode,
            activation.allowed_access_modes,
            activation.admin_allowed,
        )
        entitlement_keys = [item.key for item in activation.entitlements]
        if len(entitlement_keys) != len(set(entitlement_keys)):
            raise ValueError("App entitlement keys must be unique.")
        current = next(
            (item for item in self._repository.list_app_installations() if item.app_key == app_key),
            None,
        )
        if current and current.protected:
            raise AccessDenied("Protected platform Apps cannot change installation state.")
        existing_policy = next(
            (policy for policy in self._repository.list_app_policies() if policy.app_key == app_key),
            None,
        )
        updated = AppInstallation(
            app_key=app_key,
            display_name=activation.display_name,
            status=AppInstallationStatus.INSTALLED,
            category=activation.category,
            removable=activation.removable,
            protected=False,
            required_services=activation.required_services,
            deployment_job_id=activation.deployment_job_id,
            runtime_revision=activation.runtime_revision,
            runtime_verified_at=activation.verified_at,
            updated_at=datetime.now(timezone.utc),
            updated_by=actor.uid,
        )
        installed = self._repository.set_app_installation(updated, actor_uid=actor.uid)
        if existing_policy is None:
            policy = AppPolicy(
                app_key=app_key,
                display_name=activation.display_name,
                access_mode=activation.default_access_mode,
                allowed_access_modes=allowed_access_modes,
                entitlements=activation.entitlements,
                admin_allowed=activation.admin_allowed,
                protected=False,
                updated_by=actor.uid,
            )
        else:
            access_mode = (
                existing_policy.access_mode
                if existing_policy.access_mode in allowed_access_modes
                else activation.default_access_mode
            )
            policy = existing_policy.model_copy(update={
                "display_name": activation.display_name,
                "access_mode": access_mode,
                "allowed_access_modes": allowed_access_modes,
                "entitlements": activation.entitlements,
                "admin_allowed": True if access_mode is AppAccessMode.ADMINS_ONLY else existing_policy.admin_allowed,
                "updated_at": datetime.now(timezone.utc),
                "updated_by": actor.uid,
            })
        self._repository.set_app_policy(policy, actor_uid=actor.uid)
        return installed

    def activate_source_app(
        self,
        actor: Member,
        app_key: str,
        activation: SourceAppActivation,
    ) -> AppInstallation:
        """Register a verified source-installed App that has no backend services."""
        self._require_admin(actor)
        self._validate_app_key(app_key)
        if activation.protected or app_key == self.PROTECTED_ACCESS_APP:
            raise AccessDenied("Protected platform Apps cannot be registered by Package Agent.")
        allowed_access_modes = self._validated_declared_modes(
            activation.default_access_mode,
            activation.allowed_access_modes,
            activation.admin_allowed,
        )
        entitlement_keys = [item.key for item in activation.entitlements]
        if len(entitlement_keys) != len(set(entitlement_keys)):
            raise ValueError("App entitlement keys must be unique.")
        current = next(
            (item for item in self._repository.list_app_installations() if item.app_key == app_key),
            None,
        )
        if current and current.protected:
            raise AccessDenied("Protected platform Apps cannot change installation state.")
        existing_policy = next(
            (policy for policy in self._repository.list_app_policies() if policy.app_key == app_key),
            None,
        )
        updated = AppInstallation(
            app_key=app_key,
            display_name=activation.display_name,
            status=AppInstallationStatus.INSTALLED,
            category=activation.category,
            removable=activation.removable,
            protected=False,
            required_services=[],
            updated_at=datetime.now(timezone.utc),
            updated_by=actor.uid,
        )
        installed = self._repository.set_app_installation(updated, actor_uid=actor.uid)
        if existing_policy is None:
            policy = AppPolicy(
                app_key=app_key,
                display_name=activation.display_name,
                access_mode=activation.default_access_mode,
                allowed_access_modes=allowed_access_modes,
                entitlements=activation.entitlements,
                admin_allowed=activation.admin_allowed,
                protected=False,
                updated_by=actor.uid,
            )
        else:
            access_mode = (
                existing_policy.access_mode
                if existing_policy.access_mode in allowed_access_modes
                else activation.default_access_mode
            )
            policy = existing_policy.model_copy(update={
                "display_name": activation.display_name,
                "access_mode": access_mode,
                "allowed_access_modes": allowed_access_modes,
                "entitlements": activation.entitlements,
                "admin_allowed": True if access_mode is AppAccessMode.ADMINS_ONLY else existing_policy.admin_allowed,
                "updated_at": datetime.now(timezone.utc),
                "updated_by": actor.uid,
            })
        self._repository.set_app_policy(policy, actor_uid=actor.uid)
        return installed

    def set_app_policy(
        self,
        actor: Member,
        app_key: str,
        patch: AppPolicyPatch,
    ) -> AppPolicy:
        self._require_admin(actor)
        self._require_enabled_app(app_key)
        existing = next(
            (policy for policy in self._repository.list_app_policies() if policy.app_key == app_key),
            AppPolicy(app_key=app_key, display_name=app_key),
        )
        protected = app_key == self.PROTECTED_ACCESS_APP or existing.protected
        if protected and (
            patch.access_mode is not AppAccessMode.ADMINS_ONLY or not patch.admin_allowed
        ):
            raise AccessDenied("Protected platform Apps must remain available to administrators only.")
        allowed_access_modes = (
            [AppAccessMode.ADMINS_ONLY]
            if protected
            else self._with_platform_access_modes(existing.allowed_access_modes)
        )
        if patch.access_mode not in allowed_access_modes:
            raise ValueError("The requested access mode is not declared by this App.")
        if patch.access_mode is AppAccessMode.ADMINS_ONLY and not patch.admin_allowed:
            raise ValueError("Administrator-only App access must remain available to administrators.")
        policy = existing.model_copy(
            update={
                "access_mode": patch.access_mode,
                "allowed_access_modes": allowed_access_modes,
                "admin_allowed": patch.admin_allowed,
                "protected": protected,
                "updated_at": datetime.now(timezone.utc),
                "updated_by": actor.uid,
            }
        )
        return self._repository.set_app_policy(policy, actor_uid=actor.uid)

    @staticmethod
    def _validated_declared_modes(
        default: AppAccessMode,
        declared: list[AppAccessMode],
        admin_allowed: bool,
    ) -> list[AppAccessMode]:
        modes = list(dict.fromkeys(declared))
        if default not in modes:
            raise ValueError("Default App access mode must be included in allowed access modes.")
        if default is AppAccessMode.ADMINS_ONLY and not admin_allowed:
            raise ValueError("Administrator-only App access must remain available to administrators.")
        return IdentityService._with_platform_access_modes(modes)

    @staticmethod
    def _with_platform_access_modes(declared: list[AppAccessMode]) -> list[AppAccessMode]:
        return list(dict.fromkeys([*declared, AppAccessMode.ADMINS_ONLY]))

    def _with_declared_modes(self, policy: AppPolicy) -> AppPolicy:
        protected = policy.protected or policy.app_key == self.PROTECTED_ACCESS_APP
        allowed_access_modes = (
            [AppAccessMode.ADMINS_ONLY]
            if protected
            else self._with_platform_access_modes(policy.allowed_access_modes)
        )
        return policy.model_copy(update={
            "allowed_access_modes": allowed_access_modes,
            "admin_allowed": True if protected else policy.admin_allowed,
            "protected": protected,
        })

    def _with_effective_access(self, member: Member) -> Member:
        policies = self._repository.list_app_policies()
        installations = {item.app_key: item for item in self._repository.list_app_installations()}
        resolved = [
            self._resolve_access(member, policy, installations.get(policy.app_key))
            for policy in policies
        ]
        return member.model_copy(update={"app_access": resolved})

    def _resolve_access(
        self,
        member: Member,
        policy: AppPolicy,
        installation: AppInstallation | None = None,
    ) -> EffectiveAppAccess:
        if member.status is not MemberStatus.ACTIVE:
            return EffectiveAppAccess(app_key=policy.app_key, allowed=False, reason="member_disabled")
        if installation and installation.status is AppInstallationStatus.UNINSTALLED:
            return EffectiveAppAccess(app_key=policy.app_key, allowed=False, reason="app_uninstalled")
        if installation and installation.status is AppInstallationStatus.DISABLED:
            return EffectiveAppAccess(app_key=policy.app_key, allowed=False, reason="app_lifecycle_disabled")
        if installation and not self._installation_is_available(installation):
            return EffectiveAppAccess(app_key=policy.app_key, allowed=False, reason="app_runtime_unverified")
        if policy.app_key == self.PROTECTED_ACCESS_APP:
            allowed = member.role is MemberRole.ADMIN
            return EffectiveAppAccess(
                app_key=policy.app_key,
                allowed=allowed,
                reason="protected_admin" if allowed else "admin_required",
            )
        grant = next((grant for grant in member.app_grants if grant.app_key == policy.app_key), None)
        active_grant = grant if grant and self._grant_is_active(grant) else None
        declared_entitlements = {item.key for item in policy.entitlements}
        effective_entitlements = (
            [key for key in active_grant.entitlements if key in declared_entitlements]
            if active_grant else []
        )
        if policy.access_mode is AppAccessMode.DISABLED:
            return EffectiveAppAccess(app_key=policy.app_key, allowed=False, reason="app_disabled")
        if member.role is MemberRole.ADMIN and policy.admin_allowed:
            return EffectiveAppAccess(
                app_key=policy.app_key,
                allowed=True,
                reason="admin_policy",
                entitlements=[item.key for item in policy.entitlements],
            )
        if policy.access_mode is AppAccessMode.PUBLIC:
            return EffectiveAppAccess(
                app_key=policy.app_key,
                allowed=True,
                reason="public",
                entitlements=effective_entitlements,
            )
        if policy.access_mode is AppAccessMode.ADMINS_ONLY:
            return EffectiveAppAccess(app_key=policy.app_key, allowed=False, reason="admin_required")
        if policy.access_mode is AppAccessMode.ALL_MEMBERS:
            return EffectiveAppAccess(
                app_key=policy.app_key,
                allowed=True,
                reason="all_members",
                entitlements=effective_entitlements,
            )
        if active_grant:
            return EffectiveAppAccess(
                app_key=policy.app_key,
                allowed=True,
                reason="active_grant",
                entitlements=effective_entitlements,
            )
        return EffectiveAppAccess(app_key=policy.app_key, allowed=False, reason="grant_required")

    @staticmethod
    def _grant_is_active(grant: AppGrant) -> bool:
        if not grant.enabled:
            return False
        now = datetime.now(timezone.utc)
        if grant.valid_from and grant.valid_from > now:
            return False
        return not grant.valid_until or grant.valid_until > now

    def _require_enabled_app(self, app_key: str) -> None:
        self._validate_app_key(app_key)
        installation = next(
            (item for item in self._repository.list_app_installations() if item.app_key == app_key),
            None,
        )
        if not installation or not self._installation_is_available(installation):
            raise ValueError("Unknown or disabled App key.")

    @staticmethod
    def _installation_is_available(installation: AppInstallation) -> bool:
        if installation.status is not AppInstallationStatus.INSTALLED:
            return False
        if installation.protected:
            return True
        return not installation.required_services or bool(
            installation.deployment_job_id
            and installation.runtime_revision
            and installation.runtime_verified_at
        )

    @staticmethod
    def _validate_app_key(app_key: str) -> None:
        if not app_key or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in app_key):
            raise ValueError("Invalid App key.")

    @staticmethod
    def _require_admin(member: Member) -> None:
        if member.status is not MemberStatus.ACTIVE or member.role is not MemberRole.ADMIN:
            raise AccessDenied("Administrator access is required.")
