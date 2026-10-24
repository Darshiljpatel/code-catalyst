"""Queue search must span pages while preserving tenant and assignment scope."""
from test_identity import setup, login
from test_review import brand, content


def test_queue_search_spans_pages_and_escapes_wildcards(setup):
    c, _, orgs, _ = setup
    bid, _ = brand(c, orgs)
    first, headers = content(c, orgs, bid)
    # Create more than a page of newer campaigns through the public API.
    for index in range(22):
        response = c.post('/api/v1/content', json=dict(
            brand_id=bid, title=f'Launch {index}', text='Approved draft.',
            channel='email', audience='Customers', purpose='Launch'), headers=headers)
        assert response.status_code == 201
    response = c.post('/api/v1/content', json=dict(
        brand_id=bid, title='Budget 50%_complete', text='Draft', channel='email',
        audience='Customers', purpose='Launch'), headers=headers)
    assert response.status_code == 201
    literal = response.json()
    assert first['id'] not in {row['id'] for row in c.get('/api/v1/content').json()['items']}
    found = c.get('/api/v1/content', params={'q':'  TRIAL campaign  '}).json()
    assert found['total'] == 1 and found['items'][0]['id'] == first['id']
    assert c.get('/api/v1/content', params={'q':first['id']}).json()['total'] == 1
    found = c.get('/api/v1/content', params={'q':'%_'}).json()
    assert found['total'] == 1 and found['items'][0]['id'] == literal['id']
    page = c.get('/api/v1/content', params={'q':'Launch','offset':20}).json()
    assert page['total'] == 22 and len(page['items']) == 2
    assert c.get('/api/v1/content', params={'q':'Launch','state':'approved'}).json()['total'] == 0
    # Same-tenant reviewer has no assignments and must not find creator drafts.
    login(c, orgs[0], 'reviewer')
    assert c.get('/api/v1/content', params={'q':'Launch'}).json()['total'] == 0
    login(c, orgs[0], 'manager')
    assert c.get('/api/v1/content', params={'q':'Launch'}).json()['total'] == 22
    assert c.get('/api/v1/content', params={'q':'x'*201}).status_code == 422
