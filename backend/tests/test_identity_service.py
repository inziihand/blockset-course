from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone

import pytest

from stratexec.identity.models import (
    AppAccessMode,
    AppEntitlement,
    AppGrant,
    AppGrantPatch,
    AppCategory,
    AppInstallation,
    AppInstallationPatch,
    AppInstallationStatus,
    AppLifecycleAction,
    AppOrderPatch,
    AppPolicy,
    AppPolicyPatch,
    IdentityPrincipal,
    Member,
    MemberPatch,
    MemberRole,
    MemberStatus,
    SourceAppActivation,
    VerifiedAppActivation,
)
from stratexec.identity.service import AccessDenied, IdentityService, MemberNotFound


class FakeVerifier:
    def __init__(self, principal: IdentityPrincipal) -> None:
        self.principal = principal

    def verify(self, token: str) -> IdentityPrincipal:
        if token != "valid-token":
            raise ValueError("bad token")
        return self.principal


class FakeClaims:
    def __init__(self) -> None:
        self.values: dict[str, bool] = {}

    def set_admin(self, uid: str, *, enabled: bool) -> None:
        self.values[uid] = enabled


class FakeRepository:
    def __init__(self) -> None:
        self.members: dict[str, Member] = {}
        self.policies: dict[str, AppPolicy] = {
            "premium-course": AppPolicy(
                app_key="premium-course",
                display_name="付費課程",
                access_mode=AppAccessMode.GRANT_REQUIRED,
                allowed_access_modes=[
                    AppAccessMode.ALL_MEMBERS,
                    AppAccessMode.GRANT_REQUIRED,
                    AppAccessMode.ADMINS_ONLY,
                    AppAccessMode.DISABLED,
                ],
                entitlements=[AppEntitlement(
                    key="course",
                    display_name="課程學員功能",
                    description="解鎖課程模板與進階分析。",
                )],
            ),
            "access-control": AppPolicy(
                app_key="access-control",
                display_name="會員與權限",
                access_mode=AppAccessMode.ADMINS_ONLY,
                protected=True,
            ),
        }
        self.installations: dict[str, AppInstallation] = {
            "premium-course": AppInstallation(
                app_key="premium-course",
                display_name="付費課程",
                category=AppCategory.APPLICATION,
                required_services=["course-content-api"],
                deployment_job_id="00000000-0000-4000-8000-000000000000",
                runtime_revision="course-content-api-00001",
                runtime_verified_at=datetime(2026, 9, 17, tzinfo=timezone.utc),
            ),
            "access-control": AppInstallation(
                app_key="access-control",
                display_name="會員與權限",
                category=AppCategory.CORE,
                removable=False,
                protected=True,
                required_services=["identity-api"],
            ),
        }
        self.app_order: list[str] = []

    def synchronize(self, principal: IdentityPrincipal, *, bootstrap_admin: bool) -> Member:
        member = self.members.get(principal.uid)
        if member is None:
            member = Member(
                **principal.model_dump(),
                role=MemberRole.ADMIN if bootstrap_admin else MemberRole.MEMBER,
            )
            self.members[principal.uid] = member
        else:
            member.email = principal.email
            member.last_login_at = member.updated_at
        return deepcopy(member)

    def get(self, uid: str) -> Member | None:
        return deepcopy(self.members.get(uid))

    def list(self, *, limit: int = 100) -> list[Member]:
        return deepcopy(list(self.members.values())[:limit])

    def list_page(self, *, limit: int = 20, cursor: str | None = None) -> tuple[list[Member], str | None]:
        member_ids = sorted(self.members)
        if cursor is not None:
            if cursor not in self.members:
                raise ValueError("Invalid member page cursor.")
            member_ids = member_ids[member_ids.index(cursor) + 1:]
        page_ids = member_ids[:limit]
        next_cursor = page_ids[-1] if len(member_ids) > limit and page_ids else None
        return deepcopy([self.members[uid] for uid in page_ids]), next_cursor

    def update(self, uid: str, patch: MemberPatch, *, actor_uid: str) -> Member:
        if uid not in self.members:
            raise MemberNotFound(uid)
        member = self.members[uid]
        for key, value in patch.model_dump(exclude_none=True).items():
            setattr(member, key, value)
        return deepcopy(member)

    def set_app_grant(self, uid: str, grant: AppGrant, *, actor_uid: str) -> Member:
        if uid not in self.members:
            raise MemberNotFound(uid)
        member = self.members[uid]
        member.app_grants = [current for current in member.app_grants if current.app_key != grant.app_key]
        member.app_grants.append(grant)
        return deepcopy(member)

    def list_enabled_app_keys(self) -> list[str]:
        return [
            item.app_key for item in self.installations.values()
            if item.status is AppInstallationStatus.INSTALLED
        ]

    def list_app_policies(self) -> list[AppPolicy]:
        return deepcopy(list(self.policies.values()))

    def set_app_policy(self, policy: AppPolicy, *, actor_uid: str) -> AppPolicy:
        self.policies[policy.app_key] = deepcopy(policy)
        return deepcopy(policy)

    def list_app_installations(self) -> list[AppInstallation]:
        return deepcopy(list(self.installations.values()))

    def set_app_installation(self, installation: AppInstallation, *, actor_uid: str) -> AppInstallation:
        self.installations[installation.app_key] = deepcopy(installation)
        return deepcopy(installation)

    def get_app_order(self) -> list[str]:
        return list(self.app_order)

    def set_app_order(self, app_keys: list[str], *, actor_uid: str) -> list[str]:
        self.app_order = list(app_keys)
        return list(self.app_order)


