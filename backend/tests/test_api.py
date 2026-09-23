import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import uuid
import json

from main import app
from database import SessionLocal, Base, engine, Session

# Setup a test database
Base.metadata.create_all(bind=engine)

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@patch("main.genai.upload_file")
def test_upload_files(mock_upload_file, setup_db):
    # Mock genai file upload
    mock_file = MagicMock()
    mock_file.uri = "mock://uri"
    mock_file.name = "mock_file_name"
    mock_upload_file.return_value = mock_file

    # Create a dummy pdf file
    files = {'files': ('test.pdf', b'dummy content', 'application/pdf')}
    
    response = client.post("/api/session/upload", files=files)
    
    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data
    
    # Assert session is in DB
    db = SessionLocal()
    session = db.query(Session).filter(Session.id == data["session_id"]).first()
    assert session is not None
    assert len(session.uploaded_files) == 1
    assert session.uploaded_files[0].gemini_file_name == "mock_file_name"
    db.close()

@patch("main.genai.GenerativeModel")
def test_generate_review(mock_generative_model, setup_db):
    # Create a session with files directly in DB
    db = SessionLocal()
    session_id = str(uuid.uuid4())
    from database import Session as DBSessionModel, UploadedFile
    db.add(DBSessionModel(id=session_id))
    db.add(UploadedFile(id=str(uuid.uuid4()), session_id=session_id, filename="test.pdf", gemini_file_name="mock_file", gemini_file_uri="mock://uri"))
    db.commit()
    db.close()

    # Mock the chat session and stream response
    mock_model = MagicMock()
    mock_chat_session = MagicMock()
    
    # A mock chunk that looks like what Gemini yields
    mock_chunk1 = MagicMock()
    mock_chunk1.text = "Mock review chunk 1."
    
    mock_chunk2 = MagicMock()
    mock_chunk2.text = "Mock review chunk 2."
    
    # We must mock response.function_call to be False or None
    mock_response = MagicMock()
    mock_response.__iter__.return_value = [mock_chunk1, mock_chunk2]
    mock_response.function_call = None
    
    mock_chat_session.send_message.return_value = mock_response
    mock_model.start_chat.return_value = mock_chat_session
    mock_generative_model.return_value = mock_model
    
    # Mock genai.get_file
    with patch("main.genai.get_file") as mock_get_file:
        mock_get_file.return_value = MagicMock()
        
        response = client.get(f"/api/session/review?session_id={session_id}")
        
        assert response.status_code == 200
        content = response.content.decode("utf-8")
        
        # Check if SSE stream has correct chunks
        assert "data: " in content
        assert "Mock review chunk 1" in content
        assert "Mock review chunk 2" in content
        assert "Complete" in content

@patch("main.genai.GenerativeModel")
def test_chat(mock_generative_model, setup_db):
    # Create a session with files directly in DB
    db = SessionLocal()
    session_id = str(uuid.uuid4())
    from database import Session as DBSessionModel, UploadedFile
    db.add(DBSessionModel(id=session_id))
    db.add(UploadedFile(id=str(uuid.uuid4()), session_id=session_id, filename="test.pdf", gemini_file_name="mock_file", gemini_file_uri="mock://uri"))
    db.commit()
    db.close()

    # Mock the chat session and stream response
    mock_model = MagicMock()
    mock_chat_session = MagicMock()
    mock_chat_session.history = []
    
    mock_chunk = MagicMock()
    mock_chunk.text = "Chat response chunk."
    
    mock_response = MagicMock()
    mock_response.__iter__.return_value = [mock_chunk]
    mock_response.function_call = None
    
    mock_chat_session.send_message.return_value = mock_response
    mock_model.start_chat.return_value = mock_chat_session
    mock_generative_model.return_value = mock_model

    with patch("main.genai.get_file") as mock_get_file:
        mock_get_file.return_value = MagicMock()
        
        response = client.post(f"/api/session/chat?session_id={session_id}&message=Hello")
        
        assert response.status_code == 200
        content = response.content.decode("utf-8")
        
        assert "Chat response chunk." in content
        
        # Assert message was saved
        db = SessionLocal()
        session = db.query(DBSessionModel).filter(DBSessionModel.id == session_id).first()
        assert len(session.chat_messages) == 2 # 1 user, 1 assistant
        assert session.chat_messages[0].role == "user"
        assert session.chat_messages[1].role == "model"
        db.close()
