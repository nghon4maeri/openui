import pytest
from unittest.mock import MagicMock
from tools.academic_tools import search_arxiv, search_semantic_scholar, critique_methodology

def test_search_arxiv(mocker):
    # Mock urllib.request.urlopen
    mock_urlopen = mocker.patch("urllib.request.urlopen")
    
    # Create a mock response
    mock_response = MagicMock()
    mock_response.read.return_value = b'''<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Mock Paper Title</title>
        <summary>This is a mock summary.</summary>
        <published>2023-01-01T00:00:00Z</published>
        <author><name>John Doe</name></author>
      </entry>
    </feed>
    '''
    # We mock __enter__ for context manager usage
    mock_urlopen.return_value.__enter__.return_value = mock_response

    result = search_arxiv("machine learning")
    
    assert "Mock Paper Title" in result
    assert "John Doe" in result
    assert "mock summary" in result

def test_search_semantic_scholar(mocker):
    # Mock requests.get
    mock_get = mocker.patch("requests.get")
    
    # Create a mock response
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "data": [
            {
                "title": "Mock Semantic Paper",
                "year": 2024,
                "citationCount": 42,
                "abstract": "A mock abstract.",
                "authors": [{"name": "Jane Smith"}]
            }
        ]
    }
    mock_get.return_value = mock_response
    
    result = search_semantic_scholar("some query")
    
    assert "Mock Semantic Paper" in result
    assert "Jane Smith" in result
    assert "42" in result

def test_critique_methodology():
    result = critique_methodology("We trained a random forest on 10 samples.")
    assert "random forest on 10 samples" in result
    assert "Methodology Evaluation Criteria" in result
