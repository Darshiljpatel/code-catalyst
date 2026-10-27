from pathlib import Path


def test_worker_is_a_separate_supervised_service():
    blueprint = Path('render.yaml').read_text(encoding='utf-8')
    assert '- type: worker' in blueprint and 'infra/Dockerfile.worker' in blueprint
    assert '- type: web' in blueprint and 'healthCheckPath: /api/v1/health/ready' in blueprint
    assert 'preDeployCommand:' in blueprint and 'upgrade head' in blueprint
    assert 'TRUST_PROXY_HEADERS' in blueprint
    assert 'sync: false' in blueprint and 'NEBIUS_API_KEY\n        value' not in blueprint


def test_api_image_no_longer_backgrounds_an_unsupervised_worker():
    api = Path('infra/Dockerfile.api').read_text(encoding='utf-8')
    assert 'uvicorn brandguard.main:create_app' in api
    entrypoint = Path('infra/entrypoint.sh').read_text(encoding='utf-8')
    assert 'python -m apps.worker --interval 1 &' not in entrypoint
    assert 'EMBEDDED_WORKER' in entrypoint