def principal(uid: str = "user-1", email: str = "member@example.com") -> IdentityPrincipal:
    return IdentityPrincipal(
        uid=uid,
        email=email,
        provider="google.com",
        email_verified=True,
    )


def test_first_login_creates_member_without_admin_privilege() -> None:
    repository = FakeRepository()
    claims = FakeClaims()
    service = IdentityService(FakeVerifier(principal()), repository, claims)

    member = service.authenticate("valid-token")

    assert member.role is MemberRole.MEMBER
    assert member.status is MemberStatus.ACTIVE
    assert claims.values == {"user-1": False}


def test_server_only_bootstrap_list_promotes_matching_first_login() -> None:
    repository = FakeRepository()
    claims = FakeClaims()
    service = IdentityService(
        FakeVerifier(principal(email="ADMIN@example.com")),
        repository,
        claims,
        bootstrap_admin_emails=["admin@example.com"],
    )

    member = service.authenticate("valid-token")

    assert member.role is MemberRole.ADMIN
    assert claims.values[member.uid] is True


def test_existing_member_is_not_promoted_when_bootstrap_setting_changes() -> None:
    repository = FakeRepository()
    repository.members["user-1"] = Member(
        uid="user-1",
        email="admin@example.com",
        email_verified=True,
        role=MemberRole.MEMBER,
    )
    service = IdentityService(
        FakeVerifier(principal(email="admin@example.com")),
        repository,
        FakeClaims(),
        bootstrap_admin_emails=["admin@example.com"],
    )

    assert service.authenticate("valid-token").role is MemberRole.MEMBER


def test_member_cannot_change_another_members_access() -> None:
    service = IdentityService(FakeVerifier(principal()), FakeRepository(), FakeClaims())
    actor = Member(uid="member-1", email="member@example.com")

    with pytest.raises(AccessDenied):
        service.update_member(actor, "member-2", MemberPatch(status=MemberStatus.DISABLED))


def test_admin_lists_members_with_a_forward_cursor() -> None:
    repository = FakeRepository()
    repository.members = {
        uid: Member(uid=uid, email=f"{uid}@example.com")
        for uid in ("member-1", "member-2", "member-3")
    }
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    first_page = service.list_members(actor, limit=2)
    second_page = service.list_members(actor, limit=2, cursor=first_page.next_cursor)

    assert [member.uid for member in first_page.members] == ["member-1", "member-2"]
    assert first_page.next_cursor == "member-2"
    assert [member.uid for member in second_page.members] == ["member-3"]
    assert second_page.next_cursor is None


def test_admin_can_assign_an_app_specific_grant() -> None:
    repository = FakeRepository()
    repository.members["member-1"] = Member(uid="member-1", email="member@example.com")
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    updated = service.set_app_grant(
        actor,
        "member-1",
        "premium-course",
        AppGrantPatch(enabled=True, roles=["viewer"], entitlements=["course"]),
    )

    assert updated.app_grants[0].app_key == "premium-course"
    assert updated.app_grants[0].roles == ["viewer"]
    assert updated.app_grants[0].entitlements == ["course"]
    access = next(item for item in updated.app_access if item.app_key == "premium-course")
    assert access.allowed is True
    assert access.reason == "active_grant"
    assert access.entitlements == ["course"]


def test_app_grant_rejects_an_entitlement_not_declared_by_the_app() -> None:
    repository = FakeRepository()
    repository.members["member-1"] = Member(uid="member-1", email="member@example.com")
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    with pytest.raises(ValueError, match="Unknown App entitlements"):
        service.set_app_grant(
            actor,
            "member-1",
            "premium-course",
            AppGrantPatch(enabled=True, entitlements=["not-declared"]),
        )


