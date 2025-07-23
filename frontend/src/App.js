import React, { useState, useRef } from 'react';
import { Search, Upload, File, CheckCircle, Clock, AlertCircle, X, FileText, Database, Globe, BarChart3 } from 'lucide-react';
import axios from 'axios';
import './App.css';

const DocumentAssistant = () => {
  const [documents, setDocuments] = useState([
    { id: 1, name: 'company_policy.pdf', status: 'processed', size: '2.4 MB', type: 'pdf' },
    { id: 2, name: 'sales_data.csv', status: 'processed', size: '1.2 MB', type: 'csv' },
  ]);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  // API base URL
  const API_BASE_URL = 'http://127.0.0.1:8000';

  const getFileIcon = (type) => {
    const icons = {
      pdf: <FileText size={16} color="#ef4444" />,
      csv: <BarChart3 size={16} color="#10b981" />,
      txt: <File size={16} color="#3b82f6" />,
      html: <Globe size={16} color="#f97316" />
    };
    return icons[type] || <File size={16} color="#6b7280" />;
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'processed':
        return <CheckCircle size={16} color="#10b981" />;
      case 'processing':
        return <Clock size={16} color="#eab308" className="animate-spin" />;
      case 'error':
        return <AlertCircle size={16} color="#ef4444" />;
      default:
        return null;
    }
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    const newDocs = files.map((file, index) => ({
      id: documents.length + index + 1,
      name: file.name,
      status: 'processing',
      size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
      type: file.name.split('.').pop().toLowerCase()
    }));
    
    setDocuments([...documents, ...newDocs]);
    
    // Simulate processing
    newDocs.forEach((doc, index) => {
      setTimeout(() => {
        setDocuments(prev => prev.map(d => 
          d.id === doc.id ? { ...d, status: 'processed' } : d
        ));
      }, (index + 1) * 2000);
    });
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    setError(null);
    
    try {
      // Make API call to your backend
      const response = await axios.post(`${API_BASE_URL}/get_question`, {
        question: query
      });
      
      // Transform the API response to match your frontend format
      const apiResult = response.data;
      
      setSearchResult({
        answer: apiResult.answer,
        sources: apiResult.chunks.map((chunk, index) => ({
          name: `Document ${index + 1}`,
          relevance: 0.95 - (index * 0.1),
          snippet: chunk.length > 150 ? chunk.substring(0, 150) + "..." : chunk
        })),
        confidence: apiResult.chunks.length > 0 ? 0.89 : 0.0
      });
      
    } catch (error) {
      console.error('Search error:', error);
      setError('Failed to search. Please make sure your backend is running.');
      setSearchResult(null);
    } finally {
      setIsSearching(false);
    }
  };

  const removeDocument = (id) => {
    setDocuments(documents.filter(doc => doc.id !== id));
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="header-content">
            <div className="logo">
              <Database size={32} color="white" />
            </div>
            <h1 className="title">Document Assistant</h1>
          </div>
        </div>
      </header>

      <div className="container">
        <div className="main-layout">
          
          {/* Main Content Area */}
          <div className="main-content">
            
            {/* Search Section */}
            <div className="card">
              <div className="search-header">
                <h2 className="search-title">Ask Your Documents</h2>
                <p className="search-subtitle">Search through your uploaded documents using natural language</p>
              </div>
              
              <div className="search-container">
                <div className="search-input-container">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask anything about your documents..."
                    className="search-input"
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  />
                  <button
                    onClick={handleSearch}
                    disabled={isSearching || !query.trim()}
                    className="search-button"
                  >
                    <Search size={20} />
                  </button>
                </div>

                {/* Quick suggestions */}
                <div className="suggestions">
                  {['Company policies', 'Sales trends', 'Recent updates', 'Key metrics'].map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => setQuery(suggestion)}
                      className="suggestion-chip"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Search Results */}
            {error && (
              <div className="card">
                <div className="error-message">
                  <AlertCircle size={20} color="#ef4444" />
                  <span>{error}</span>
                </div>
              </div>
            )}

            {searchResult && (
              <div className="card">
                <div className="result-header">
                  <h3 className="result-title">Search Results</h3>
                  <div className="confidence-badge">
                    <div className="confidence-dot"></div>
                    <span>Confidence: {Math.round(searchResult.confidence * 100)}%</span>
                  </div>
                </div>

                <div className="answer-box">
                  <p>{searchResult.answer}</p>
                </div>

                <div className="sources-section">
                  <h4 className="sources-title">Sources Used:</h4>
                  {searchResult.sources.map((source, index) => (
                    <div key={index} className="source-item">
                      <div className="source-header">
                        <div className="source-name">
                          {getFileIcon(source.name.split('.').pop())}
                          <span>{source.name}</span>
                        </div>
                        <div className="relevance-score">
                          {Math.round(source.relevance * 100)}% relevance
                        </div>
                      </div>
                      <p className="source-snippet">"{source.snippet}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isSearching && (
              <div className="card">
                <div className="searching-indicator">
                  <Clock size={20} color="#3b82f6" className="animate-spin" />
                  <span>Searching through your documents...</span>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="sidebar">
            
            {/* Upload Section */}
            <div className="card">
              <h3 className="sidebar-title">Upload Documents</h3>
              
              <div className="upload-zone" onClick={() => fileInputRef.current?.click()}>
                <Upload size={32} color="#9ca3af" />
                <p className="upload-text">Drop files here or click to upload</p>
                <p className="upload-subtext">Supports PDF, CSV, TXT, HTML</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileUpload}
                accept=".pdf,.csv,.txt,.html,.htm"
                style={{ display: 'none' }}
              />
            </div>

            {/* Document List */}
            <div className="card">
              <h3 className="sidebar-title">Your Documents</h3>
              
              <div className="document-list">
                {documents.map((doc) => (
                  <div key={doc.id} className="document-item">
                    <div className="document-info">
                      {getFileIcon(doc.type)}
                      <div className="document-details">
                        <p className="document-name">{doc.name}</p>
                        <p className="document-size">{doc.size}</p>
                      </div>
                    </div>
                    <div className="document-actions">
                      {getStatusIcon(doc.status)}
                      <button
                        onClick={() => removeDocument(doc.id)}
                        className="remove-button"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                
                {documents.length === 0 && (
                  <div className="empty-state">
                    <File size={32} color="#9ca3af" />
                    <p>No documents uploaded yet</p>
                  </div>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="card">
              <h3 className="sidebar-title">Statistics</h3>
              
              <div className="stats-list">
                <div className="stat-item">
                  <span className="stat-label">Total Documents</span>
                  <span className="stat-value">{documents.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Processed</span>
                  <span className="stat-value processed">{documents.filter(d => d.status === 'processed').length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Processing</span>
                  <span className="stat-value processing">{documents.filter(d => d.status === 'processing').length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentAssistant;