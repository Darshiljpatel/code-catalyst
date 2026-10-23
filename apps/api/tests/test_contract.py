"""Published contract must match the API the frontend will actually call."""
import json
from pathlib import Path
from brandguard.main import create_app, Settings


def test_committed_openapi_matches_application():
    app = create_app(Settings('postgresql+psycopg://localhost/brandguard'))
    expected = json.loads((Path(__file__).resolve().parents[3] / 'contracts/openapi.json').read_text())
    try:
        assert app.openapi() == expected
    finally:
        app.state.engine.dispose()
