import os
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from stratexec.adapters.firebase.auth import FirebaseClaimsWriter, FirebaseTokenVerifier, initialize_firebase
from stratexec.adapters.firebase.firestore_members import FirestoreMemberRepository
from stratexec.identity.models import (
    AppGrantPatch,
    AppInstallation,
    AppInstallationList,
    AppInstallationPatch,
    AppPolicy,
    AppPolicyList,
    AppPolicyPatch,
    DeploymentAccess,
    EffectiveAppAccess,
    Member,
    MemberList,
    MemberPatch,
    InstalledAppList,
    VerifiedAppActivation,
)
from stratexec.identity.service import AccessDenied, IdentityService, InvalidIdentity, MemberNotFound


_bearer = HTTPBearer(auto_error=False)


def _bearer_token(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token is required.")
    return credentials.credentials


def create_app(service: IdentityService | None = None) -> FastAPI:
    app = FastAPI(title="StratExec Platform Identity API", version="1.0.0")
    if service is None:
        initialize_firebase(project_id=os.getenv("GOOGLE_CLOUD_PROJECT"))
        admin_emails = os.getenv("STRATEXEC_BOOTSTRAP_ADMIN_EMAILS", "").split(",")
        service = IdentityService(
            FirebaseTokenVerifier(),
            FirestoreMemberRepository(),
            FirebaseClaimsWriter(),
            bootstrap_admin_emails=admin_emails,
        )
    app.state.identity_service = service

    def authenticated_member(request: Request, token: Annotated[str, Depends(_bearer_token)]) -> Member:
        identity: IdentityService = request.app.state.identity_service
        try:
            return identity.authenticate(token)
        except InvalidIdentity as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @app.get("/healthz", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/identity/v1/apps", response_model=InstalledAppList, response_model_by_alias=True)
    def list_installed_apps(request: Request) -> InstalledAppList:
        return InstalledAppList(app_keys=request.app.state.identity_service.list_installed_app_keys())

    @app.post("/api/identity/v1/session", response_model=Member, response_model_by_alias=True)
    def synchronize_session(member: Annotated[Member, Depends(authenticated_member)]) -> Member:
        return member

    @app.get("/api/identity/v1/me", response_model=Member, response_model_by_alias=True)
    def get_me(member: Annotated[Member, Depends(authenticated_member)]) -> Member:
        return member

    @app.get(
        "/api/identity/v1/access/{app_key}",
        response_model=EffectiveAppAccess,
        response_model_by_alias=True,
    )
    def get_app_access(
        app_key: str,
        member: Annotated[Member, Depends(authenticated_member)],
    ) -> EffectiveAppAccess:
        access = next((item for item in member.app_access if item.app_key == app_key), None)
        if access is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown or disabled App key.")
        return access

    @app.get("/api/identity/v1/admin/members", response_model=MemberList, response_model_by_alias=True)
    def list_members(request: Request, actor: Annotated[Member, Depends(authenticated_member)]) -> MemberList:
        try:
            return MemberList(members=request.app.state.identity_service.list_members(actor))
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @app.get(
        "/api/identity/v1/admin/deployment-access/{app_key}",
        response_model=DeploymentAccess,
        response_model_by_alias=True,
    )
    def get_deployment_access(
        app_key: str,
        request: Request,
        actor: Annotated[Member, Depends(authenticated_member)],
    ) -> DeploymentAccess:
        try:
            return request.app.state.identity_service.authorize_deployment(actor, app_key)
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    @app.patch("/api/identity/v1/admin/members/{uid}", response_model=Member, response_model_by_alias=True)
    def update_member(
        uid: str,
        patch: MemberPatch,
        request: Request,
        actor: Annotated[Member, Depends(authenticated_member)],
    ) -> Member:
        try:
            return request.app.state.identity_service.update_member(actor, uid, patch)
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except MemberNotFound as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.") from exc

    @app.put(
        "/api/identity/v1/admin/members/{uid}/app-grants/{app_key}",
        response_model=Member,
        response_model_by_alias=True,
    )
    def set_app_grant(
        uid: str,
        app_key: str,
        patch: AppGrantPatch,
        request: Request,
        actor: Annotated[Member, Depends(authenticated_member)],
    ) -> Member:
        try:
            return request.app.state.identity_service.set_app_grant(actor, uid, app_key, patch)
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except MemberNotFound as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    @app.get(
        "/api/identity/v1/admin/app-policies",
        response_model=AppPolicyList,
        response_model_by_alias=True,
    )
    def list_app_policies(
        request: Request,
        actor: Annotated[Member, Depends(authenticated_member)],
    ) -> AppPolicyList:
        try:
            return AppPolicyList(policies=request.app.state.identity_service.list_app_policies(actor))
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @app.put(
        "/api/identity/v1/admin/app-policies/{app_key}",
        response_model=AppPolicy,
        response_model_by_alias=True,
    )
    def set_app_policy(
        app_key: str,
        patch: AppPolicyPatch,
        request: Request,
        actor: Annotated[Member, Depends(authenticated_member)],
    ) -> AppPolicy:
        try:
            return request.app.state.identity_service.set_app_policy(actor, app_key, patch)
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    @app.get(
        "/api/identity/v1/admin/app-installations",
        response_model=AppInstallationList,
        response_model_by_alias=True,
    )
    def list_app_installations(
        request: Request,
        actor: Annotated[Member, Depends(authenticated_member)],
    ) -> AppInstallationList:
        try:
            return AppInstallationList(
                installations=request.app.state.identity_service.list_app_installations(actor)
            )
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @app.put(
        "/api/identity/v1/admin/app-installations/{app_key}",
        response_model=AppInstallation,
        response_model_by_alias=True,
    )
    def update_app_installation(
        app_key: str,
        patch: AppInstallationPatch,
        request: Request,
        actor: Annotated[Member, Depends(authenticated_member)],
    ) -> AppInstallation:
        try:
            return request.app.state.identity_service.update_app_installation(actor, app_key, patch)
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    @app.post(
        "/api/identity/v1/admin/app-installations/{app_key}/verified-activation",
        response_model=AppInstallation,
        response_model_by_alias=True,
    )
    def activate_verified_app(
        app_key: str,
        activation: VerifiedAppActivation,
        request: Request,
        actor: Annotated[Member, Depends(authenticated_member)],
    ) -> AppInstallation:
        try:
            return request.app.state.identity_service.activate_verified_app(actor, app_key, activation)
        except AccessDenied as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return app
