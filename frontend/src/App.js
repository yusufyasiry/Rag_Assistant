import React, { useState } from 'react';
import { Search, Clock, AlertCircle, FileText, Database } from 'lucide-react';
import axios from 'axios';
import './App.css';

const DocumentAssistant = () => {
  const [conversation, setConversation] = useState([]);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);

  // API base URL
  const API_BASE_URL = 'http://127.0.0.1:8000';

  const formatTime = (timestamp) => {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    
    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: query,
      timestamp: new Date()
    };
    
    setConversation(prev => [...prev, userMessage]);
    setIsSearching(true);
    setError(null);
    
    const currentQuery = query;
    setQuery(''); // Clear input immediately
    
    try {
      // Make API call to your backend
      const response = await axios.post(`${API_BASE_URL}/get_question`, {
        question: currentQuery
      });
      
      const apiResult = response.data;
      
      const assistantMessage = {
        id: Date.now() + 1,
        type: 'assistant',
        content: apiResult.answer,
        sources: apiResult.chunks.map((chunk, index) => ({
          name: `Source ${index + 1}`,
          snippet: chunk.length > 150 ? chunk.substring(0, 150) + "..." : chunk
        })),
        timestamp: new Date()
      };
      
      setConversation(prev => [...prev, assistantMessage]);
      
    } catch (error) {
      console.error('Search error:', error);
      setError('Failed to get response. Please make sure your backend is running.');
      
      const errorMessage = {
        id: Date.now() + 1,
        type: 'error',
        content: 'Sorry, I encountered an error while processing your request. Please try again.',
        timestamp: new Date()
      };
      
      setConversation(prev => [...prev, errorMessage]);
    } finally {
      setIsSearching(false);
    }
  };

  const clearConversation = () => {
    setConversation([]);
    setError(null);
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
        <div className="chat-layout">
          
          {/* Chat Container */}
          <div className="chat-container">
            
            {/* Chat Header */}
            <div className="chat-header">
              <div>
                <h2 className="chat-title">Document Assistant</h2>
                <p className="chat-subtitle">Ask questions about your documents</p>
              </div>
              {conversation.length > 0 && (
                <button onClick={clearConversation} className="clear-button">
                  Clear Chat
                </button>
              )}
            </div>

            {/* Chat Messages */}
            <div className="chat-messages">
              {conversation.length === 0 ? (
                <div className="welcome-message">
                  <Database size={48} color="#9ca3af" />
                  <h3>Welcome to Document Assistant</h3>
                  <p>Ask me anything about your documents. I'll search through them and provide you with accurate answers.</p>
                  
                  {/* Quick suggestions */}
                  <div className="suggestions">
                    <p>Try asking:</p>
                    {['What are the company policies?', 'Show me sales trends', 'Recent updates', 'Key metrics'].map((suggestion, index) => (
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
              ) : (
                conversation.map((message) => (
                  <div key={message.id} className={`message ${message.type}`}>
                    <div className="message-content">
                      <div className="message-header">
                        <span className="message-sender">
                          {message.type === 'user' ? 'You' : message.type === 'error' ? 'Error' : 'Assistant'}
                        </span>
                        <span className="message-time">{formatTime(message.timestamp)}</span>
                      </div>
                      <div className="message-text">
                        {message.content}
                      </div>
                      
                      {/* Show sources for assistant messages */}
                      {message.type === 'assistant' && message.sources && message.sources.length > 0 && (
                        <div className="message-sources">
                          <h4>Sources:</h4>
                          {message.sources.map((source, index) => (
                            <div key={index} className="source-item">
                              <div className="source-header">
                                <FileText size={14} color="#6b7280" />
                                <span className="source-name">{source.name}</span>
                              </div>
                              <p className="source-snippet">"{source.snippet}"</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {/* Loading indicator */}
              {isSearching && (
                <div className="message assistant loading">
                  <div className="message-content">
                    <div className="message-header">
                      <span className="message-sender">Assistant</span>
                    </div>
                    <div className="typing-indicator">
                      <Clock size={16} color="#3b82f6" className="animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="chat-input-container">
              {error && (
                <div className="error-message">
                  <AlertCircle size={16} color="#ef4444" />
                  <span>{error}</span>
                </div>
              )}
              
              <div className="chat-input-wrapper">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask anything about your documents..."
                  className="chat-input"
                  onKeyPress={(e) => e.key === 'Enter' && !isSearching && handleSearch()}
                  disabled={isSearching}
                />
                <button
                  onClick={handleSearch}
                  disabled={isSearching || !query.trim()}
                  className="send-button"
                >
                  <Search size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentAssistant;