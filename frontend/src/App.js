import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Clock, AlertCircle, FileText, Database, Plus, MessageCircle, Trash2 } from 'lucide-react';
import axios from 'axios';
import './App.css';

const DocumentAssistant = () => {
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  // Refs for auto-scrolling
  const messagesEndRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // API base URL
  const API_BASE_URL = 'http://127.0.0.1:8000';
  const USER_ID = 'user123'; // In real app, get from auth

  // Auto-scroll function
  const scrollToBottom = useCallback(() => {
    if (shouldAutoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: 'smooth',
        block: 'end'
      });
    }
  }, [shouldAutoScroll]);

  // Alternative scroll method for immediate scrolling
  const scrollToBottomImmediate = useCallback(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, []);

  // Check if user is near bottom of chat
  const handleScroll = useCallback(() => {
    if (chatMessagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatMessagesRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100; // 100px threshold
      setShouldAutoScroll(isNearBottom);
    }
  }, []);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  };

  // Load user's conversations on component mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.conversation_id);
    } else {
      setMessages([]);
    }
  }, [currentConversation]);

  // Auto-scroll when messages change
  useEffect(() => {
    // Use a small timeout to ensure DOM updates are complete
    const timeoutId = setTimeout(() => {
      scrollToBottom();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [messages, scrollToBottom]);

  // Auto-scroll when starting to search (for immediate user message display)
  useEffect(() => {
    if (isSearching) {
      setShouldAutoScroll(true);
      setTimeout(scrollToBottomImmediate, 50);
    }
  }, [isSearching, scrollToBottomImmediate]);

  const loadConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations`, {
        params: { user_id: USER_ID }
      });
      setConversations(response.data.conversations);
      
      // If no current conversation and we have conversations, select the first one
      if (!currentConversation && response.data.conversations.length > 0) {
        setCurrentConversation(response.data.conversations[0]);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
      setError('Failed to load conversations');
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const loadMessages = async (conversationId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations/${conversationId}/messages`);
      const backendMessages = response.data.messages;
      
      // Convert backend messages to frontend format
      const frontendMessages = backendMessages.map(msg => ({
        id: msg._id || msg.message_id,
        type: msg.role, // 'user' or 'assistant'
        content: msg.content,
        sources: msg.sources ? msg.sources.map((chunk, index) => ({
          name: `Source ${index + 1}`,
          snippet: chunk.length > 150 ? chunk.substring(0, 150) + "..." : chunk
        })) : [],
        timestamp: new Date(msg.timestamp)
      }));
      
      setMessages(frontendMessages);
      // Reset auto-scroll preference when loading new conversation
      setShouldAutoScroll(true);
    } catch (error) {
      console.error('Failed to load messages:', error);
      setError('Failed to load conversation history');
    }
  };

  const createNewConversation = async (firstMessage = null) => {
    try {
      const title = firstMessage ? 
        (firstMessage.length > 30 ? firstMessage.substring(0, 30) + "..." : firstMessage) :
        'New Chat';
        
      const response = await axios.post(`${API_BASE_URL}/conversations`, {
        title: title,
        user_id: USER_ID
      });
      
      const newConversation = response.data.conversation;
      setConversations(prev => [newConversation, ...prev]);
      setCurrentConversation(newConversation);
      setMessages([]);
      setError(null);
      // Ensure auto-scroll is enabled for new conversations
      setShouldAutoScroll(true);
      
      return newConversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      setError('Failed to create new conversation');
      return null;
    }
  };

  const deleteConversation = async (conversationId) => {
    try {
      await axios.delete(`${API_BASE_URL}/conversations/${conversationId}`);
      
      // Remove from conversations list
      setConversations(prev => prev.filter(conv => conv.conversation_id !== conversationId));
      
      // If this was the current conversation, clear it
      if (currentConversation && currentConversation.conversation_id === conversationId) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      setError('Failed to delete conversation');
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;

    const currentQuery = query;
    setQuery(''); // Clear input immediately
    
    let targetConversation = currentConversation;
    
    // Create conversation if none exists
    if (!targetConversation) {
      targetConversation = await createNewConversation(currentQuery);
      if (!targetConversation) {
        setError('Failed to create conversation');
        return;
      }
    }

    // Add user message to UI immediately
    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: currentQuery,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsSearching(true);
    setError(null);
    // Enable auto-scroll when sending new message
    setShouldAutoScroll(true);
    
    try {
      // Use the conversational endpoint
      const response = await axios.post(`${API_BASE_URL}/chat/${targetConversation.conversation_id}`, {
        conversation_id: targetConversation.conversation_id,
        question: currentQuery
      });
      
      const apiResult = response.data;
      
      // Add assistant message to UI
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
      
      setMessages(prev => [...prev, assistantMessage]);
      
      // Update conversation metadata
      setCurrentConversation(prev => ({
        ...prev,
        message_count: (prev.message_count || 0) + 2, // +2 for user and assistant
        updated_at: new Date().toISOString()
      }));
      
      // Update conversations list to reflect new message count and timestamp
      setConversations(prev => prev.map(conv => 
        conv.conversation_id === targetConversation.conversation_id
          ? {
              ...conv,
              message_count: (conv.message_count || 0) + 2,
              updated_at: new Date().toISOString()
            }
          : conv
      ));
      
    } catch (error) {
      console.error('Chat error:', error);
      
      // Show error details if available
      const errorMessage = error.response?.data?.detail || 'Failed to get response. Please try again.';
      setError(errorMessage);
      
      const errorResponse = {
        id: Date.now() + 1,
        type: 'error',
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsSearching(false);
    }
  };

  const selectConversation = (conversation) => {
    setCurrentConversation(conversation);
    setError(null);
    // Enable auto-scroll when switching conversations
    setShouldAutoScroll(true);
  };

  const renameConversation = async (conversationId, newTitle) => {
    try {
      await axios.put(`${API_BASE_URL}/conversations/${conversationId}`, {
        title: newTitle
      });
      
      // Update local state
      setConversations(prev => prev.map(conv => 
        conv.conversation_id === conversationId 
          ? { ...conv, title: newTitle }
          : conv
      ));
      
      if (currentConversation && currentConversation.conversation_id === conversationId) {
        setCurrentConversation(prev => ({ ...prev, title: newTitle }));
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
      setError('Failed to rename conversation');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isSearching) {
      e.preventDefault();
      handleSearch();
    }
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
          
          {/* Sidebar - Conversations List */}
          <div className="sidebar">
            <div className="sidebar-header">
              <h3>Conversations</h3>
              <button 
                onClick={() => createNewConversation()} 
                className="new-chat-button"
                disabled={isLoadingConversations}
              >
                <Plus size={20} />
                New Chat
              </button>
            </div>
            
            <div className="conversations-list">
              {isLoadingConversations ? (
                <div className="loading-conversations">
                  <Clock size={16} className="animate-spin" />
                  <span>Loading...</span>
                </div>
              ) : conversations.length === 0 ? (
                <div className="no-conversations">
                  <MessageCircle size={32} color="#9ca3af" />
                  <p>No conversations yet</p>
                  <button 
                    onClick={() => createNewConversation()} 
                    className="create-first-chat"
                  >
                    Start your first chat
                  </button>
                </div>
              ) : (
                conversations.map((conversation) => (
                  <div
                    key={conversation.conversation_id}
                    className={`conversation-item ${
                      currentConversation?.conversation_id === conversation.conversation_id 
                        ? 'active' 
                        : ''
                    }`}
                    onClick={() => selectConversation(conversation)}
                  >
                    <div className="conversation-info">
                      <h4 className="conversation-title">{conversation.title}</h4>
                      <p className="conversation-date">
                        {formatDate(conversation.updated_at)}
                      </p>
                      <p className="conversation-messages">
                        {conversation.message_count || 0} messages
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Are you sure you want to delete this conversation?')) {
                          deleteConversation(conversation.conversation_id);
                        }
                      }}
                      className="delete-conversation"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Chat Container */}
          <div className="chat-container">
            
            {/* Chat Header */}
            <div className="chat-header">
              <div>
                <h2 className="chat-title">
                  {currentConversation ? currentConversation.title : 'Document Assistant'}
                </h2>
                <p className="chat-subtitle">
                  {currentConversation 
                    ? `${messages.length} messages • ${formatDate(currentConversation.updated_at)}`
                    : 'Select a conversation or create a new one'
                  }
                </p>
              </div>
              {currentConversation && (
                <button 
                  onClick={() => createNewConversation()} 
                  className="new-chat-button-small"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>

            {/* Chat Messages */}
            <div 
              className="chat-messages"
              ref={chatMessagesRef}
              onScroll={handleScroll}
            >
              {!currentConversation ? (
                <div className="welcome-message">
                  <Database size={48} color="#9ca3af" />
                  <h3>Welcome to Document Assistant</h3>
                  <p>Create a new conversation to start chatting with your documents.</p>
                  
                  <button 
                    onClick={() => createNewConversation()} 
                    className="start-chat-button"
                  >
                    <Plus size={20} />
                    Start New Chat
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="welcome-message">
                  <MessageCircle size={48} color="#9ca3af" />
                  <h3>Start the Conversation</h3>
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
                messages.map((message) => (
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

              {/* Invisible div for scrolling to bottom */}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="chat-input-container">
              {error && (
                <div className="error-message">
                  <AlertCircle size={16} color="#ef4444" />
                  <span>{error}</span>
                  <button 
                    onClick={() => setError(null)}
                    className="error-dismiss"
                  >
                    ×
                  </button>
                </div>
              )}
              
              <div className="chat-input-wrapper">
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask anything about your documents..."
                  className="chat-input"
                  onKeyDown={handleKeyPress}
                  disabled={isSearching}
                  rows={1}
                  style={{
                    resize: 'none',
                    minHeight: '44px',
                    maxHeight: '120px',
                    overflow: 'auto'
                  }}
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