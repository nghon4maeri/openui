import os
import uuid
import json
import asyncio
from typing import List, Dict, Any
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DBSession
from dotenv import load_dotenv
import google.generativeai as genai

from database import get_db, Session, UploadedFile, ChatMessage

# Load environment variables
load_dotenv()

# Initialize Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

app = FastAPI(title="Scientific Paper Review API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure temp directory exists
TEMP_DIR = "temp_papers"
os.makedirs(TEMP_DIR, exist_ok=True)

@app.post("/api/session/upload")
async def upload_files(files: List[UploadFile] = File(...), db: DBSession = Depends(get_db)):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured.")
        
    session_id = str(uuid.uuid4())
    
    # Create DB Session
    db_session = Session(id=session_id)
    db.add(db_session)
    db.commit()
    
    try:
        for file in files:
            temp_file_path = os.path.join(TEMP_DIR, f"{session_id}_{file.filename}")
            with open(temp_file_path, "wb") as f:
                content = await file.read()
                f.write(content)
            
            print(f"Uploading {file.filename} to Gemini...")
            genai_file = genai.upload_file(path=temp_file_path, display_name=file.filename)
            
            # Save to DB
            db_file = UploadedFile(
                id=str(uuid.uuid4()),
                session_id=session_id,
                filename=file.filename,
                gemini_file_uri=genai_file.uri,
                gemini_file_name=genai_file.name
            )
            db.add(db_file)
            
        db.commit()
        return {"session_id": session_id, "message": f"Successfully uploaded {len(files)} files."}
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

from tools.academic_tools import search_arxiv, search_semantic_scholar, critique_methodology

# Map function names to actual Python functions
available_tools = {
    "search_arxiv": search_arxiv,
    "search_semantic_scholar": search_semantic_scholar,
    "critique_methodology": critique_methodology
}

@app.get("/api/session/review")
async def generate_review(session_id: str, db: DBSession = Depends(get_db)):
    db_session = db.query(Session).filter(Session.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    if not db_session.uploaded_files:
        raise HTTPException(status_code=400, detail="No files uploaded for this session")

    try:
        model = genai.GenerativeModel(
            model_name='models/gemini-1.5-pro',
            tools=[search_arxiv, search_semantic_scholar, critique_methodology]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model initialization failed: {str(e)}")

    prompt = """
    Please act as an expert academic reviewer. Read the provided paper(s) and write a comprehensive peer-review.
    Format your response in Markdown with the following structure:
    
    ## Summary
    (Provide a concise summary of the paper's core contributions and objectives)
    
    ## Methodology Critique
    (Analyze the methodology, identifying potential flaws or areas of strength. USE the critique_methodology tool if helpful)
    
    ## Strengths & Weaknesses
    - **Strengths**: ...
    - **Weaknesses**: ...
    """

    contents = [prompt]
    for f in db_session.uploaded_files:
        try:
            genai_file = genai.get_file(f.gemini_file_name)
            contents.append(genai_file)
        except Exception as e:
            print(f"Warning: Could not retrieve file {f.gemini_file_name} from Gemini API. {e}")

    async def sse_generator():
        try:
            yield f"data: {json.dumps({'type': 'status', 'content': 'Initializing Gemini 1.5 Pro...'})}\n\n"
            await asyncio.sleep(0.1)
            
            yield f"data: {json.dumps({'type': 'status', 'content': 'Generating academic review...'})}\n\n"
            
            chat_session = model.start_chat()
            response = chat_session.send_message(contents, stream=True)
            
            while True:
                # Process the response chunk by chunk
                for chunk in response:
                    try:
                        if chunk.text:
                            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk.text})}\n\n"
                            await asyncio.sleep(0.01)
                    except ValueError:
                        # chunk.text raises ValueError if the chunk is a function_call
                        pass
                
                # Check if the model decided to call a function (tool)
                if response.function_call:
                    fc = response.function_call
                    func_name = fc.name
                    args = {key: val for key, val in fc.args.items()}
                    
                    yield f"data: {json.dumps({'type': 'status', 'content': f'Using tool: {func_name}...'})}\n\n"
                    
                    if func_name in available_tools:
                        func = available_tools[func_name]
                        try:
                            # Execute the tool
                            func_result = func(**args)
                        except Exception as e:
                            func_result = f"Error executing {func_name}: {str(e)}"
                    else:
                        func_result = f"Error: Tool {func_name} not found."
                    
                    # Send the tool result back to the model
                    response = chat_session.send_message(
                        genai.types.ContentDict(
                            parts=[genai.types.Part.from_function_response(name=func_name, response={"result": func_result})]
                        ),
                        stream=True
                    )
                else:
                    # No more function calls, we are done
                    break

            yield f"data: {json.dumps({'type': 'status', 'content': 'Complete'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            
    return StreamingResponse(sse_generator(), media_type="text/event-stream")

