import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  X, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  ChevronDown, 
  ChevronUp,
  File,
  Download,
  Trash2,
  RefreshCw,
  Database
} from 'lucide-react';

const DocumentUploadPanel = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const fileInputRef = useRef(null);

  // Status polling for processing documents
  const [statusPolling, setStatusPolling] = useState(new Map());

  // Load documents from backend on component mount
  const loadDocumentsFromBackend = async () => {
    setIsLoadingDocs(true);
    try {
      const response = await fetch('http://127.0.0.1:8000/documents');
      const result = await response.json();
      
      if (response.ok) {
        const backendDocs = result.documents.map(doc => ({
          id: doc.document_id,
          name: doc.filename,
          size: doc.file_size,
          status: doc.status,
          uploadedAt: new Date(doc.uploaded_at),
          processedAt: doc.processed_at ? new Date(doc.processed_at) : null,
          chunks: doc.chunks_count,
          currentChunks: doc.current_chunks || 0,
          error: doc.error_message,
          document_id: doc.document_id,
          progressPercentage: doc.progress_percentage || 0
        }));
        
        setUploadedFiles(backendDocs);
        
        // Start polling for any processing documents
        const processingDocs = backendDocs.filter(doc => 
          doc.status === 'processing' || doc.status === 'processing_index'
        );
        
        processingDocs.forEach(doc => {
          startStatusPolling(doc.document_id, doc.id, doc.name);
        });
      }
    } catch (error) {
      console.error('Failed to load documents:', error);
      showNotification('Failed to load documents', 'error');
    } finally {
      setIsLoadingDocs(false);
    }
  };

  // Enhanced status polling with better intervals
  const startStatusPolling = (documentId, fileId, fileName) => {
    if (statusPolling.has(documentId)) {
      return; // Already polling this document
    }

    let pollCount = 0;
    const maxPolls = 120; // 5 minutes max (120 * 2.5s average)
    
    const pollInterval = setInterval(async () => {
      try {
        pollCount++;
        
        // Use exponential backoff for polling frequency
        const baseInterval = 2500; // 2.5 seconds
        const backoffMultiplier = Math.min(pollCount / 10, 3); // Max 3x slower
        
        const response = await fetch(`http://127.0.0.1:8000/documents/${documentId}/status`);
        const statusData = await response.json();
        
        if (response.ok) {
          // Update the file status
          setUploadedFiles(prev => prev.map(f => 
            f.id === fileId 
              ? { 
                  ...f, 
                  status: statusData.status,
                  processedAt: statusData.processed_at ? new Date(statusData.processed_at) : null,
                  chunks: statusData.chunks_count || f.chunks,
                  currentChunks: statusData.current_chunks || 0,
                  error: statusData.error_message,
                  progressPercentage: statusData.progress_percentage || 0
                }
              : f
          ));
          
          // Stop polling if document is ready or has error
          if (statusData.status === 'ready') {
            clearInterval(pollInterval);
            setStatusPolling(prev => {
              const newMap = new Map(prev);
              newMap.delete(documentId);
              return newMap;
            });
            
            showNotification(`${fileName} is ready for Q&A!`, 'success');
            
          } else if (statusData.status === 'error') {
            clearInterval(pollInterval);
            setStatusPolling(prev => {
              const newMap = new Map(prev);
              newMap.delete(documentId);
              return newMap;
            });
            
            showNotification(`Failed to process ${fileName}: ${statusData.error_message}`, 'error');
          }
          
          // Dynamic interval adjustment
          clearInterval(pollInterval);
          if (statusData.status === 'processing' || statusData.status === 'processing_index') {
            setTimeout(() => {
              if (pollCount < maxPolls) {
                startStatusPolling(documentId, fileId, fileName);
              }
            }, baseInterval * backoffMultiplier);
          }
          
        } else {
          console.error('Failed to get document status:', response.statusText);
        }
        
        // Stop polling after max attempts
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setStatusPolling(prev => {
            const newMap = new Map(prev);
            newMap.delete(documentId);
            return newMap;
          });
          
          setUploadedFiles(prev => prev.map(f => 
            f.id === fileId 
              ? { 
                  ...f, 
                  status: 'error',
                  error: 'Processing timeout - please try re-uploading'
                }
              : f
          ));
          showNotification(`Processing timeout for ${fileName}`, 'error');
        }
        
      } catch (error) {
        console.error('Status polling error:', error);
        
        // Stop polling on repeated errors
        if (pollCount > 5) {
          clearInterval(pollInterval);
          setStatusPolling(prev => {
            const newMap = new Map(prev);
            newMap.delete(documentId);
            return newMap;
          });
        }
      }
    }, 2500); // Initial 2.5 second interval
    
    setStatusPolling(prev => new Map(prev).set(documentId, pollInterval));
  };

  // Cleanup polling on component unmount
  useEffect(() => {
    return () => {
      statusPolling.forEach(interval => clearInterval(interval));
    };
  }, [statusPolling]);

  // Load documents when component mounts
  useEffect(() => {
    loadDocumentsFromBackend();
  }, []);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date) => {
    return date.toLocaleDateString([], { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleFileSelect = (files) => {
    Array.from(files).forEach(file => {
      const newFile = {
        id: Date.now() + Math.random(),
        name: file.name,
        size: file.size,
        status: 'uploading',
        uploadedAt: new Date(),
        progressPercentage: 0
      };
      
      setUploadedFiles(prev => [newFile, ...prev]);
      
      // Real upload to backend
      const uploadFile = async (file, fileId) => {
        try {
          const formData = new FormData();
          formData.append('file', file);
          
          const response = await fetch('http://127.0.0.1:8000/upload-document', {
            method: 'POST',
            body: formData,
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            // Update file status to processing
            setUploadedFiles(prev => prev.map(f => 
              f.id === fileId 
                ? { 
                    ...f, 
                    status: result.status,
                    chunks: result.chunks_created,
                    document_id: result.document_id,
                    progressPercentage: 25 // Upload complete, processing started
                  }
                : f
            ));
            
            showNotification(`${file.name} uploaded successfully. Processing...`, 'info');
            
            // Start enhanced status polling
            startStatusPolling(result.document_id, fileId, file.name);
            
          } else {
            throw new Error(result.detail || 'Upload failed');
          }
        } catch (error) {
          console.error('Upload error:', error);
          
          setUploadedFiles(prev => prev.map(f => 
            f.id === fileId 
              ? { 
                  ...f, 
                  status: 'error', 
                  error: error.message
                }
              : f
          ));
          
          showNotification(`Failed to upload ${file.name}: ${error.message}`, 'error');
        }
      };

      // Call the upload function
      uploadFile(file, newFile.id);
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files);
    }
  };

  const deleteFile = async (fileId, documentId) => {
    try {
      if (documentId) {
        // Stop polling for this document
        if (statusPolling.has(documentId)) {
          clearInterval(statusPolling.get(documentId));
          setStatusPolling(prev => {
            const newMap = new Map(prev);
            newMap.delete(documentId);
            return newMap;
          });
        }

        const response = await fetch(`http://127.0.0.1:8000/documents/${documentId}`, {
          method: 'DELETE'
        });
        
        if (!response.ok) {
          throw new Error('Failed to delete from server');
        }
      }
      
      setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
      showNotification('Document deleted successfully', 'success');
      
    } catch (error) {
      console.error('Delete error:', error);
      showNotification('Failed to delete document', 'error');
    }
  };

  const retryProcessing = async (fileId, documentId) => {
    const file = uploadedFiles.find(f => f.id === fileId);
    if (!file) return;

    try {
      // First delete the existing document if it exists
      if (documentId) {
        await fetch(`http://127.0.0.1:8000/documents/${documentId}`, {
          method: 'DELETE'
        });
      }

      // Reset status to uploading and show retry message
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileId 
          ? { 
              ...f, 
              status: 'processing', 
              error: null,
              progressPercentage: 0
            }
          : f
      ));
      
      showNotification(`Retrying ${file.name}... Please upload the file again.`, 'info');
      
    } catch (error) {
      console.error('Retry error:', error);
      showNotification('Failed to retry processing. Please delete and upload again.', 'error');
    }
  };

  const refreshDocuments = async () => {
    await loadDocumentsFromBackend();
    showNotification('Documents refreshed', 'info');
  };

  const showNotification = (message, type = 'info') => {
    const notification = {
      id: Date.now(),
      message,
      type
    };
    
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove notification after 5 seconds for non-error messages
    const autoRemoveTime = type === 'error' ? 8000 : 5000;
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, autoRemoveTime);
  };

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const getStatusIcon = (file) => {
    switch (file.status) {
      case 'ready':
        return <CheckCircle size={16} color="#10b981" />;
      case 'uploading':
        return <Upload size={16} color="#3b82f6" className="animate-pulse" />;
      case 'processing':
        return <Database size={16} color="#3b82f6" className="animate-pulse" />;
      case 'processing_index':
        return <Clock size={16} color="#3b82f6" className="animate-spin" />;
      case 'error':
        return <AlertCircle size={16} color="#ef4444" />;
      default:
        return <FileText size={16} color="#9ca3af" />;
    }
  };

  const getStatusText = (file) => {
    switch (file.status) {
      case 'ready':
        return `Ready • ${file.chunks || 0} chunks`;
      case 'uploading':
        return 'Uploading...';
      case 'processing':
        return file.currentChunks > 0 
          ? `Processing... (${file.currentChunks}/${file.chunks || '?'} chunks)`
          : 'Processing...';
      case 'processing_index':
        return 'Indexing for search...';
      case 'error':
        return 'Failed';
      default:
        return 'Unknown status';
    }
  };

  const getProgressBar = (file) => {
    if (file.status === 'ready') return null;
    
    let progress = 0;
    let color = '#3b82f6';
    
    switch (file.status) {
      case 'uploading':
        progress = 20;
        break;
      case 'processing':
        progress = file.progressPercentage || 40;
        break;
      case 'processing_index':
        progress = 80;
        break;
      case 'error':
        progress = 100;
        color = '#ef4444';
        break;
    }
    
    return (
      <div className="status-progress">
        <div 
          className="status-progress-bar"
          style={{ 
            width: `${progress}%`,
            backgroundColor: color
          }}
        />
      </div>
    );
  };

  const readyFilesCount = uploadedFiles.filter(f => f.status === 'ready').length;
  const processingFilesCount = uploadedFiles.filter(f => 
    f.status === 'processing' || 
    f.status === 'processing_index' || 
    f.status === 'uploading'
  ).length;

  return (
    <>
      {/* Enhanced Notifications */}
      {notifications.length > 0 && (
        <div className="notifications-container">
          {notifications.map((notification) => (
            <div key={notification.id} className={`notification ${notification.type}`}>
              <div className="notification-content">
                {notification.type === 'success' && <CheckCircle size={16} />}
                {notification.type === 'error' && <AlertCircle size={16} />}
                {notification.type === 'info' && <Database size={16} />}
                <span className="notification-message">{notification.message}</span>
              </div>
              <button 
                onClick={() => removeNotification(notification.id)}
                className="notification-close"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="document-upload-panel">
        {/* Enhanced Panel Header */}
        <div 
          className="upload-panel-header"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="upload-panel-header-content">
            <div className="upload-panel-info">
              <Upload size={20} color="#3b82f6" />
              <div>
                <h3 className="upload-panel-title">My Documents</h3>
                <p className="upload-panel-subtitle">
                  {readyFilesCount} ready
                  {processingFilesCount > 0 && `, ${processingFilesCount} processing`}
                  {statusPolling.size > 0 && ` • ${statusPolling.size} monitored`}
                </p>
              </div>
            </div>
            <div className="header-controls">
              {isLoadingDocs && <Clock size={16} className="animate-spin" />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  refreshDocuments();
                }}
                className="refresh-button"
                title="Refresh documents"
              >
                <RefreshCw size={16} />
              </button>
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </div>
        </div>

        {/* Expandable Content */}
        {isExpanded && (
          <div className="upload-panel-content">
            {/* Upload Area */}
            <div
              className={`upload-area ${isDragging ? 'upload-area-dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload size={32} color={isDragging ? '#3b82f6' : '#9ca3af'} style={{ marginBottom: '8px' }} />
              <p className="upload-area-title">
                {isDragging ? 'Drop files here' : 'Upload documents'}
              </p>
              <p className="upload-area-subtitle">
                PDF, TXT, CSV, HTML files up to 25MB
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="upload-choose-button"
              >
                Choose Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.csv,.html,.htm,.docx"
                onChange={handleFileInputChange}
                style={{ display: 'none' }}
              />
            </div>

            {/* Enhanced Files List */}
            {uploadedFiles.length > 0 && (
              <div className="files-list-container">
                <h4 className="files-list-title">
                  Uploaded Files ({uploadedFiles.length})
                </h4>
                <div className="files-list">
                  {uploadedFiles.map((file) => (
                    <div key={file.id} className={`file-item ${file.status}`}>
                      <div className="file-item-content">
                        <div className="file-item-info">
                          <File size={16} color="#9ca3af" style={{ marginTop: '2px', flexShrink: 0 }} />
                          <div className="file-details">
                            <p className="file-name">{file.name}</p>
                            <div className="file-status">
                              {getStatusIcon(file)}
                              <span className="file-status-text">
                                {getStatusText(file)}
                              </span>
                            </div>
                            
                            {/* Enhanced Progress Bar */}
                            {getProgressBar(file)}
                            
                            <p className="file-meta">
                              {formatFileSize(file.size)} • {formatDate(file.uploadedAt)}
                              {file.processedAt && (
                                <span> • Completed {formatDate(file.processedAt)}</span>
                              )}
                            </p>
                            
                            {/* Error message */}
                            {file.status === 'error' && (
                              <p className="file-error">{file.error}</p>
                            )}
                            
                            {/* Processing details */}
                            {(file.status === 'processing' || file.status === 'processing_index') && (
                              <div className="processing-details">
                                {file.currentChunks > 0 && (
                                  <span className="chunk-progress">
                                    {file.currentChunks}/{file.chunks || '?'} chunks processed
                                  </span>
                                )}
                                {statusPolling.has(file.document_id) && (
                                  <span className="monitoring-indicator">
                                    • Monitoring status
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Enhanced Action buttons */}
                        <div className="file-actions">
                          {file.status === 'error' && (
                            <button
                              onClick={() => retryProcessing(file.id, file.document_id)}
                              className="file-action-button retry-button"
                              title="Retry processing"
                            >
                              <RefreshCw size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => deleteFile(file.id, file.document_id)}
                            className="file-action-button delete-button"
                            title="Delete file"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Enhanced Summary */}
            {uploadedFiles.length > 0 && (
              <div className="upload-summary">
                <div className="upload-summary-content">
                  <div className="summary-stats">
                    <div className="stat-item">
                      <CheckCircle size={16} color="#10b981" />
                      <span><strong>{readyFilesCount}</strong> ready for Q&A</span>
                    </div>
                    
                    {processingFilesCount > 0 && (
                      <div className="stat-item">
                        <Clock size={16} color="#3b82f6" className="animate-spin" />
                        <span><strong>{processingFilesCount}</strong> processing</span>
                      </div>
                    )}
                    
                    {statusPolling.size > 0 && (
                      <div className="stat-item">
                        <Database size={16} color="#6b7280" />
                        <span><strong>{statusPolling.size}</strong> monitored</span>
                      </div>
                    )}
                  </div>
                  
                  {processingFilesCount > 0 && (
                    <div className="processing-notice">
                      <p className="processing-text">
                        Documents are being indexed for search. This may take 1-3 minutes per document.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* No documents state */}
            {uploadedFiles.length === 0 && !isLoadingDocs && (
              <div className="no-documents">
                <FileText size={32} color="#9ca3af" />
                <p>No documents uploaded yet</p>
                <p className="no-documents-hint">
                  Upload your first document to start asking questions
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .notifications-container {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .notification {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          min-width: 300px;
          animation: slideIn 0.3s ease-out;
        }

        .notification.success {
          background-color: #10b981;
          color: white;
        }

        .notification.error {
          background-color: #ef4444;
          color: white;
        }

        .notification.info {
          background-color: #3b82f6;
          color: white;
        }

        .notification-content {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .notification-close {
          background: none;
          border: none;
          color: inherit;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          opacity: 0.8;
        }

        .notification-close:hover {
          opacity: 1;
          background-color: rgba(255, 255, 255, 0.1);
        }

        .status-progress {
          width: 100%;
          height: 2px;
          background-color: #e5e7eb;
          border-radius: 1px;
          margin: 4px 0;
          overflow: hidden;
        }

        .status-progress-bar {
          height: 100%;
          transition: width 0.3s ease;
          border-radius: 1px;
        }

        .processing-details {
          font-size: 12px;
          color: #6b7280;
          margin-top: 4px;
        }

        .chunk-progress {
          font-weight: 500;
        }

        .monitoring-indicator {
          color: #3b82f6;
        }

        .header-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .refresh-button {
          background: none;
          border: none;
          padding: 4px;
          border-radius: 4px;
          cursor: pointer;
          color: #6b7280;
          transition: all 0.2s;
        }

        .refresh-button:hover {
          color: #3b82f6;
          background-color: #f3f4f6;
        }

        .file-item.processing,
        .file-item.processing_index {
          border-left: 3px solid #3b82f6;
          background-color: #f8fafc;
        }

        .file-item.ready {
          border-left: 3px solid #10b981;
        }

        .file-item.error {
          border-left: 3px solid #ef4444;
          background-color: #fef2f2;
        }

        .summary-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 8px;
        }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
        }

        .processing-notice {
          margin-top: 8px;
          padding: 8px 12px;
          background-color: #f0f9ff;
          border-radius: 6px;
          border-left: 3px solid #3b82f6;
        }

        .processing-text {
          margin: 0;
          font-size: 13px;
          color: #1e40af;
        }

        .no-documents {
          text-align: center;
          padding: 32px 16px;
          color: #6b7280;
        }

        .no-documents-hint {
          font-size: 14px;
          margin-top: 8px;
        }

        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
};

export default DocumentUploadPanel;