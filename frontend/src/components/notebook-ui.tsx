"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import { UploadCloud, FileText, Loader2, Send, File, Plus, Activity } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface Message {
  role: "user" | "assistant"
  content: string
  status?: string // Used to show current tool being called by assistant
}

export function NotebookUI() {
  const [files, setFiles] = useState<File[]>([])
  const [activeFile, setActiveFile] = useState<File | null>(null)
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  
  // Status and Streaming state
  const [uploading, setUploading] = useState(false)
  const [globalStatus, setGlobalStatus] = useState("")
  
  // Auto-Review state
  const [review, setReview] = useState("")
  const [reviewStatus, setReviewStatus] = useState("")
  const [isGeneratingReview, setIsGeneratingReview] = useState(false)
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFiles((prev) => [...prev, ...acceptedFiles])
      
      // If this is the first file, set it as active
      if (!activeFile) {
        setActiveFile(acceptedFiles[0])
      }
      
      handleUpload(acceptedFiles)
    }
  }, [activeFile])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
    },
  })

  // Manage object URLs safely
  useEffect(() => {
    if (activeFile) {
      const url = URL.createObjectURL(activeFile)
      setActivePdfUrl(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setActivePdfUrl(null)
    }
  }, [activeFile])

  const handleUpload = async (newFiles: File[]) => {
    setUploading(true)
    setGlobalStatus("Uploading PDFs to server...")
    
    const formData = new FormData()
    newFiles.forEach((file) => formData.append("files", file))

    try {
      const response = await fetch(`${API_URL}/api/session/upload`, {
        method: "POST",
        body: formData,
      })
      
      if (!response.ok) throw new Error("Upload failed")
      
      const data = await response.json()
      setSessionId(data.session_id)
      setGlobalStatus("Session Ready")
    } catch (err: any) {
      setGlobalStatus(`Error: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  const handleGenerateReview = async () => {
    if (!sessionId) return
    
    setIsGeneratingReview(true)
    setReview("")
    setReviewStatus("Connecting to Gemini...")
    
    if (abortControllerRef.current) abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()
    
    try {
      const response = await fetch(`${API_URL}/api/session/review?session_id=${sessionId}`, {
        signal: abortControllerRef.current.signal,
      })
      
      if (!response.ok) throw new Error("Failed to start review generation")
      
      const reader = response.body?.getReader()
      if (!reader) throw new Error("No reader available")
      
      const decoder = new TextDecoder()
      let done = false
      
      while (!done) {
        const { value, done: doneReading } = await reader.read()
        done = doneReading
        if (value) {
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split("\n")
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === "status") {
                  setReviewStatus(data.content)
                } else if (data.type === "chunk") {
                  setReview((prev) => prev + data.content)
                } else if (data.type === "error") {
                  setReviewStatus(`Error: ${data.content}`)
                }
              } catch (e) {}
            }
          }
        }
      }
      setReviewStatus("")
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setReviewStatus(`Error: ${err.message}`)
      }
    } finally {
      setIsGeneratingReview(false)
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !sessionId) return

    const userMsg = input
    setInput("")
    
    // Add user message and a placeholder for assistant
    setMessages((prev) => [
      ...prev, 
      { role: "user", content: userMsg },
      { role: "assistant", content: "", status: "Initializing..." }
    ])
    
    setIsTyping(true)
    
    if (abortControllerRef.current) abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()

    try {
      const response = await fetch(`${API_URL}/api/session/chat?session_id=${sessionId}&message=${encodeURIComponent(userMsg)}`, {
        method: "POST",
        signal: abortControllerRef.current.signal,
      })
      
      if (!response.ok) throw new Error("Failed to send message")
      
      const reader = response.body?.getReader()
      if (!reader) throw new Error("No reader available")
      
      const decoder = new TextDecoder()
      let done = false
      
      while (!done) {
        const { value, done: doneReading } = await reader.read()
        done = doneReading
        if (value) {
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split("\n")
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === "status") {
                  // Update the status of the last message
                  setMessages((prev) => {
                    const newMsgs = [...prev]
                    const lastMsg = newMsgs[newMsgs.length - 1]
                    if (lastMsg.role === "assistant") {
                      lastMsg.status = data.content === "Idle" ? undefined : data.content
                    }
                    return newMsgs
                  })
                } else if (data.type === "chunk") {
                  // Append content to the last message
                  setMessages((prev) => {
                    const newMsgs = [...prev]
                    const lastMsg = newMsgs[newMsgs.length - 1]
                    if (lastMsg.role === "assistant") {
                      lastMsg.content += data.content
                    }
                    return newMsgs
                  })
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) => {
          const newMsgs = [...prev]
          const lastMsg = newMsgs[newMsgs.length - 1]
          if (lastMsg.role === "assistant") {
            lastMsg.status = `Error: ${err.message}`
          }
          return newMsgs
        })
      }
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      
      {/* Left Sidebar: Source Management */}
      <div className="w-72 bg-white border-r border-slate-200 flex flex-col shadow-sm z-10">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Sources</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                isDragActive ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-slate-400"
              }`}
            >
              <input {...getInputProps()} />
              <UploadCloud className="mx-auto h-8 w-8 text-slate-400 mb-2" />
              <p className="text-sm font-medium text-slate-700">Add PDFs</p>
            </div>

            {/* File List */}
            <div className="space-y-2">
              {files.map((file, i) => (
                <div 
                  key={i} 
                  className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer hover:bg-slate-50 transition-colors ${activeFile === file ? 'bg-slate-50 border-blue-200' : 'border-slate-100'}`}
                  onClick={() => setActiveFile(file)}
                >
                  <File className="h-5 w-5 text-red-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
                    <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
        
        {/* Status Bar */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-sm flex items-center gap-2">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          ) : (
            <div className="h-2 w-2 rounded-full bg-green-500 ml-1" />
          )}
          <span className="text-slate-600 truncate">{globalStatus || "Ready"}</span>
        </div>
      </div>

      {/* Center Pane: PDF Viewer */}
      <div className="flex-1 flex flex-col bg-slate-100/50">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 shadow-sm">
          <h1 className="font-semibold text-slate-800 text-lg">Document Viewer</h1>
        </header>
        <div className="flex-1 p-6">
          <div className="h-full w-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex items-center justify-center">
            {activePdfUrl ? (
              <iframe 
                src={`${activePdfUrl}#toolbar=0`} 
                className="w-full h-full border-0" 
                title="PDF Viewer"
              />
            ) : (
              <div className="text-slate-400 flex flex-col items-center">
                <FileText className="h-16 w-16 mb-4 opacity-50" />
                <p>Select or upload a PDF to view</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Sidebar: Auto-Review & Chat */}
      <div className="w-[450px] bg-white border-l border-slate-200 flex flex-col shadow-sm z-10">
        <Tabs defaultValue="review" className="flex-1 flex flex-col">
          <div className="px-4 pt-4 border-b border-slate-100">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="review">Auto-Review</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
            </TabsList>
          </div>
          
          {/* Tab 1: Auto-Review */}
          <TabsContent value="review" className="flex-1 flex flex-col m-0 data-[state=active]:flex">
            {/* Status indicator for Auto-Review */}
            {reviewStatus && (
              <div className="bg-blue-50 text-blue-700 text-xs py-2 px-4 border-b border-blue-100 flex items-center gap-2">
                <Activity className="h-3 w-3 animate-pulse" />
                {reviewStatus}
              </div>
            )}
            
            <ScrollArea className="flex-1 p-6">
              {review ? (
                <div className="prose prose-slate prose-sm max-w-none">
                  <ReactMarkdown>{review}</ReactMarkdown>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 mt-20">
                  <p className="text-center mb-6">No review generated yet.</p>
                  <Button 
                    onClick={handleGenerateReview} 
                    disabled={!sessionId || isGeneratingReview}
                  >
                    {isGeneratingReview ? "Generating..." : "Generate Review"}
                  </Button>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Tab 2: Chat */}
          <TabsContent value="chat" className="flex-1 flex flex-col m-0 data-[state=active]:flex">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-6">
                {messages.length === 0 ? (
                  <div className="text-center text-slate-400 mt-20 text-sm">
                    {sessionId ? "Ask questions about the uploaded papers." : "Please upload papers to start chatting."}
                  </div>
                ) : (
                  messages.map((msg, idx) => (
                    <div 
                      key={idx} 
                      className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      {/* Assistant Tool Status Indicator */}
                      {msg.role === "assistant" && msg.status && (
                        <div className="mb-2 ml-2 flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full border border-blue-100">
                          <Activity className="h-3 w-3 animate-pulse" />
                          <span>{msg.status}</span>
                        </div>
                      )}
                      
                      {/* Chat Bubble */}
                      <div 
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                          msg.role === "user" 
                            ? "bg-blue-600 text-white" 
                            : "bg-slate-100 text-slate-800 prose prose-sm prose-p:leading-snug"
                        }`}
                      >
                        {msg.role === "user" ? (
                          msg.content
                        ) : msg.content ? (
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        ) : (
                          <span className="italic text-slate-400">Thinking...</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            <div className="p-4 bg-white border-t border-slate-100">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <Input 
                  placeholder="Ask a question..." 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isTyping || !sessionId}
                  className="rounded-full bg-slate-50 border-slate-200"
                />
                <Button 
                  type="submit" 
                  size="icon" 
                  disabled={!input.trim() || isTyping || !sessionId}
                  className="rounded-full shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      
    </div>
  )
}
