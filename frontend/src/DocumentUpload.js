import React, { useState, useRef } from 'react';
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
  Trash2
} from 'lucide-react';

const DocumentUploadPanel = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([
    // Mock data to show different states
    {
      id: '1',
      name: 'Financial_Report_2024.pdf',
      size: 2456789,
      status: 'ready', // ready, processing, error
      uploadedAt: new Date('2024-01-15'),
      processedAt: new Date('2024-01-15'),
      chunks: 45
    },
    {
      id: '2',
      name: 'Lease_Agreement_Template.docx',
      size: 987654,
      status: 'processing',
      uploadedAt: new Date()
    },
    {
      id: '3',
      name: 'Tax_Guidelines.pdf',
      size: 1234567,
      status: 'error',
      uploadedAt: new Date(),
      error: 'Failed to extract text from document'
    }
  ]);
  const [notifications, setNotifications] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

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
        status: 'processing',
        uploadedAt: new Date()
      };
      
      setUploadedFiles(prev => [newFile, ...prev]);
      
      // Simulate upload process (replace with real upload later)
      setTimeout(() => {
        setUploadedFiles(prev => prev.map(f => 
          f.id === newFile.id 
            ? { 
                ...f, 
                status: 'ready', 
                processedAt: new Date(),
                chunks: Math.floor(Math.random() * 50) + 10
              }
            : f
        ));
        
        // Show notification when processing is complete
        showNotification(`${file.name} is ready for Q&A!`, 'success');
      }, 3000 + Math.random() * 2000); // 3-5 seconds simulation
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

  const deleteFile = (fileId) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const retryProcessing = (fileId) => {
    setUploadedFiles(prev => prev.map(f => 
      f.id === fileId 
        ? { ...f, status: 'processing', error: null }
        : f
    ));
    
    // Simulate retry
    setTimeout(() => {
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileId 
          ? { 
              ...f, 
              status: 'ready', 
              processedAt: new Date(),
              chunks: Math.floor(Math.random() * 50) + 10
            }
          : f
      ));
      
      const file = uploadedFiles.find(f => f.id === fileId);
      if (file) {
        showNotification(`${file.name} is ready for Q&A!`, 'success');
      }
    }, 2000);
  };

  const showNotification = (message, type = 'info') => {
    const notification = {
      id: Date.now(),
      message,
      type
    };
    
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove notification after 4 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 4000);
  };

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const getStatusIcon = (file) => {
    switch (file.status) {
      case 'ready':
        return <CheckCircle size={16} color="#10b981" />;
      case 'processing':
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
        return `Ready • ${file.chunks} chunks`;
      case 'processing':
        return `Processing...`;
      case 'error':
        return 'Processing failed';
      default:
        return 'Unknown status';
    }
  };

  const readyFilesCount = uploadedFiles.filter(f => f.status === 'ready').length;
  const processingFilesCount = uploadedFiles.filter(f => f.status === 'processing').length;

  return (
    <>
      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="notifications-container">
          {notifications.map((notification) => (
            <div key={notification.id} className={`notification ${notification.type}`}>
              <div className="notification-content">
                {notification.type === 'success' && <CheckCircle size={16} />}
                {notification.type === 'error' && <AlertCircle size={16} />}
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
      {/* Panel Header */}
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
                {readyFilesCount} ready{processingFilesCount > 0 && `, ${processingFilesCount} processing`}
              </p>
            </div>
          </div>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
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
              PDF, DOCX, TXT files up to 25MB
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
              accept=".pdf,.docx,.doc,.txt"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </div>

          {/* Files List */}
          {uploadedFiles.length > 0 && (
            <div className="files-list-container">
              <h4 className="files-list-title">
                Uploaded Files ({uploadedFiles.length})
              </h4>
              <div className="files-list">
                {uploadedFiles.map((file) => (
                  <div key={file.id} className="file-item">
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
                          <p className="file-meta">
                            {formatFileSize(file.size)} • {formatDate(file.uploadedAt)}
                          </p>
                          
                          {/* Error message */}
                          {file.status === 'error' && (
                            <p className="file-error">{file.error}</p>
                          )}
                        </div>
                      </div>
                      
                      {/* Action buttons */}
                      <div className="file-actions">
                        {file.status === 'error' && (
                          <button
                            onClick={() => retryProcessing(file.id)}
                            className="file-action-button retry-button"
                            title="Retry processing"
                          >
                            <Download size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteFile(file.id)}
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

          {/* Summary */}
          {uploadedFiles.length > 0 && (
            <div className="upload-summary">
              <div className="upload-summary-content">
                <CheckCircle size={16} color="#3b82f6" />
                <p className="upload-summary-text">
                  <strong>{readyFilesCount}</strong> document{readyFilesCount !== 1 ? 's' : ''} ready for Q&A
                  {processingFilesCount > 0 && (
                    <span>
                      {' • '}<strong>{processingFilesCount}</strong> still processing
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
};

export default DocumentUploadPanel;