def test_removed_entitlement_is_not_returned_from_a_stale_grant() -> None:
    repository = FakeRepository()
    repository.policies["premium-course"] = repository.policies["premium-course"].model_copy(
        update={"entitlements": []}
    )
    repository.members["user-1"] = Member(
        uid="user-1",
        email="member@example.com",
        app_grants=[AppGrant(
            app_key="premium-course",
            enabled=True,
            entitlements=["course"],
        )],
    )
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())

    member = service.authenticate("valid-token")
    access = next(item for item in member.app_access if item.app_key == "premium-course")

    assert access.allowed is True
    assert access.entitlements == []


def test_grant_required_app_denies_an_active_member_without_a_grant() -> None:
    repository = FakeRepository()
    repository.members["user-1"] = Member(uid="user-1", email="member@example.com")
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())

    member = service.authenticate("valid-token")

    access = next(item for item in member.app_access if item.app_key == "premium-course")
    assert access.allowed is False
    assert access.reason == "grant_required"


def test_role_policy_can_open_an_app_to_all_active_members() -> None:
    repository = FakeRepository()
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    updated = service.set_app_policy(
        actor,
        "premium-course",
        AppPolicyPatch(access_mode=AppAccessMode.ALL_MEMBERS, admin_allowed=True),
    )

    assert updated.access_mode is AppAccessMode.ALL_MEMBERS
    member = service.authenticate("valid-token")
    access = next(item for item in member.app_access if item.app_key == "premium-course")
    assert access.allowed is True
    assert access.reason == "all_members"
    assert access.entitlements == []


def test_platform_admin_can_change_a_legacy_single_mode_app_policy() -> None:
    repository = FakeRepository()
    repository.policies["premium-course"] = repository.policies["premium-course"].model_copy(
        update={"allowed_access_modes": [AppAccessMode.GRANT_REQUIRED]}
    )
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    listed = next(item for item in service.list_app_policies(actor) if item.app_key == "premium-course")
    assert listed.allowed_access_modes == [
        AppAccessMode.PUBLIC,
        AppAccessMode.ALL_MEMBERS,
        AppAccessMode.GRANT_REQUIRED,
    ]

    updated = service.set_app_policy(
        actor,
        "premium-course",
        AppPolicyPatch(access_mode=AppAccessMode.PUBLIC, admin_allowed=True),
    )

    assert updated.access_mode is AppAccessMode.PUBLIC
    assert updated.allowed_access_modes == listed.allowed_access_modes


def test_open_app_can_grant_a_member_an_optional_feature_entitlement() -> None:
    repository = FakeRepository()
    repository.policies["premium-course"] = repository.policies["premium-course"].model_copy(
        update={"access_mode": AppAccessMode.ALL_MEMBERS}
    )
    repository.members["member-1"] = Member(uid="member-1", email="member@example.com")
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    before = service.authenticate("valid-token")
    before_access = next(item for item in before.app_access if item.app_key == "premium-course")
    assert before_access.allowed is True
    assert before_access.entitlements == []

    updated = service.set_app_grant(
        actor,
        "member-1",
        "premium-course",
        AppGrantPatch(enabled=True, entitlements=["course"]),
    )
    access = next(item for item in updated.app_access if item.app_key == "premium-course")
    assert access.allowed is True
    assert access.reason == "all_members"
    assert access.entitlements == ["course"]


def test_app_administrator_receives_all_declared_entitlements() -> None:
    repository = FakeRepository()
    repository.members["admin-1"] = Member(
        uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN
    )
    service = IdentityService(
        FakeVerifier(principal(uid="admin-1", email="admin@example.com")),
        repository,
        FakeClaims(),
    )

    member = service.authenticate("valid-token")
    access = next(item for item in member.app_access if item.app_key == "premium-course")
    assert access.allowed is True
    assert access.entitlements == ["course"]


def test_public_app_administrator_receives_all_declared_entitlements() -> None:
    repository = FakeRepository()
    repository.policies["premium-course"] = repository.policies["premium-course"].model_copy(
        update={"access_mode": AppAccessMode.PUBLIC}
    )
    repository.members["admin-1"] = Member(
        uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN
    )
    service = IdentityService(
        FakeVerifier(principal(uid="admin-1", email="admin@example.com")),
        repository,
        FakeClaims(),
    )

    member = service.authenticate("valid-token")
    access = next(item for item in member.app_access if item.app_key == "premium-course")

    assert access.allowed is True
    assert access.reason == "admin_policy"
    assert access.entitlements == ["course"]


