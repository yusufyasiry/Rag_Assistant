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

  // API base URL - handle both development and production
  const API_BASE_URL = process.env.REACT_APP_API_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://ecore-backend.onrender.com' 
      : 'http://127.0.0.1:8000');

  // Fixed status polling with better management
  const statusPollingRef = useRef(new Map());
  const pollingCountRef = useRef(new Map());

  // Load documents from backend on component mount
  const loadDocumentsFromBackend = async () => {
    setIsLoadingDocs(true);
    try {
      const response = await fetch(`${API_BASE_URL}/documents`);
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
          progressPercentage: getProgressPercentage(doc.status)
        }));
        
        setUploadedFiles(backendDocs);
        
        // Start polling for any processing documents
        const processingDocs = backendDocs.filter(doc => 
          doc.status === 'processing' || doc.status === 'processing_index'
        );
        
        processingDocs.forEach(doc => {
          startStatusPolling(doc.document_id, doc.name);
        });
      }
    } catch (error) {
      console.error('Failed to load documents:', error);
      showNotification('Failed to load documents', 'error');
    } finally {
      setIsLoadingDocs(false);
    }
  };

  // Helper function to get progress percentage based on status
  const getProgressPercentage = (status) => {
    switch (status) {
      case 'uploading': return 20;
      case 'processing': return 50;
      case 'processing_index': return 80;
      case 'ready': return 100;
      case 'error': return 0;
      default: return 0;
    }
  };

  // Fixed status polling with proper cleanup and no recursion
  const startStatusPolling = (documentId, fileName) => {
    // Stop any existing polling for this document
    stopPollingForDocument(documentId);
    
    console.log(`Starting status polling for document: ${documentId} (${fileName})`);
    
    // Initialize poll count
    pollingCountRef.current.set(documentId, 0);
    
    const pollDocument = async () => {
      try {
        const currentPollCount = pollingCountRef.current.get(documentId) || 0;
        pollingCountRef.current.set(documentId, currentPollCount + 1);
        
        console.log(`Polling document ${documentId} - attempt ${currentPollCount + 1}`);
        
        const response = await fetch(`${API_BASE_URL}/documents/${documentId}/status`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const statusData = await response.json();
        console.log(`Status for ${documentId}:`, statusData);
        
        // Update the file status in state
        setUploadedFiles(prev => prev.map(f => 
          f.document_id === documentId 
            ? { 
                ...f, 
                status: statusData.status,
                processedAt: statusData.processed_at ? new Date(statusData.processed_at) : null,
                chunks: statusData.chunks_count || f.chunks,
                currentChunks: statusData.current_chunks || 0,
                error: statusData.error_message,
                progressPercentage: getProgressPercentage(statusData.status)
              }
            : f
        ));
        
        // Check if we should stop polling
        if (statusData.status === 'ready') {
          console.log(`Document ${documentId} is ready, stopping polling`);
          stopPollingForDocument(documentId);
          showNotification(`${fileName} is ready for Q&A!`, 'success');
          return; // Stop polling
          
        } else if (statusData.status === 'error') {
          console.log(`Document ${documentId} failed, stopping polling`);
          stopPollingForDocument(documentId);
          showNotification(`Failed to process ${fileName}: ${statusData.error_message}`, 'error');
          return; // Stop polling
          
        } else if (currentPollCount >= 60) { // Max 5 minutes (60 * 5s)
          console.log(`Document ${documentId} polling timeout`);
          stopPollingForDocument(documentId);
          
          setUploadedFiles(prev => prev.map(f => 
            f.document_id === documentId 
              ? { 
                  ...f, 
                  status: 'error',
                  error: 'Processing timeout - please try re-uploading'
                }
              : f
          ));
          showNotification(`Processing timeout for ${fileName}`, 'error');
          return; // Stop polling
        }
        
        // Continue polling if still processing
        if (statusData.status === 'processing' || statusData.status === 'processing_index') {
          const timeoutId = setTimeout(pollDocument, 5000); // 5 second intervals
          statusPollingRef.current.set(documentId, timeoutId);
        }
        
      } catch (error) {
        console.error(`Status polling error for ${documentId}:`, error);
        
        const currentPollCount = pollingCountRef.current.get(documentId) || 0;
        
        // Stop polling on repeated errors (after 3 attempts)
        if (currentPollCount > 3) {
          console.log(`Too many errors for ${documentId}, stopping polling`);
          stopPollingForDocument(documentId);
          
          setUploadedFiles(prev => prev.map(f => 
            f.document_id === documentId 
              ? { 
                  ...f, 
                  status: 'error',
                  error: 'Failed to check status - please refresh'
                }
              : f
          ));
          showNotification(`Failed to check status for ${fileName}`, 'error');
        } else {
          // Retry after a longer delay on error
          const timeoutId = setTimeout(pollDocument, 10000); // 10 second delay on error
          statusPollingRef.current.set(documentId, timeoutId);
        }
      }
    };
    
    // Start polling immediately
    pollDocument();
  };

  // Helper function to stop polling for a specific document
  const stopPollingForDocument = (documentId) => {
    const timeoutId = statusPollingRef.current.get(documentId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      statusPollingRef.current.delete(documentId);
    }
    pollingCountRef.current.delete(documentId);
    console.log(`Stopped polling for document: ${documentId}`);
  };

  // Cleanup all polling on component unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up all status polling');
      statusPollingRef.current.forEach(timeoutId => clearTimeout(timeoutId));
      statusPollingRef.current.clear();
      pollingCountRef.current.clear();
    };
  }, []);

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
    const fileArray = Array.from(files);
    console.log(`Starting upload for ${fileArray.length} files`);
    
    fileArray.forEach((file, index) => {
      const newFile = {
        id: Date.now() + Math.random() + index, // Ensure unique IDs
        name: file.name,
        size: file.size,
        status: 'uploading',
        uploadedAt: new Date(),
        progressPercentage: 0
      };
      
      setUploadedFiles(prev => [newFile, ...prev]);
      
      // Upload file with delay to prevent overwhelming the server
      setTimeout(() => {
        uploadFile(file, newFile.id);
      }, index * 500); // 500ms delay between uploads
    });
  };

  // Separate upload function for better error handling
  const uploadFile = async (file, fileId) => {
    try {
      console.log(`Uploading file: ${file.name} (ID: ${fileId})`);
      
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`${API_BASE_URL}/upload-document`, {
        method: 'POST',
        body: formData,
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        console.log(`Upload successful for ${file.name}:`, result);
        
        // Update file status to processing
        setUploadedFiles(prev => prev.map(f => 
          f.id === fileId 
            ? { 
                ...f, 
                status: result.status,
                chunks: result.chunks_created,
                document_id: result.document_id,
                progressPercentage: getProgressPercentage(result.status)
              }
            : f
        ));
        
        showNotification(`${file.name} uploaded successfully. Processing...`, 'info');
        
        // Start status polling with a small delay
        setTimeout(() => {
          startStatusPolling(result.document_id, file.name);
        }, 1000);
        
      } else {
        throw new Error(result.detail || 'Upload failed');
      }
    } catch (error) {
      console.error(`Upload error for ${file.name}:`, error);
      
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
        stopPollingForDocument(documentId);

        const response = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
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
      // Stop any existing polling
      if (documentId) {
        stopPollingForDocument(documentId);
        
        // Delete the existing document
        await fetch(`${API_BASE_URL}/documents/${documentId}`, {
          method: 'DELETE'
        });
      }

      // Reset status and show retry message
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileId 
          ? { 
              ...f, 
              status: 'processing', 
              error: null,
              progressPercentage: 0,
              document_id: null
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
    // Stop all current polling
    statusPollingRef.current.forEach(timeoutId => clearTimeout(timeoutId));
    statusPollingRef.current.clear();
    pollingCountRef.current.clear();
    
    await loadDocumentsFromBackend();
    showNotification('Documents refreshed', 'info');
  };

  const showNotification = (message, type = 'info') => {
    const notification = {
      id: Date.now() + Math.random(),
      message,
      type
    };
    
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove notification
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
    
    let progress = file.progressPercentage || 0;
    let color = '#3b82f6';
    
    if (file.status === 'error') {
      progress = 100;
      color = '#ef4444';
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

      <div className="document-upload-panel-sidebar">
        {/* Compact Panel Header for Sidebar */}
        <div className="upload-panel-header-sidebar">
          <div className="upload-panel-info-sidebar">
            <Upload size={18} color="#3b82f6" />
            <div>
              <h3 className="upload-panel-title-sidebar">Documents</h3>
              <p className="upload-panel-subtitle-sidebar">
                {readyFilesCount} ready
                {processingFilesCount > 0 && `, ${processingFilesCount} processing`}
              </p>
            </div>
          </div>
          <div className="header-controls">
            {isLoadingDocs && <Clock size={14} className="animate-spin" />}
            <button
              onClick={(e) => {
                e.stopPropagation();
                refreshDocuments();
              }}
              className="refresh-button"
              title="Refresh documents"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Always Visible Content */}
        <div className="upload-panel-content-sidebar">
          {/* Compact Upload Area */}
          <div
            className={`upload-area-sidebar ${isDragging ? 'upload-area-dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload size={24} color={isDragging ? '#3b82f6' : '#9ca3af'} />
            <p className="upload-area-title-sidebar">
              {isDragging ? 'Drop here' : 'Upload your files to database'}
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="upload-choose-button-sidebar"
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

          {/* Compact Files List */}
          {uploadedFiles.length > 0 && (
            <div className="files-list-container-sidebar">
              <h4 className="files-list-title-sidebar">
                Files ({uploadedFiles.length})
              </h4>
              <div className="files-list-sidebar">
                {uploadedFiles.map((file) => (
                  <div key={file.id} className={`file-item-sidebar ${file.status}`}>
                    <div className="file-item-content-sidebar">
                      <div className="file-item-main-sidebar">
                        <div className="file-icon-status-sidebar">
                          {getStatusIcon(file)}
                        </div>
                        <div className="file-details-sidebar">
                          <p className="file-name-sidebar" title={file.name}>
                            {file.name.length > 25 ? file.name.substring(0, 25) + "..." : file.name}
                          </p>
                          <div className="file-status-sidebar">
                            <span className="file-status-text-sidebar">
                              {getStatusText(file)}
                            </span>
                          </div>
                          
                          {/* Compact Progress Bar */}
                          {getProgressBar(file)}
                          
                          <p className="file-meta-sidebar">
                            {formatFileSize(file.size)}
                          </p>
                          
                          {/* Error message */}
                          {file.status === 'error' && (
                            <p className="file-error-sidebar">{file.error}</p>
                          )}
                        </div>
                      </div>
                      
                      {/* Compact Action buttons */}
                      <div className="file-actions-sidebar">
                        {file.status === 'error' && (
                          <button
                            onClick={() => retryProcessing(file.id, file.document_id)}
                            className="file-action-button-sidebar retry-button"
                            title="Retry processing"
                          >
                            <RefreshCw size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteFile(file.id, file.document_id)}
                          className="file-action-button-sidebar delete-button"
                          title="Delete file"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compact Summary */}
          {uploadedFiles.length > 0 && (
            <div className="upload-summary-sidebar">
              <div className="summary-stats-sidebar">
                <div className="stat-item-sidebar">
                  <CheckCircle size={14} color="#10b981" />
                  <span>{readyFilesCount} ready</span>
                </div>
                
                {processingFilesCount > 0 && (
                  <div className="stat-item-sidebar">
                    <Clock size={14} color="#3b82f6" className="animate-spin" />
                    <span>{processingFilesCount} processing</span>
                  </div>
                )}
              </div>
              
              {processingFilesCount > 0 && (
                <div className="processing-notice-sidebar">
                  <p className="processing-text-sidebar">
                    Indexing documents for search...
                  </p>
                </div>
              )}
            </div>
          )}
          
          {/* No documents state */}
          {uploadedFiles.length === 0 && !isLoadingDocs && (
            <div className="no-documents-sidebar">
              <FileText size={24} color="#9ca3af" />
              <p>No documents</p>
              <p className="no-documents-hint-sidebar">
                Upload your files in the field above
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default DocumentUploadPanel;