@app.post("/api/session/chat")
async def chat(session_id: str, message: str = "", db: DBSession = Depends(get_db)):
    db_session = db.query(Session).filter(Session.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
        
    try:
        model = genai.GenerativeModel(
            model_name='models/gemini-1.5-pro',
            tools=[search_arxiv, search_semantic_scholar, critique_methodology]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model initialization failed: {str(e)}")

    # Reconstruct history for Gemini
    history_for_gemini = []
    
    # If no history, first prompt needs context
    is_first_message = len(db_session.chat_messages) == 0
    
    if not is_first_message:
        # Load history from DB
        for msg in db_session.chat_messages:
            history_for_gemini.append({"role": msg.role, "parts": [msg.content]})
            
    chat_session = model.start_chat(history=history_for_gemini)
    
    contents = []
    if is_first_message:
        contents.append("You are an academic assistant. Please answer questions based on the following documents:")
        for f in db_session.uploaded_files:
            try:
                genai_file = genai.get_file(f.gemini_file_name)
                contents.append(genai_file)
            except Exception as e:
                pass
    contents.append(message)
    
    # Save user message to DB
    user_msg = ChatMessage(id=str(uuid.uuid4()), session_id=session_id, role="user", content=message)
    db.add(user_msg)
    db.commit()

    async def sse_generator():
        try:
            yield f"data: {json.dumps({'type': 'status', 'content': 'Generating response...'})}\n\n"
            
            response = chat_session.send_message(contents, stream=True)
            
            full_response = ""
            while True:
                for chunk in response:
                    try:
                        if chunk.text:
                            full_response += chunk.text
                            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk.text})}\n\n"
                            await asyncio.sleep(0.01)
                    except ValueError:
                        pass
                
                if response.function_call:
                    fc = response.function_call
                    func_name = fc.name
                    args = {key: val for key, val in fc.args.items()}
                    
                    yield f"data: {json.dumps({'type': 'status', 'content': f'Using tool: {func_name}...'})}\n\n"
                    
                    if func_name in available_tools:
                        func = available_tools[func_name]
                        try:
                            func_result = func(**args)
                        except Exception as e:
                            func_result = f"Error executing {func_name}: {str(e)}"
                    else:
                        func_result = f"Error: Tool {func_name} not found."
                    
                    response = chat_session.send_message(
                        genai.types.ContentDict(
                            parts=[genai.types.Part.from_function_response(name=func_name, response={"result": func_result})]
                        ),
                        stream=True
                    )
                else:
                    break
                    
            # Save assistant message to DB
            from database import SessionLocal
            with SessionLocal() as local_db:
                ai_msg = ChatMessage(id=str(uuid.uuid4()), session_id=session_id, role="model", content=full_response)
                local_db.add(ai_msg)
                local_db.commit()
                
            yield f"data: {json.dumps({'type': 'status', 'content': 'Idle'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            
    return StreamingResponse(sse_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
