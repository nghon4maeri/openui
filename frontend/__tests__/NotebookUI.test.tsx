/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NotebookUI } from '@/components/notebook-ui'

// Mock react-markdown because it can have issues in jsdom without proper setup
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: any }) => <div>{children}</div>
}))

describe('NotebookUI', () => {
  it('renders the layout correctly and shows empty states', () => {
    render(<NotebookUI />)
    
    // Check if the 3 main columns are there by looking for their headers
    expect(screen.getByText('Sources')).toBeTruthy()
    expect(screen.getByText('Document Viewer')).toBeTruthy()
    expect(screen.getByText('Auto-Review')).toBeTruthy()
    expect(screen.getByText('Chat')).toBeTruthy()

    // Check if the dropzone text is visible
    expect(screen.getByText('Add PDFs')).toBeTruthy()

    // Check if the viewer empty state is shown
    expect(screen.getByText('Select or upload a PDF to view')).toBeTruthy()
    
    // Check if review empty state is shown
    expect(screen.getByText('No review generated yet.')).toBeTruthy()
  })
})
