def test_environment_loads():
    import pydantic
    import PIL
    import pypdf
    import docx
    assert int(pydantic.__version__.split(".")[0]) >= 2
