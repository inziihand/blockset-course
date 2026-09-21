from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class MemberRole(StrEnum):
    MEMBER = "member"
    ADMIN = "admin"


class MemberStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class AppAccessMode(StrEnum):
    PUBLIC = "public"
    ALL_MEMBERS = "all_members"
    GRANT_REQUIRED = "grant_required"
    ADMINS_ONLY = "admins_only"
    DISABLED = "disabled"


class AppInstallationStatus(StrEnum):
    INSTALLED = "installed"
    DISABLED = "disabled"
    UNINSTALLED = "uninstalled"


class AppLifecycleAction(StrEnum):
    INSTALL = "install"
    DISABLE = "disable"
    ENABLE = "enable"
    UNINSTALL = "uninstall"


class AppCategory(StrEnum):
    CORE = "core"
    SAMPLE = "sample"
    APPLICATION = "application"


class AppGrantSource(StrEnum):
    MANUAL = "manual"
    PURCHASE = "purchase"
    MIGRATION = "migration"
    PROMOTION = "promotion"


class AppEntitlement(ApiModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9-]*$", max_length=64)
    display_name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, min_length=1, max_length=256)


class IdentityPrincipal(ApiModel):
    uid: str
    email: str
    display_name: str | None = None
    photo_url: str | None = None
    provider: str = "google.com"
    email_verified: bool = False


class AppGrant(ApiModel):
    app_key: str
    enabled: bool = True
    roles: list[str] = Field(default_factory=list)
    entitlements: list[str] = Field(default_factory=list)
    source: AppGrantSource = AppGrantSource.MANUAL
    product_key: str | None = Field(default=None, max_length=128)
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_by: str | None = None


class AppPolicy(ApiModel):
    app_key: str
    display_name: str
    access_mode: AppAccessMode = AppAccessMode.ADMINS_ONLY
    allowed_access_modes: list[AppAccessMode] = Field(default_factory=lambda: [AppAccessMode.ADMINS_ONLY])
    entitlements: list[AppEntitlement] = Field(default_factory=list)
    admin_allowed: bool = True
    protected: bool = False
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_by: str | None = None


class AppInstallation(ApiModel):
    app_key: str
    display_name: str
    status: AppInstallationStatus = AppInstallationStatus.INSTALLED
    category: AppCategory = AppCategory.APPLICATION
    removable: bool = True
    protected: bool = False
    required_services: list[str] = Field(default_factory=list)
    deployment_job_id: str | None = None
    runtime_revision: str | None = None
    runtime_verified_at: datetime | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_by: str | None = None


class EffectiveAppAccess(ApiModel):
    app_key: str
    allowed: bool
    reason: str
    entitlements: list[str] = Field(default_factory=list)


class DeploymentAccess(ApiModel):
    app_key: str
    allowed: bool
    reason: str
    app_state: str
    permissions: list[str] = Field(default_factory=list)


class Member(ApiModel):
    uid: str
    email: str
    display_name: str | None = None
    photo_url: str | None = None
    provider: str = "google.com"
    email_verified: bool = False
    role: MemberRole = MemberRole.MEMBER
    status: MemberStatus = MemberStatus.ACTIVE
    plan: str = "free"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    app_grants: list[AppGrant] = Field(default_factory=list)
    app_access: list[EffectiveAppAccess] = Field(default_factory=list)


class MemberPatch(ApiModel):
    role: MemberRole | None = None
    status: MemberStatus | None = None
    plan: str | None = Field(default=None, min_length=1, max_length=64)


class AppGrantPatch(ApiModel):
    enabled: bool
    roles: list[str] = Field(default_factory=list, max_length=32)
    entitlements: list[str] = Field(default_factory=list, max_length=32)
    source: AppGrantSource = AppGrantSource.MANUAL
    product_key: str | None = Field(default=None, max_length=128)
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class AppPolicyPatch(ApiModel):
    access_mode: AppAccessMode
    admin_allowed: bool = True


class AppInstallationPatch(ApiModel):
    action: AppLifecycleAction


class SourceAppActivation(ApiModel):
    display_name: str = Field(min_length=1, max_length=128)
    category: AppCategory = AppCategory.APPLICATION
    removable: bool = True
    protected: bool = False
    default_access_mode: AppAccessMode = AppAccessMode.ADMINS_ONLY
    allowed_access_modes: list[AppAccessMode] = Field(default_factory=lambda: [AppAccessMode.ADMINS_ONLY])
    entitlements: list[AppEntitlement] = Field(default_factory=list, max_length=32)
    admin_allowed: bool = True


class VerifiedAppActivation(ApiModel):
    display_name: str = Field(min_length=1, max_length=128)
    category: AppCategory = AppCategory.APPLICATION
    removable: bool = True
    protected: bool = False
    required_services: list[str] = Field(default_factory=list, max_length=64)
    default_access_mode: AppAccessMode = AppAccessMode.ADMINS_ONLY
    allowed_access_modes: list[AppAccessMode] = Field(default_factory=lambda: [AppAccessMode.ADMINS_ONLY])
    entitlements: list[AppEntitlement] = Field(default_factory=list, max_length=32)
    admin_allowed: bool = True
    deployment_job_id: str = Field(min_length=36, max_length=36)
    plan_fingerprint: str = Field(min_length=64, max_length=64)
    runtime_revision: str = Field(min_length=1, max_length=256)
    verified_at: datetime


class MemberList(ApiModel):
    members: list[Member]


class AppPolicyList(ApiModel):
    policies: list[AppPolicy]


class AppInstallationList(ApiModel):
    installations: list[AppInstallation]


class InstalledAppCatalogEntry(ApiModel):
    app_key: str
    access_mode: AppAccessMode


class InstalledAppList(ApiModel):
    app_keys: list[str]
    apps: list[InstalledAppCatalogEntry]
