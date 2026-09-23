"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import { UploadCloud, FileText, Loader2, AlertCircle } from "lucide-react"
import ReactMarkdown from "react-markdown"

export function ReviewSystem() {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [review, setReview] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const abortControllerRef = useRef<AbortController | null>(null)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFiles(acceptedFiles)
      setReview("")
      setStatus("")
      setError("")
      handleUpload(acceptedFiles)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
    },
  })

  const handleUpload = async (filesToUpload: File[]) => {
    setUploading(true)
    setStatus("Uploading PDFs...")
    setError("")
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    const formData = new FormData()
    filesToUpload.forEach((file) => {
      formData.append("files", file)
    })

    try {
      // Create fetch request for streaming response
      const response = await fetch("http://localhost:8000/api/upload", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error("Failed to upload and process PDFs")
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No reader available")

      const decoder = new TextDecoder()
      let done = false

      while (!done) {
        const { value, done: doneReading } = await reader.read()
        done = doneReading
        if (value) {
          const chunk = decoder.decode(value, { stream: true })
          // Process Server-Sent Events (SSE) format
          const lines = chunk.split("\n")
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === "status") {
                  setStatus(data.content)
                } else if (data.type === "chunk") {
                  setReview((prev) => prev + data.content)
                  // Don't overwrite detailed agent status unless it's just chunking
                }
              } catch (e) {
                // If it's not JSON, might be raw text depending on how backend sends it
                // console.error("Error parsing SSE:", e)
              }
            }
          }
        }
      }
      setStatus("Complete")
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "An error occurred during processing.")
        setStatus("Error")
      }
    } finally {
      setUploading(false)
    }
  }

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      {files.length === 0 && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
            isDragActive ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <input {...getInputProps()} />
          <UploadCloud className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-lg font-medium text-slate-700">
            {isDragActive ? "Drop the PDFs here" : "Drag and drop PDF files here"}
          </p>
          <p className="text-sm text-slate-500 mt-2">or click to select files</p>
        </div>
      )}

      {files.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[calc(100vh-12rem)] min-h-[600px]">
          {/* Left Pane - File Info / Status */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col h-full">
            <h2 className="text-lg font-semibold mb-4">Document Details</h2>
            <div className="space-y-3 overflow-y-auto max-h-[200px] mb-4">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <FileText className="h-6 w-6 text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">{f.name}</p>
                    <p className="text-sm text-slate-500">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex-1">
              <h3 className="font-medium text-slate-700 mb-4">Agent Status</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-slate-600">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  ) : error ? (
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  ) : status === "Complete" ? (
                    <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <div className="h-5 w-5" />
                  )}
                  <span className={error ? "text-red-500" : "text-slate-700 font-medium"}>
                    {status || "Waiting for upload..."}
                  </span>
                </div>
                {error && <p className="text-sm text-red-500 bg-red-50 p-3 rounded-md">{error}</p>}
              </div>
            </div>

            <button
              onClick={() => {
                setFiles([])
                setReview("")
                setStatus("")
                if (abortControllerRef.current) abortControllerRef.current.abort()
              }}
              className="mt-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors font-medium text-sm"
            >
              Start New Review
            </button>
          </div>

          {/* Right Pane - Review Output */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">AI Review</h2>
              {uploading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </div>
            <div className="p-6 overflow-y-auto flex-1 prose prose-slate max-w-none prose-sm md:prose-base">
              {review ? (
                <ReactMarkdown>{review}</ReactMarkdown>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 italic">
                  Review content will appear here...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
