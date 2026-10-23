import os
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from .core import Settings, Problem, NewBrand, db, identity, manager, passwords, digest
from .models import Brand
from .auth import router as auth_router

def create_app(settings=None):
    settings = settings or Settings(os.environ['DATABASE_URL'], os.getenv('PUBLIC_ORIGIN', 'http://localhost:8000'), os.getenv('APP_ENV', 'development'))
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()
    app = FastAPI(title='BrandGuard API', version='0.2.0', lifespan=lifespan)
    app.state.engine = engine
    app.state.settings = settings
    @app.middleware('http')
    async def security(request, call_next):
        request.state.request_id = str(uuid.uuid4())
        response = await call_next(request)
        response.headers['X-Request-ID'] = request.state.request_id
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'no-store'
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

    @app.get('/api/v1/health/live')
    def live():
        return {'status': 'live', 'phase': 'S2'}

    @app.get('/api/v1/health/ready')
    def ready(session: Session = Depends(db)):
        try:
            revision = session.execute(text('select version_num from alembic_version')).scalar_one()
            if revision != '0002_review_foundation':
                raise ValueError('Unexpected schema')
        except Exception:
            raise Problem(503, 'not_ready', 'Database schema is not ready.')
        return {'status': 'ready', 'scope': 'S2 API/queue only; worker not implemented'}

    from .review import router as review_router
    app.include_router(auth_router)
    app.include_router(review_router)
    return app
