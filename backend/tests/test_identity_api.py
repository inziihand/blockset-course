from fastapi.testclient import TestClient

from stratexec.api.identity_app import create_app
from stratexec.identity.models import (
    AppAccessMode,
    AppCategory,
    AppInstallation,
    EffectiveAppAccess,
    InstalledAppCatalogEntry,
    Member,
)


class StubIdentityService:
    def authenticate(self, token: str) -> Member:
        assert token == "valid-token"
        return Member(
            uid="member-1",
            email="member@example.com",
            email_verified=True,
            app_access=[EffectiveAppAccess(
                app_key="course-app",
                allowed=True,
                reason="active_grant",
                entitlements=["course"],
            )],
        )

    def list_installed_app_keys(self) -> list[str]:
        return ["access-control", "course-app"]

    def list_installed_app_catalog(self) -> list[InstalledAppCatalogEntry]:
        return [
            InstalledAppCatalogEntry(app_key="access-control", access_mode=AppAccessMode.ADMINS_ONLY),
            InstalledAppCatalogEntry(app_key="course-app", access_mode=AppAccessMode.GRANT_REQUIRED),
        ]


class StubDeploymentIdentityService(StubIdentityService):
    def authenticate(self, token: str) -> Member:
        member = super().authenticate(token)
        member.role = "admin"
        return member

    def authorize_deployment(self, actor: Member, app_key: str):
        from stratexec.identity.models import DeploymentAccess

        return DeploymentAccess(
            app_key=app_key,
            allowed=True,
            reason="active_admin_new_app",
            app_state="new",
            permissions=["deployment:manage"],
        )

    def set_app_order(self, actor: Member, patch):
        return [AppInstallation(
            app_key=app_key,
            display_name=app_key,
            category=AppCategory.CORE if app_key == "access-control" else AppCategory.APPLICATION,
        ) for app_key in patch.app_keys]


def test_me_requires_a_bearer_token() -> None:
    client = TestClient(create_app(StubIdentityService()))

    response = client.get("/api/identity/v1/me")

    assert response.status_code == 401


def test_installed_app_catalog_is_available_before_login() -> None:
    client = TestClient(create_app(StubIdentityService()))

    response = client.get("/api/identity/v1/apps")

    assert response.status_code == 200
    assert response.json() == {
        "appKeys": ["access-control", "course-app"],
        "apps": [
            {"appKey": "access-control", "accessMode": "admins_only"},
            {"appKey": "course-app", "accessMode": "grant_required"},
        ],
    }


def test_me_returns_the_server_owned_member_shape() -> None:
    client = TestClient(create_app(StubIdentityService()))

    response = client.get("/api/identity/v1/me", headers={"Authorization": "Bearer valid-token"})

    assert response.status_code == 200
    assert response.json()["uid"] == "member-1"
    assert response.json()["role"] == "member"


def test_app_access_returns_the_server_resolved_decision() -> None:
    client = TestClient(create_app(StubIdentityService()))

    response = client.get(
        "/api/identity/v1/access/course-app",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "appKey": "course-app",
        "allowed": True,
        "reason": "active_grant",
        "entitlements": ["course"],
    }


def test_unknown_app_access_fails_closed() -> None:
    client = TestClient(create_app(StubIdentityService()))

    response = client.get(
        "/api/identity/v1/access/not-installed",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 404


def test_deployment_access_supports_a_new_app_without_treating_it_as_member_access() -> None:
    client = TestClient(create_app(StubDeploymentIdentityService()))

    response = client.get(
        "/api/identity/v1/admin/deployment-access/new-course-app",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "appKey": "new-course-app",
        "allowed": True,
        "reason": "active_admin_new_app",
        "appState": "new",
        "permissions": ["deployment:manage"],
    }


def test_admin_can_persist_the_complete_app_order() -> None:
    client = TestClient(create_app(StubDeploymentIdentityService()))

    response = client.put(
        "/api/identity/v1/admin/app-order",
        headers={"Authorization": "Bearer valid-token"},
        json={"appKeys": ["course-app", "access-control"]},
    )

    assert response.status_code == 200
    assert [item["appKey"] for item in response.json()["installations"]] == [
        "course-app", "access-control",
    ]
