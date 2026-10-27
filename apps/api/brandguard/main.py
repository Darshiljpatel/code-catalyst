import os
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from .core import Settings, Problem, NewBrand, db, identity, manager, passwords, digest
from .models import Brand
from .auth import router as auth_router

def create_app(settings=None, provider_config=None):
    from .semantic import ProviderConfig
    if settings is None:
        from dotenv import load_dotenv
        from pathlib import Path
        load_dotenv(Path(__file__).resolve().parents[3] / '.env')
        provider_config = provider_config or ProviderConfig.from_env()
    settings = settings or Settings(os.environ['DATABASE_URL'], os.getenv('PUBLIC_ORIGIN', 'http://localhost:8000'), os.getenv('APP_ENV', 'development'), int(os.getenv('MODEL_DAILY_RUN_LIMIT', '100')), os.getenv('TRUST_PROXY_HEADERS', '') == '1')
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()
    app = FastAPI(title='BrandGuard API', version='0.5.0', lifespan=lifespan)
    app.state.engine = engine
    app.state.settings = settings
    app.state.provider_config = provider_config or ProviderConfig()
    @app.middleware('http')
    async def security(request, call_next):
        request.state.request_id = str(uuid.uuid4())
        response = await call_next(request)
        response.headers['X-Request-ID'] = request.state.request_id
        response.headers['X-Content-Type-Options'] = 'nosniff'
        # API data is never cached; image bytes opt in to private caching explicitly.
        response.headers.setdefault('Cache-Control', 'no-store')
        return response

    @app.exception_handler(Problem)
    async def problem(request, exc):
        return JSONResponse(status_code=exc.status, content=dict(code=exc.code, message=exc.message, request_id=request.state.request_id, details={}))

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        # Do not echo submitted passwords or confidential input through validation errors.
        return JSONResponse(status_code=422, content=dict(code='invalid_fields', message='Check the supplied fields.', request_id=request.state.request_id, details={}))

    @app.get('/api/v1/brands')
    def brands(member=Depends(identity), session: Session = Depends(db)):
        return [dict(id=b.id, name=b.name, source_epoch=b.source_epoch) for b in session.scalars(select(Brand).where(Brand.org_id == member.org_id))]

    @app.get('/api/v1/brands/{brand_id}')
    def brand(brand_id: str, member=Depends(identity), session: Session = Depends(db)):
        b = session.scalar(select(Brand).where(Brand.id == brand_id, Brand.org_id == member.org_id))
        if b is None:
            raise Problem(404, 'not_found', 'Brand not found.')
        return dict(id=b.id, name=b.name, source_epoch=b.source_epoch)

    @app.post('/api/v1/brands', status_code=201)
    def new_brand(body: NewBrand, member=Depends(manager), session: Session = Depends(db)):
        if not body.name.strip():
            raise Problem(422, 'invalid_fields', 'Brand name is required.')
        b = Brand(org_id=member.org_id, name=body.name.strip())
        session.add(b)
        session.commit()
        return dict(id=b.id, name=b.name, source_epoch=b.source_epoch)

    from .review import router as review_router
    from .policy import router as policy_router
    from .workflow import router as workflow_router
    from .governance import router as governance_router
    from .health import router as health_router
    from .rechecks import router as rechecks_router
    from .requests import router as requests_router
    from .images import router as images_router
    from .documents import router as documents_router
    from .demo import router as demo_router
    app.include_router(demo_router)
    app.include_router(images_router)
    app.include_router(documents_router)
    app.include_router(requests_router)
    app.include_router(rechecks_router)
    app.include_router(health_router)
    app.include_router(governance_router)
    app.include_router(workflow_router)
    app.include_router(policy_router)
    app.include_router(auth_router)
    app.include_router(review_router)
    return app