def test_protected_access_app_cannot_be_opened_to_members() -> None:
    service = IdentityService(FakeVerifier(principal()), FakeRepository(), FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    with pytest.raises(AccessDenied):
        service.set_app_policy(
            actor,
            "access-control",
            AppPolicyPatch(access_mode=AppAccessMode.ALL_MEMBERS, admin_allowed=True),
        )


def test_general_app_policy_rejects_a_system_only_mode() -> None:
    service = IdentityService(FakeVerifier(principal()), FakeRepository(), FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    with pytest.raises(ValueError, match="not managed by the platform"):
        service.set_app_policy(
            actor,
            "premium-course",
            AppPolicyPatch(access_mode=AppAccessMode.ADMINS_ONLY, admin_allowed=True),
        )


def test_last_active_administrator_cannot_be_disabled() -> None:
    repository = FakeRepository()
    repository.members["admin-1"] = Member(
        uid="admin-1",
        email="admin@example.com",
        role=MemberRole.ADMIN,
    )
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = deepcopy(repository.members["admin-1"])

    with pytest.raises(AccessDenied, match="last active administrator"):
        service.update_member(actor, "admin-1", MemberPatch(status=MemberStatus.DISABLED))


def test_unknown_app_grant_is_rejected() -> None:
    repository = FakeRepository()
    repository.members["member-1"] = Member(uid="member-1", email="member@example.com")
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    with pytest.raises(ValueError, match="Unknown or disabled"):
        service.set_app_grant(actor, "member-1", "not-installed", AppGrantPatch(enabled=True))


def test_backend_app_requires_verified_deployment_before_reinstall() -> None:
    repository = FakeRepository()
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    disabled = service.update_app_installation(
        actor,
        "premium-course",
        AppInstallationPatch(action=AppLifecycleAction.DISABLE),
    )
    assert disabled.status is AppInstallationStatus.DISABLED
    assert "premium-course" not in service.list_installed_app_keys()

    uninstalled = service.update_app_installation(
        actor,
        "premium-course",
        AppInstallationPatch(action=AppLifecycleAction.UNINSTALL),
    )
    assert uninstalled.status is AppInstallationStatus.UNINSTALLED

    with pytest.raises(AccessDenied, match="verified Deployment Agent"):
        service.update_app_installation(
            actor,
            "premium-course",
            AppInstallationPatch(action=AppLifecycleAction.INSTALL),
        )

    installed = service.activate_verified_app(actor, "premium-course", VerifiedAppActivation(
        display_name="付費課程",
        category=AppCategory.APPLICATION,
        required_services=["course-content-api"],
        allowed_access_modes=[
            AppAccessMode.ALL_MEMBERS,
            AppAccessMode.GRANT_REQUIRED,
            AppAccessMode.ADMINS_ONLY,
            AppAccessMode.DISABLED,
        ],
        entitlements=[AppEntitlement(key="course", display_name="新版課程功能")],
        deployment_job_id="00000000-0000-4000-8000-000000000000",
        plan_fingerprint="a" * 64,
        runtime_revision="course-content-api-00001",
        verified_at=datetime.now(timezone.utc),
    ))
    assert installed.status is AppInstallationStatus.INSTALLED
    assert installed.runtime_revision == "course-content-api-00001"
    assert installed.deployment_job_id == "00000000-0000-4000-8000-000000000000"
    assert repository.policies["premium-course"].access_mode is AppAccessMode.GRANT_REQUIRED
    assert repository.policies["premium-course"].entitlements[0].display_name == "新版課程功能"


def test_source_installed_frontend_app_is_registered_without_runtime_evidence() -> None:
    repository = FakeRepository()
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    installed = service.activate_source_app(actor, "options-strategy-lab", SourceAppActivation(
        display_name="選擇權策略分析",
        category=AppCategory.APPLICATION,
        default_access_mode=AppAccessMode.GRANT_REQUIRED,
        allowed_access_modes=[AppAccessMode.GRANT_REQUIRED],
    ))

    assert installed.status is AppInstallationStatus.INSTALLED
    assert installed.required_services == []
    assert installed.runtime_revision is None
    assert repository.policies["options-strategy-lab"].access_mode is AppAccessMode.GRANT_REQUIRED
    assert repository.policies["options-strategy-lab"].allowed_access_modes == [
        AppAccessMode.PUBLIC,
        AppAccessMode.ALL_MEMBERS,
        AppAccessMode.GRANT_REQUIRED,
    ]
    assert "options-strategy-lab" in service.list_installed_app_keys()


def test_public_catalog_exposes_current_policy_and_fails_closed_without_one() -> None:
    repository = FakeRepository()
    repository.installations["orphan-app"] = AppInstallation(
        app_key="orphan-app",
        display_name="缺少政策的 App",
    )
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())

    catalog = {item.app_key: item.access_mode for item in service.list_installed_app_catalog()}

    assert catalog["premium-course"] is AppAccessMode.GRANT_REQUIRED
    assert catalog["access-control"] is AppAccessMode.ADMINS_ONLY
    assert catalog["orphan-app"] is AppAccessMode.DISABLED


def test_admin_app_order_is_shared_with_the_public_catalog() -> None:
    repository = FakeRepository()
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    installations = service.set_app_order(actor, AppOrderPatch(
        app_keys=["premium-course", "access-control"],
    ))

    assert [item.app_key for item in installations] == ["premium-course", "access-control"]
    assert [item.app_key for item in service.list_app_installations(actor)] == [
        "premium-course", "access-control",
    ]
    assert [item.app_key for item in service.list_installed_app_catalog()] == [
        "premium-course", "access-control",
    ]


def test_admin_app_order_requires_every_registered_app_once() -> None:
    repository = FakeRepository()
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    with pytest.raises(ValueError, match="every registered App exactly once"):
        service.set_app_order(actor, AppOrderPatch(app_keys=["access-control"]))

    with pytest.raises(ValueError, match="duplicate"):
        service.set_app_order(actor, AppOrderPatch(
            app_keys=["access-control", "access-control"],
        ))


def test_installed_backend_app_without_runtime_evidence_is_not_available() -> None:
    repository = FakeRepository()
    repository.installations["premium-course"] = repository.installations["premium-course"].model_copy(
        update={"deployment_job_id": None, "runtime_revision": None, "runtime_verified_at": None}
    )
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())

    member = service.authenticate("valid-token")

    access = next(item for item in member.app_access if item.app_key == "premium-course")
    assert access.allowed is False
    assert access.reason == "app_runtime_unverified"
    assert "premium-course" not in service.list_installed_app_keys()


