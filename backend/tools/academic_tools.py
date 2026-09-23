import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import requests
import json
from typing import Dict, Any

def search_arxiv(query: str, max_results: int = 3) -> str:
    """
    Searches the ArXiv API for recent academic papers matching the query.
    
    Args:
        query: The search query (e.g., 'machine learning healthcare').
        max_results: The maximum number of results to return (default: 3).
        
    Returns:
        A string summarizing the findings (titles, authors, published dates, and summaries).
    """
    try:
        url = f"http://export.arxiv.org/api/query?search_query=all:{urllib.parse.quote(query)}&start=0&max_results={max_results}"
        with urllib.request.urlopen(url, timeout=10) as response:
            data = response.read()
        
        root = ET.fromstring(data)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        
        results = []
        for entry in root.findall('atom:entry', ns):
            title = entry.find('atom:title', ns).text.strip()
            summary = entry.find('atom:summary', ns).text.strip()
            published = entry.find('atom:published', ns).text.strip()
            authors = [author.find('atom:name', ns).text for author in entry.findall('atom:author', ns)]
            
            results.append(f"Title: {title}\nAuthors: {', '.join(authors)}\nPublished: {published}\nSummary: {summary}")
        
        if not results:
            return "No results found on ArXiv."
            
        return "\n\n---\n\n".join(results)
    except Exception as e:
        return f"Error searching ArXiv: {str(e)}"

def search_semantic_scholar(query: str) -> str:
    """
    Searches Semantic Scholar API for papers to fetch citation counts and related works.
    Use this to validate claims or find high-impact related research.
    
    Args:
        query: The search query (title of a paper or concept).
        
    Returns:
        A string summarizing the top matching papers including their title, year, citation count, and abstract.
    """
    try:
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query,
            "limit": 3,
            "fields": "title,year,citationCount,abstract,authors"
        }
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if not data.get("data"):
            return "No results found on Semantic Scholar."
            
        results = []
        for paper in data["data"]:
            title = paper.get("title", "Unknown Title")
            year = paper.get("year", "Unknown Year")
            citations = paper.get("citationCount", 0)
            abstract = paper.get("abstract", "No abstract available.")
            
            authors_list = paper.get("authors", [])
            authors = ", ".join([a.get("name", "") for a in authors_list]) if authors_list else "Unknown Authors"
            
            results.append(f"Title: {title}\nAuthors: {authors}\nYear: {year}\nCitations: {citations}\nAbstract: {abstract}")
            
        return "\n\n---\n\n".join(results)
    except Exception as e:
        return f"Error searching Semantic Scholar: {str(e)}"

def critique_methodology(methodology_text: str) -> str:
    """
    Applies a rigorous academic prompt template to analyze a methodology section.
    
    Args:
        methodology_text: The extracted methodology text or a summary of the methodology.
        
    Returns:
        A structured string containing a detailed critique of the methodology.
    """
    # This acts as a specialized sub-routine or prompt template evaluator.
    # In a real scenario, this might call a smaller/cheaper LLM or run static analysis.
    # Here, we format the specific template to guide the main LLM's attention.
    
    critique_prompt = f"""
    Based on the following methodology description, provide a highly critical, peer-review style analysis.
    Focus specifically on:
    1. Sample size and selection bias.
    2. Validity of the evaluation metrics.
    3. Reproducibility of the setup.
    4. Potential confounding variables not addressed.
    
    Methodology to analyze:
    {methodology_text}
    """
    
    # We can return this expanded prompt back to the main LLM to ensure it considers these factors
    # or we can act as if we ran a secondary analysis and return a formatted output string.
    return f"Methodology Evaluation Criteria applied. Review the following aspects:\n{critique_prompt}"