def test_verified_activation_rejects_duplicate_entitlement_keys_before_installation_write() -> None:
    repository = FakeRepository()
    service = IdentityService(FakeVerifier(principal()), repository, FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    with pytest.raises(ValueError, match="must be unique"):
        service.activate_verified_app(actor, "new-course", VerifiedAppActivation(
            display_name="新課程",
            category=AppCategory.APPLICATION,
            required_services=["course-content-api"],
            entitlements=[
                AppEntitlement(key="course", display_name="課程功能"),
                AppEntitlement(key="course", display_name="重複課程功能"),
            ],
            deployment_job_id="00000000-0000-4000-8000-000000000000",
            plan_fingerprint="a" * 64,
            runtime_revision="course-content-api-00001",
            verified_at=datetime.now(timezone.utc),
        ))

    assert "new-course" not in repository.installations


def test_protected_access_control_app_cannot_change_lifecycle() -> None:
    service = IdentityService(FakeVerifier(principal()), FakeRepository(), FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    with pytest.raises(AccessDenied, match="Protected"):
        service.update_app_installation(
            actor,
            "access-control",
            AppInstallationPatch(action=AppLifecycleAction.DISABLE),
        )


def test_active_admin_can_manage_existing_or_new_app_deployment_but_not_protected_core() -> None:
    service = IdentityService(FakeVerifier(principal()), FakeRepository(), FakeClaims())
    actor = Member(uid="admin-1", email="admin@example.com", role=MemberRole.ADMIN)

    existing = service.authorize_deployment(actor, "premium-course")
    new_app = service.authorize_deployment(actor, "new-course-app")
    protected = service.authorize_deployment(actor, "access-control")

    assert existing.allowed is True
    assert existing.app_state == "installed"
    assert new_app.allowed is True
    assert new_app.app_state == "new"
    assert new_app.permissions == ["deployment:manage"]
    assert protected.allowed is False
    assert protected.reason == "protected_platform_app"


def test_member_cannot_receive_deployment_permission() -> None:
    service = IdentityService(FakeVerifier(principal()), FakeRepository(), FakeClaims())
    actor = Member(uid="member-1", email="member@example.com")

    with pytest.raises(AccessDenied):
        service.authorize_deployment(actor, "new-course-app")


def test_unverified_or_non_google_identity_is_rejected() -> None:
    unverified = principal()
    unverified.email_verified = False
    service = IdentityService(FakeVerifier(unverified), FakeRepository(), FakeClaims())
    with pytest.raises(AccessDenied):
        service.authenticate("valid-token")
